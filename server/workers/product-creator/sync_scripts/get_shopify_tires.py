import math
import time
import json
import requests
import mysql.connector
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import base64
import os

from dotenv import load_dotenv
import pathlib

# Load environment variables from environment (Railway provides them)
load_dotenv()
# --------------------------
# Shopify & DB Config
# --------------------------
SHOPIFY_STORE_URL = os.environ.get('SHOPIFY_STORE_URL')
SHOPIFY_ACCESS_TOKEN = os.environ.get('SHOPIFY_ACCESS_TOKEN')


DB_CONFIG = {
    'host': os.environ.get('DB_HOST'),
    'user': os.environ.get('DB_USER'),
    'password': os.environ.get('DB_PASSWORD'),
    'database': 'tfs-db'  # Hardcoded to tfs-db for inventory/Shopify sync tables
}

# Number of products per page in the ID-gather step
PAGE_SIZE_FOR_ID_GATHER = 250

# We'll chunk product IDs into sublists of this size (updated to 250)
CHUNK_SIZE = 250

# How many worker threads to spawn (reduced for better rate limit handling)
MAX_WORKERS = 3

# A shared lock to coordinate read/write to the rate-limit budget
rate_limit_lock = threading.Lock()

# We'll store a global "remaining budget" here.
shared_rate_limit_budget = 1000  # typical max for Shopify GraphQL

# Circuit breaker for severe throttling
circuit_breaker_lock = threading.Lock()
circuit_breaker_active = False
circuit_breaker_until = 0

# --------------------------
# PART 1: Gather All Matching Product IDs
# --------------------------
def gather_all_product_ids():
    """
    Gather all *active* products that have product_type 'tires'
    returning just the Product IDs as a list.

    Returns None if pagination fails mid-fetch to prevent data loss.
    """
    product_ids = []
    after_cursor = None
    has_next_page = True
    pagination_completed = False

    query = """
    query getTireProductIDs($first: Int!, $after: String) {
      products(
        first: $first
        after: $after
        query: "status:active product_type:tires"
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            legacyResourceId
          }
        }
      }
    }
    """

    page_count = 0

    while has_next_page:
        page_count += 1
        variables = {
            "first": PAGE_SIZE_FOR_ID_GATHER,
            "after": after_cursor
        }

        resp_json = shopify_graphql_call(query, variables)
        if not resp_json:
            print(f"[ERROR] ❌ API call failed on page {page_count}!")
            print(f"[ERROR] ❌ Pagination incomplete! Fetched {len(product_ids)} products so far.")
            print(f"[ERROR] ❌ Returning None to prevent data loss from incomplete sync.")
            return None  # Return None instead of partial list

        products_data = resp_json["data"]["products"]
        edges = products_data["edges"]

        for edge in edges:
            pid = edge["node"]["legacyResourceId"]
            product_ids.append(pid)

        has_next_page = products_data["pageInfo"]["hasNextPage"]
        after_cursor = products_data["pageInfo"]["endCursor"] if has_next_page else None

        print(f"[ID GATHER] Page {page_count}, fetched {len(edges)} IDs, total so far: {len(product_ids)}")

    pagination_completed = True
    print(f"[ID GATHER] ✅ Pagination completed successfully.")
    print(f"[ID GATHER] ✅ Found {len(product_ids)} total product IDs.")
    return product_ids


