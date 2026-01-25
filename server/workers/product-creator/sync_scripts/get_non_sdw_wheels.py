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

# How many worker threads to spawn
MAX_WORKERS = 5

# A shared lock to coordinate read/write to the rate-limit budget
rate_limit_lock = threading.Lock()

# We'll store a global "remaining budget" here.
shared_rate_limit_budget = 1000  # typical max for Shopify GraphQL

# --------------------------
# PART 1: Gather All Matching Product IDs
# --------------------------
def gather_all_product_ids():
    """
    Gather all *active* products that have product_type 'wheels'
    (regardless of whether they include SDW Wholesale tag),
    returning just the Product IDs as a list.

    Returns None if pagination fails mid-fetch to prevent data loss.
    """
    product_ids = []
    after_cursor = None
    has_next_page = True
    pagination_completed = False

    query = """
    query getWheelProductIDs($first: Int!, $after: String) {
      products(
        first: $first
        after: $after
        query: "status:active product_type:wheels"
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


def shopify_graphql_call(query, variables=None):
    """
    Make a single GraphQL call to Shopify with basic error + throttle handling.
    Updates a shared rate-limit budget as well.
    Returns the JSON response, or None on error.
    """
    global shared_rate_limit_budget

    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
    }

    payload = {"query": query}
    if variables:
        payload["variables"] = variables

    response = requests.post(SHOPIFY_STORE_URL, json=payload, headers=headers)
    if response.status_code != 200:
        print(f"[ERROR] shopify_graphql_call: HTTP {response.status_code}, {response.text}")
        return None

    resp_json = response.json()
    if "errors" in resp_json:
        print(f"[ERROR] GraphQL errors: {resp_json['errors']}")
        return None

    cost_info = resp_json.get("extensions", {}).get("cost")
    if cost_info:
        throttle_status = cost_info.get("throttleStatus", {})
        currently_available = throttle_status.get("currentlyAvailable", 1000)

        with rate_limit_lock:
            shared_rate_limit_budget = currently_available

        if currently_available < 50:
            print(f"[RATE LIMIT] Budget is low ({currently_available}). Sleeping 2s...")
            time.sleep(2)

    return resp_json


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
      tags
      templateSuffix
      
      metaDescription: metafield(namespace: "global", key: "description_tag") {
        value
      }

      customWheelModel: metafield(namespace: "custom", key: "wheel_model") {
        value
      }
      customFinish: metafield(namespace: "custom", key: "finish") {
        value
      }
      customLugCount: metafield(namespace: "custom", key: "lug_count") {
        value
      }
      convermaxWheelDiameter: metafield(namespace: "convermax", key: "wheel_diameter") {
        value
      }
      convermaxWheelWidth: metafield(namespace: "convermax", key: "wheel_width") {
        value
      }
      convermaxWheelOffset: metafield(namespace: "convermax", key: "wheel_offset") {
        value
      }
      convermaxWheelBoltPattern: metafield(namespace: "convermax", key: "wheel_bolt_pattern") {
        value
      }

      googleWheelColor: metafield(namespace: "google", key: "wheel_color") {
        value
      }
      convermaxWheelColor: metafield(namespace: "convermax", key: "wheel_color") {
        value
      }
      customLoadRating: metafield(namespace: "custom", key: "wheel_load_rating") {
        value
      }
      customWeight: metafield(namespace: "custom", key: "weight") {
        value
      }
      customHubBore: metafield(namespace: "custom", key: "hubbore") {
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
        vendor = product_node["vendor"]
        tags = product_node["tags"] or []
        tags_str = ",".join(tags)
        meta_description = product_node["metaDescription"]["value"] if product_node["metaDescription"] else None
        
        # Get template suffix
        template_suffix = product_node.get("templateSuffix", None)

        model = product_node["customWheelModel"]["value"] if product_node["customWheelModel"] else None
        finish = product_node["customFinish"]["value"] if product_node["customFinish"] else None
        lug_count = product_node["customLugCount"]["value"] if product_node["customLugCount"] else None
        diameter = product_node["convermaxWheelDiameter"]["value"] if product_node["convermaxWheelDiameter"] else None
        width = product_node["convermaxWheelWidth"]["value"] if product_node["convermaxWheelWidth"] else None
        offset = product_node["convermaxWheelOffset"]["value"] if product_node["convermaxWheelOffset"] else None

        # Bolt pattern
        bolt_pattern_val = None
        bp_field = product_node["convermaxWheelBoltPattern"]
        if bp_field and bp_field["value"]:
            raw_bolt_pattern = bp_field["value"]
            try:
                bp_list = json.loads(raw_bolt_pattern)
                if isinstance(bp_list, list):
                    bolt_pattern_val = ",".join(map(str, bp_list))
                else:
                    bolt_pattern_val = raw_bolt_pattern
            except json.JSONDecodeError:
                bolt_pattern_val = raw_bolt_pattern

        # short_color (google.wheel_color)
        short_color = product_node["googleWheelColor"]["value"] if product_node["googleWheelColor"] else None

        # primary_color (convermax.wheel_color) - list-like
        primary_color_val = None
        pc_field = product_node["convermaxWheelColor"]
        if pc_field and pc_field["value"]:
            raw_pc = pc_field["value"]
            try:
                pc_list = json.loads(raw_pc)
                if isinstance(pc_list, list):
                    primary_color_val = ",".join(map(str, pc_list))
                else:
                    primary_color_val = raw_pc
            except json.JSONDecodeError:
                primary_color_val = raw_pc

        load_rating = product_node["customLoadRating"]["value"] if product_node["customLoadRating"] else None
        weight = product_node["customWeight"]["value"] if product_node["customWeight"] else None
        hub_bore = product_node["customHubBore"]["value"] if product_node["customHubBore"] else None

        for ve in product_node["variants"]["edges"]:
            v_node = ve["node"]
            variant_id = v_node["legacyResourceId"]
            sku = v_node["sku"] or ""
            price = v_node["price"] or "0.00"

            record = {
                "shopify_id": product_id,
                "variant_id": variant_id,
                "part_number": sku,
                "vendor": vendor,
                "model": model,
                "finish": finish,
                "lug_count": lug_count,
                "diameter": diameter,
                "width": width,
                "offset": offset,
                "bolt_pattern": bolt_pattern_val,
                "tags": tags_str,
                "short_color": short_color,
                "primary_color": primary_color_val,
                "load_rating": load_rating,
                "weight": weight,
                "product_template": template_suffix,
                "hub_bore": hub_bore,
                "status": status,
                "meta_description": meta_description,
                "price": price
            }
            records.append(record)

    return records


def batch_upsert_records(db, records):
    """
    Upsert rows in 'all_shopify_wheels' based on variant_id.
    If a record with the same variant_id exists, update it;
    otherwise, insert a new record.
    """
    if not records:
        return 0

    cursor = db.cursor()
    upsert_sql = """
        INSERT INTO all_shopify_wheels
        (shopify_id, variant_id, part_number, vendor, model, finish, lug_count,
         diameter, width, offset, bolt_pattern, tags,
         short_color, primary_color, load_rating, weight, product_template, hub_bore, status, meta_description, price)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            shopify_id = VALUES(shopify_id),
            part_number = VALUES(part_number),
            vendor = VALUES(vendor),
            model = VALUES(model),
            finish = VALUES(finish),
            lug_count = VALUES(lug_count),
            diameter = VALUES(diameter),
            width = VALUES(width),
            offset = VALUES(offset),
            bolt_pattern = VALUES(bolt_pattern),
            tags = VALUES(tags),
            short_color = VALUES(short_color),
            primary_color = VALUES(primary_color),
            load_rating = VALUES(load_rating),
            weight = VALUES(weight),
            product_template = VALUES(product_template),
            hub_bore = VALUES(hub_bore),
            status = VALUES(status),
            meta_description = VALUES(meta_description),
            price = VALUES(price),
            last_modified = NOW()
    """
    params = []
    for r in records:
        params.append((
            r["shopify_id"],
            r["variant_id"],
            r["part_number"],
            r["vendor"],
            r["model"],
            r["finish"],
            r["lug_count"],  # Add this
            r["diameter"],
            r["width"],
            r["offset"],
            r["bolt_pattern"],
            r["tags"],
            r["short_color"],
            r["primary_color"],
            r["load_rating"],
            r["weight"],
            r["product_template"],
            r["hub_bore"],
            r["status"],
            r["meta_description"],
            r["price"]
        ))

    cursor.executemany(upsert_sql, params)
    db.commit()
    return len(records)


def delete_stale_products(db, active_product_ids):
    """
    Delete all rows from all_shopify_wheels where the shopify_id
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
        FROM all_shopify_wheels 
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
        DELETE FROM all_shopify_wheels 
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
def create_table_if_not_exists(db):
    cursor = db.cursor()
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS all_shopify_wheels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shopify_id BIGINT,
        variant_id BIGINT,
        part_number VARCHAR(255),
        vendor VARCHAR(255),
        meta_description TEXT,
        model VARCHAR(255),
        finish VARCHAR(255),
        lug_count VARCHAR(255),
        diameter VARCHAR(255),
        width VARCHAR(255),
        offset VARCHAR(255),
        bolt_pattern TEXT,
        tags TEXT,
        short_color VARCHAR(255),
        primary_color TEXT,
        load_rating VARCHAR(255),
        weight VARCHAR(255),
        product_template VARCHAR(255),
        hub_bore VARCHAR(255),
        status VARCHAR(255),
        price DECIMAL(10, 2)
    );
    """
    cursor.execute(create_table_sql)
    
    # Add columns if they don't exist
    columns_to_add = [
        ("lug_count", "VARCHAR(255)"),
        ("price", "DECIMAL(10, 2)")
    ]
    
    for column_name, column_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE all_shopify_wheels ADD COLUMN {column_name} {column_type};")
        except mysql.connector.Error as err:
            if err.errno != 1060:  # Column already exists error
                print(f"Error adding {column_name} column:", err)
    
    # Ensure unique index on variant_id for upsert
    try:
        cursor.execute("ALTER TABLE all_shopify_wheels ADD UNIQUE KEY unique_variant (variant_id);")
    except mysql.connector.Error as err:
        if err.errno != 1061:  # Index already exists error
            print("Error altering table:", err)
    db.commit()

def main():
    db = mysql.connector.connect(**DB_CONFIG)
    create_table_if_not_exists(db)

    # Get current database count for safety check
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(DISTINCT shopify_id) FROM all_shopify_wheels")
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
        # Since chunk size is now 250, process in sub-chunks of 250 if necessary
        if len(chunk) <= CHUNK_SIZE:
            all_records.extend(fetch_product_details_chunk(chunk))
        else:
            local_start = 0
            while local_start < len(chunk):
                sub_chunk = chunk[local_start:local_start+CHUNK_SIZE]
                recs = fetch_product_details_chunk(sub_chunk)
                all_records.extend(recs)
                local_start += CHUNK_SIZE

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
        return processed

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_index = {executor.submit(worker, chunk, idx): idx for idx, chunk in enumerate(chunks)}
        for future in as_completed(future_to_index):
            idx = future_to_index[future]
            try:
                processed = future.result()
                upserted_total += processed
                print(f"[CHUNK {idx}] Upserted {processed} variants (new or updated).")
            except Exception as e:
                print(f"[CHUNK {idx}] Exception: {e}")

    # Clean up stale products after all upserts are complete
    deleted_rows = delete_stale_products(db, all_product_ids)
    
    elapsed = time.time() - start_time
    print(f"[INFO] Done. Upserted a total of {upserted_total} variants across all chunks.")
    print(f"[INFO] Deleted {deleted_rows} stale rows.")
    print(f"[INFO] Elapsed time: {elapsed:.2f}s")
    db.close()

if __name__ == "__main__":
    main()