def shopify_graphql_call(query, variables=None, max_retries=5):
    """
    Make a single GraphQL call to Shopify with enhanced error + throttle handling.
    Implements exponential backoff and retry logic for throttled requests.
    Updates a shared rate-limit budget as well.
    Returns the JSON response, or None on error.
    """
    global shared_rate_limit_budget, circuit_breaker_active, circuit_breaker_until

    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
    }

    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    for attempt in range(max_retries):
        # Check circuit breaker
        with circuit_breaker_lock:
            if circuit_breaker_active and time.time() < circuit_breaker_until:
                remaining_time = circuit_breaker_until - time.time()
                print(f"[CIRCUIT BREAKER] API throttled, waiting {remaining_time:.1f}s more...")
                time.sleep(min(remaining_time, 5))  # Sleep in chunks
                continue
            elif circuit_breaker_active and time.time() >= circuit_breaker_until:
                print(f"[CIRCUIT BREAKER] Resetting, attempting API call...")
                circuit_breaker_active = False

        # Wait before retry (exponential backoff after first attempt)
        if attempt > 0:
            wait_time = min(2 ** attempt, 30)  # Cap at 30 seconds
            print(f"[RETRY] Attempt {attempt + 1}/{max_retries}, waiting {wait_time}s...")
            time.sleep(wait_time)

        # Check shared budget before making request
        with rate_limit_lock:
            current_budget = shared_rate_limit_budget
        
        # More aggressive budget checking
        if current_budget < 20:
            # If budget is very low, activate circuit breaker for all threads
            with circuit_breaker_lock:
                if not circuit_breaker_active:
                    circuit_breaker_active = True
                    circuit_breaker_until = time.time() + 30  # 30 second circuit breaker
                    print(f"[CIRCUIT BREAKER] Budget critically low ({current_budget}), activating 30s cooldown...")
            continue

        response = requests.post(SHOPIFY_STORE_URL, json=payload, headers=headers)
        
        if response.status_code != 200:
            if response.status_code == 429:  # Too Many Requests
                print(f"[RATE LIMIT] HTTP 429 on attempt {attempt + 1}. Retrying...")
                # Activate circuit breaker on HTTP 429
                with circuit_breaker_lock:
                    if not circuit_breaker_active:
                        circuit_breaker_active = True
                        circuit_breaker_until = time.time() + 20
                        print(f"[CIRCUIT BREAKER] HTTP 429 received, activating 20s cooldown...")
                continue
            else:
                print(f"[ERROR] shopify_graphql_call: HTTP {response.status_code}, {response.text}")
                return None

        resp_json = response.json()
        
        # Check for GraphQL errors
        if "errors" in resp_json:
            errors = resp_json["errors"]
            # Check if it's a throttling error
            is_throttled = any(
                error.get("extensions", {}).get("code") == "THROTTLED" 
                for error in errors
            )
            
            if is_throttled and attempt < max_retries - 1:
                print(f"[THROTTLED] GraphQL throttled on attempt {attempt + 1}. Retrying...")
                # Activate circuit breaker on GraphQL throttling
                with circuit_breaker_lock:
                    if not circuit_breaker_active:
                        circuit_breaker_active = True
                        circuit_breaker_until = time.time() + 15
                        print(f"[CIRCUIT BREAKER] GraphQL throttled, activating 15s cooldown...")
                continue
            else:
                print(f"[ERROR] GraphQL errors: {errors}")
                return None

        # Update rate limit budget
        cost_info = resp_json.get("extensions", {}).get("cost")
        if cost_info:
            throttle_status = cost_info.get("throttleStatus", {})
            currently_available = throttle_status.get("currentlyAvailable", 1000)

            with rate_limit_lock:
                shared_rate_limit_budget = currently_available

            # Less aggressive pausing since we have circuit breaker
            if currently_available < 50:
                print(f"[RATE LIMIT] Budget is low ({currently_available}). Brief pause...")
                time.sleep(1)

        return resp_json

    print(f"[ERROR] Max retries ({max_retries}) exceeded for GraphQL call")
    return None


# --------------------------
# PART 2: Concurrency - Fetch Details via `nodes` Query
# --------------------------
DETAILS_QUERY = """
query getProductDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      legacyResourceId
      status
      vendor
      title
      description
      tags
      templateSuffix
      seo {
        title
        description
      }
      publishedAt
      
      metaDescription: metafield(namespace: "global", key: "description_tag") {
        value
      }

      customTireModel: metafield(namespace: "custom", key: "tire_model") {
        value
      }
      convermaxTireSize: metafield(namespace: "convermax", key: "tire_size") {
        value
      }
      customTireType: metafield(namespace: "custom", key: "tire_type_combined") {
        value
      }
      convermaxTireRim: metafield(namespace: "convermax", key: "tire_rim") {
        value
      }
      convermaxTireWidth: metafield(namespace: "convermax", key: "tire_width") {
        value
      }
      convermaxTireAspect: metafield(namespace: "convermax", key: "tire_aspect_ratio") {
        value
      }
      customWeight: metafield(namespace: "custom", key: "weight") {
        value
      }

      variants(first: 100) {
        edges {
          node {
            legacyResourceId
            sku
            price
          }
        }
      }
    }
  }
}
"""

def convert_legacy_id_to_global_id(product_id):
    """
    Convert a numeric legacy product ID to the base64 global ID
    Shopify's `nodes` query requires.
    """
    base_str = f"gid://shopify/Product/{product_id}"
    return base64.b64encode(base_str.encode('utf-8')).decode('utf-8')


def fetch_product_details_chunk(pid_chunk):
    """
    Fetch details for a chunk of product IDs using the 'nodes' query.
    Returns a list of record dicts (one per variant).
    """
    global_ids = [convert_legacy_id_to_global_id(pid) for pid in pid_chunk]
    variables = {"ids": global_ids}
    resp_json = shopify_graphql_call(DETAILS_QUERY, variables)
    if not resp_json:
        return []

    nodes = resp_json["data"]["nodes"]
    records = []

    for product_node in nodes:
        if not product_node:
            continue

        product_id = product_node["legacyResourceId"]
        status = product_node.get("status", None)
        brand = product_node["vendor"]  # vendor -> brand for tires
        title = product_node.get("title", "")
        description = product_node.get("description", "")
        tags = product_node["tags"] or []
        tags_str = ",".join(tags)
        
        # SEO fields
        seo = product_node.get("seo", {})
        meta_title = seo.get("title", "") if seo else ""
        seo_description = seo.get("description", "") if seo else ""
        
        # Meta description from metafield
        meta_description = product_node["metaDescription"]["value"] if product_node["metaDescription"] else None
        
        # Get template suffix
        template_suffix = product_node.get("templateSuffix", None)
        
        # Publication status - determine if published based on publishedAt
        published_at = product_node.get("publishedAt", None)
        publication_status = "published" if published_at else "unpublished"

        # Tire-specific metafields
        model = product_node["customTireModel"]["value"] if product_node["customTireModel"] else None
        size = product_node["convermaxTireSize"]["value"] if product_node["convermaxTireSize"] else None
        tire_type = product_node["customTireType"]["value"] if product_node["customTireType"] else None
        diameter = product_node["convermaxTireRim"]["value"] if product_node["convermaxTireRim"] else None
        width = product_node["convermaxTireWidth"]["value"] if product_node["convermaxTireWidth"] else None
        aspect = product_node["convermaxTireAspect"]["value"] if product_node["convermaxTireAspect"] else None
        weight = product_node["customWeight"]["value"] if product_node["customWeight"] else None

        for ve in product_node["variants"]["edges"]:
            v_node = ve["node"]
            variant_id = v_node["legacyResourceId"]
            sku = v_node["sku"] or ""
            price = v_node["price"] or "0.00"

            record = {
                "shopify_id": product_id,
                "variant_id": variant_id,
                "brand": brand,
                "part_number": sku,
                "status": status,
                "tags": tags_str,
                "price": price,
                "title": title,
                "description": description,
                "meta_title": meta_title,
                "meta_description": meta_description or seo_description,  # Use metafield or SEO description
                "model": model,
                "size": size,
                "tire_type": tire_type,
                "diameter": diameter,
                "width": width,
                "aspect": aspect,
                "weight": weight,
                "product_template": template_suffix,
                "publication_status": publication_status
            }
            records.append(record)

    return records


def batch_upsert_records(db, records):
    """
    Upsert rows in 'shopify_tires' based on variant_id.
    If a record with the same variant_id exists, update it;
    otherwise, insert a new record.
    """
    if not records:
        return 0

    cursor = db.cursor()
    upsert_sql = """
        INSERT INTO shopify_tires
        (shopify_id, variant_id, brand, part_number, status, tags, price, title, description,
         meta_title, meta_description, model, size, tire_type, diameter, width, aspect,
         weight, product_template, publication_status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            shopify_id = VALUES(shopify_id),
            brand = VALUES(brand),
            part_number = VALUES(part_number),
            status = VALUES(status),
            tags = VALUES(tags),
            price = VALUES(price),
            title = VALUES(title),
            description = VALUES(description),
            meta_title = VALUES(meta_title),
            meta_description = VALUES(meta_description),
            model = VALUES(model),
            size = VALUES(size),
            tire_type = VALUES(tire_type),
            diameter = VALUES(diameter),
            width = VALUES(width),
            aspect = VALUES(aspect),
            weight = VALUES(weight),
            product_template = VALUES(product_template),
            publication_status = VALUES(publication_status),
            last_modified = NOW()
    """
    params = []
    for r in records:
        params.append((
            r["shopify_id"],
            r["variant_id"],
            r["brand"],
            r["part_number"],
            r["status"],
            r["tags"],
            r["price"],
            r["title"],
            r["description"],
            r["meta_title"],
            r["meta_description"],
            r["model"],
            r["size"],
            r["tire_type"],
            r["diameter"],
            r["width"],
            r["aspect"],
            r["weight"],
            r["product_template"],
            r["publication_status"]
        ))

    cursor.executemany(upsert_sql, params)
    db.commit()
    return len(records)


def delete_stale_products(db, active_product_ids):
    """
    Delete all rows from shopify_tires where the shopify_id
    is not in the list of active product IDs from Shopify.
    """
    if not active_product_ids:
        print("[WARNING] No active product IDs provided. Skipping deletion of stale products.")
        return 0
    
    cursor = db.cursor()
    
    # First, count how many stale products we have
    placeholders = ','.join(['%s'] * len(active_product_ids))
    count_sql = f"""
        SELECT COUNT(DISTINCT shopify_id) 
        FROM shopify_tires 
        WHERE shopify_id NOT IN ({placeholders})
    """
    cursor.execute(count_sql, active_product_ids)
    stale_count = cursor.fetchone()[0]
    
    if stale_count == 0:
        print("[CLEANUP] No stale products found. Database is up to date.")
        return 0
    
    print(f"[CLEANUP] Found {stale_count} stale products to delete.")
    
    # Delete stale products
    delete_sql = f"""
        DELETE FROM shopify_tires 
        WHERE shopify_id NOT IN ({placeholders})
    """
    cursor.execute(delete_sql, active_product_ids)
    rows_deleted = cursor.rowcount
    db.commit()
    
    print(f"[CLEANUP] Deleted {rows_deleted} rows for {stale_count} stale products.")
    return rows_deleted


# --------------------------
# Main Flow
# --------------------------
def create_tires_table_if_not_exists(db):
    cursor = db.cursor()
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS shopify_tires (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shopify_id BIGINT,
        variant_id BIGINT,
        brand VARCHAR(255),
        part_number VARCHAR(255),
        status VARCHAR(255),
        tags TEXT,
        price DECIMAL(10, 2),
        title VARCHAR(500),
        description TEXT,
        meta_title VARCHAR(255),
        meta_description TEXT,
        model VARCHAR(255),
        size VARCHAR(255),
        tire_type VARCHAR(255),
        diameter VARCHAR(255),
        width VARCHAR(255),
        aspect VARCHAR(255),
        weight VARCHAR(255),
        product_template VARCHAR(255),
        publication_status VARCHAR(255)
    );
    """
    cursor.execute(create_table_sql)
    
    # Add columns if they don't exist (for future-proofing)
    columns_to_add = [
        ("title", "VARCHAR(500)"),
        ("description", "TEXT"),
        ("meta_title", "VARCHAR(255)"),
        ("publication_status", "VARCHAR(255)")
    ]
    
    for column_name, column_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE shopify_tires ADD COLUMN {column_name} {column_type};")
        except mysql.connector.Error as err:
            if err.errno != 1060:  # Column already exists error
                print(f"Error adding {column_name} column:", err)
    
    # Ensure unique index on variant_id for upsert
    try:
        cursor.execute("ALTER TABLE shopify_tires ADD UNIQUE KEY unique_variant (variant_id);")
    except mysql.connector.Error as err:
        if err.errno != 1061:  # Index already exists error
            print("Error altering table:", err)
    
    db.commit()

def main():
    db = mysql.connector.connect(**DB_CONFIG)
    create_tires_table_if_not_exists(db)

    # Get current database count for safety check
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(DISTINCT shopify_id) FROM shopify_tires")
    current_db_count = cursor.fetchone()[0]
    print(f"[INFO] Current database has {current_db_count} products")

    all_product_ids = gather_all_product_ids()
    if all_product_ids is None:
        print("[ERROR] ❌ Failed to gather complete product list (API error during pagination).")
        print("[ERROR] ❌ Aborting sync to prevent data loss. Please retry later.")
        db.close()
        return

    if not all_product_ids:
        print("[INFO] No products found in Shopify.")
        if current_db_count > 0:
            print(f"[WARNING] ⚠️  Database has {current_db_count} products but Shopify returned 0!")
            print(f"[WARNING] ⚠️  This is suspicious. Aborting to prevent accidental deletion.")
            db.close()
            return
        db.close()
        return

    # Safety check: New count shouldn't be drastically lower than existing
    if current_db_count > 100 and len(all_product_ids) < current_db_count * 0.5:
        print(f"[ERROR] ❌ SAFETY CHECK FAILED!")
        print(f"[ERROR] ❌ New count ({len(all_product_ids)}) is less than 50% of current database count ({current_db_count})")
        print(f"[ERROR] ❌ This likely indicates incomplete data fetch. Aborting to prevent data loss.")
        print(f"[ERROR] ❌ If this is expected (e.g., bulk product deletion), manually disable this check.")
        db.close()
        return

    print(f"[SAFETY CHECK] ✅ New count ({len(all_product_ids)}) vs Current ({current_db_count}): OK")

    chunks = [all_product_ids[i:i+CHUNK_SIZE] for i in range(0, len(all_product_ids), CHUNK_SIZE)]
    print(f"[INFO] Split {len(all_product_ids)} products into {len(chunks)} chunks (size ~{CHUNK_SIZE}).")

    upserted_total = 0
    start_time = time.time()

    def worker(chunk, index):
        thread_db = mysql.connector.connect(**DB_CONFIG)
        all_records = []
        
        # Process the chunk with retry logic
        max_chunk_retries = 3
        chunk_attempt = 0
        
        while chunk_attempt < max_chunk_retries:
            try:
                # Since chunk size is now 250, process in sub-chunks of 250 if necessary
                if len(chunk) <= CHUNK_SIZE:
                    records = fetch_product_details_chunk(chunk)
                    all_records.extend(records)
                else:
                    local_start = 0
                    while local_start < len(chunk):
                        sub_chunk = chunk[local_start:local_start+CHUNK_SIZE]
                        recs = fetch_product_details_chunk(sub_chunk)
                        all_records.extend(recs)
                        local_start += CHUNK_SIZE
                
                # If we got no records and this isn't the first attempt, it might be due to rate limiting
                if not all_records and chunk_attempt > 0:
                    chunk_attempt += 1
                    wait_time = 5 * (chunk_attempt)  # Progressive wait
                    print(f"[CHUNK {index}] No records retrieved on attempt {chunk_attempt}, waiting {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                else:
                    break  # Success or first attempt with no records
                    
            except Exception as e:
                chunk_attempt += 1
                if chunk_attempt < max_chunk_retries:
                    print(f"[CHUNK {index}] Exception on attempt {chunk_attempt}: {e}. Retrying...")
                    time.sleep(2 * chunk_attempt)
                else:
                    print(f"[CHUNK {index}] Failed after {max_chunk_retries} attempts: {e}")
                    break

        # Retry mechanism for deadlock (error 1213)
        max_retries = 3
        attempt = 0
        processed = 0
        while attempt < max_retries:
            try:
                processed = batch_upsert_records(thread_db, all_records)
                break
            except mysql.connector.Error as err:
                if err.errno == 1213:  # Deadlock error
                    attempt += 1
                    print(f"[CHUNK {index}] Deadlock encountered on attempt {attempt}/{max_retries}. Retrying...")
                    time.sleep(1)
                else:
                    raise
        if attempt == max_retries:
            print(f"[CHUNK {index}] Failed to upsert after {max_retries} attempts due to deadlock.")
            
        thread_db.close()
        return processed, len(all_records)

    # Process chunks in batches to handle severe rate limiting better
    batch_size = 20  # Process 20 chunks at a time
    failed_chunks = []
    
    for batch_start in range(0, len(chunks), batch_size):
        batch_end = min(batch_start + batch_size, len(chunks))
        batch_chunks = chunks[batch_start:batch_end]
        
        print(f"\n[BATCH] Processing chunks {batch_start}-{batch_end-1} ({len(batch_chunks)} chunks)")
        
        # Adjust worker count based on rate limit health
        with rate_limit_lock:
            current_budget = shared_rate_limit_budget
        
        # Reduce workers if budget is consistently low
        if current_budget < 100:
            workers_for_batch = 1
            print(f"[ADAPTIVE] Low budget ({current_budget}), using 1 worker for this batch")
        elif current_budget < 300:
            workers_for_batch = 2
            print(f"[ADAPTIVE] Medium budget ({current_budget}), using 2 workers for this batch")
        else:
            workers_for_batch = MAX_WORKERS

        with ThreadPoolExecutor(max_workers=workers_for_batch) as executor:
            future_to_index = {
                executor.submit(worker, chunk, batch_start + idx): batch_start + idx 
                for idx, chunk in enumerate(batch_chunks)
            }
            
            for future in as_completed(future_to_index):
                idx = future_to_index[future]
                try:
                    processed, records_fetched = future.result()
                    upserted_total += processed
                    
                    if records_fetched == 0:
                        failed_chunks.append(idx)
                        print(f"[CHUNK {idx}] ⚠️  Failed to fetch any records - likely rate limited")
                    else:
                        print(f"[CHUNK {idx}] ✅ Upserted {processed} variants (fetched {records_fetched} records)")
                        
                except Exception as e:
                    failed_chunks.append(idx)
                    print(f"[CHUNK {idx}] ❌ Exception: {e}")

        # Brief pause between batches
        if batch_end < len(chunks):
            print(f"[BATCH] Completed batch, brief pause before next batch...")
            time.sleep(2)

    # Report on failed chunks
    if failed_chunks:
        print(f"\n[WARNING] {len(failed_chunks)} chunks failed due to rate limiting or errors:")
        print(f"Failed chunk indices: {failed_chunks}")
        print("Consider re-running the script later for just the failed chunks.")
    else:
        print(f"\n[SUCCESS] All chunks processed successfully!")

    # Clean up stale products after all upserts are complete
    deleted_rows = delete_stale_products(db, all_product_ids)
    
    elapsed = time.time() - start_time
    print(f"[INFO] Done. Upserted a total of {upserted_total} variants across all chunks.")
    print(f"[INFO] Deleted {deleted_rows} stale rows.")
    print(f"[INFO] Elapsed time: {elapsed:.2f}s")
    db.close()

if __name__ == "__main__":
    main()