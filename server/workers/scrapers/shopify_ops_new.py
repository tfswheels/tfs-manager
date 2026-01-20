"""
Shopify Operations Module - EXACT REPLICA of original sync logic

Matches get_non_sdw_wheels.py and get_shopify_tires.py exactly.
"""

import asyncio
import aiohttp
import time
import json
import base64
from typing import Dict, List, Optional

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import (
        MODE,
        SHOPIFY_STORE_URL,
        SHOPIFY_ACCESS_TOKEN,
        logger
    )
except ImportError:
    from config import (
        MODE,
        SHOPIFY_STORE_URL,
        SHOPIFY_ACCESS_TOKEN,
        logger
    )


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def convert_legacy_id_to_global_id(product_id):
    """Convert numeric legacy product ID to base64 global ID (from original)."""
    base_str = f"gid://shopify/Product/{product_id}"
    encoded = base64.b64encode(base_str.encode('utf-8')).decode('utf-8')
    return f"gid://shopify/Product/{product_id}"  # Return non-encoded format


async def handle_rate_limiting(throttle_status: Dict):
    """Handle Shopify GraphQL rate limiting (from original)."""
    if not throttle_status:
        return

    currently_available = throttle_status.get('currentlyAvailable', 2000)
    restore_rate = throttle_status.get('restoreRate', 100.0)

    # Low threshold check
    if currently_available < 120:
        needed = 2000 - currently_available
        wait_time = needed / restore_rate
        logger.info(f"[RateLimit] Points low ({currently_available}), waiting {wait_time:.2f}s...")
        await asyncio.sleep(wait_time)


# =============================================================================
# STEP 1: GATHER ALL PRODUCT IDS (Lightweight query)
# =============================================================================

async def gather_all_product_ids(session: aiohttp.ClientSession) -> List[int]:
    """
    Gather all ACTIVE product IDs (from original get_non_sdw_wheels.py / get_shopify_tires.py).

    Returns list of product IDs (legacy numeric IDs).
    """
    product_ids = []
    after_cursor = None
    has_next_page = True
    page_count = 0

    # Determine product type filter
    product_type = "wheels" if MODE == 'wheels' else "tires"

    logger.info(f"🔍 STEP 1: Gathering product IDs from Shopify")
    logger.info(f"   Filter: status:active product_type:{product_type}")

    while has_next_page:
        page_count += 1

        # Build query (EXACT from original)
        if after_cursor:
            query = f"""
            query getProductIDs($first: Int!, $after: String) {{
              products(
                first: $first
                after: $after
                query: "status:active product_type:{product_type}"
              ) {{
                pageInfo {{
                  hasNextPage
                  endCursor
                }}
                edges {{
                  node {{
                    legacyResourceId
                  }}
                }}
              }}
            }}
            """
            variables = {"first": 250, "after": after_cursor}
        else:
            query = f"""
            query getProductIDs($first: Int!) {{
              products(
                first: $first
                query: "status:active product_type:{product_type}"
              ) {{
                pageInfo {{
                  hasNextPage
                  endCursor
                }}
                edges {{
                  node {{
                    legacyResourceId
                  }}
                }}
              }}
            }}
            """
            variables = {"first": 250}

        headers = {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
        }

        payload = {"query": query, "variables": variables}

        logger.debug(f"   Fetching page {page_count}...")

        async with session.post(SHOPIFY_STORE_URL, headers=headers, json=payload) as resp:
            if resp.status != 200:
                logger.error(f"❌ Shopify API returned status {resp.status}")
                text = await resp.text()
                logger.error(f"   Response: {text[:200]}")
                break

            data = await resp.json()

            # Check for GraphQL errors
            if "errors" in data:
                logger.error(f"❌ GraphQL errors: {data['errors']}")
                break

            # Handle rate limiting
            throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            if throttle:
                logger.debug(f"   Rate limit: {throttle.get('currentlyAvailable')}/{throttle.get('maximumAvailable')}")
            await handle_rate_limiting(throttle)

            # Extract product IDs
            products_data = data.get("data", {}).get("products", {})
            edges = products_data.get("edges", [])

            for edge in edges:
                pid = edge["node"]["legacyResourceId"]
                product_ids.append(pid)

            has_next_page = products_data.get("pageInfo", {}).get("hasNextPage", False)
            after_cursor = products_data.get("pageInfo", {}).get("endCursor") if has_next_page else None

            logger.info(f"   ✅ Page {page_count}: Fetched {len(edges)} IDs, total so far: {len(product_ids)}")

    logger.info(f"✅ STEP 1 Complete: Found {len(product_ids)} total product IDs")
    return product_ids


# =============================================================================
# STEP 2: FETCH PRODUCT DETAILS (Using nodes query)
# =============================================================================

# Define the details query based on MODE (EXACT from originals)
WHEELS_DETAILS_QUERY = """
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

TIRES_DETAILS_QUERY = """
query getProductDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      legacyResourceId
      status
      vendor
      tags

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


async def fetch_product_details_chunk(session: aiohttp.ClientSession, pid_chunk: List[int]) -> List[Dict]:
    """
    Fetch details for a chunk of product IDs using nodes query (EXACT from original).

    Returns list of record dicts (one per variant).
    """
    # Convert legacy IDs to global IDs
    global_ids = [f"gid://shopify/Product/{pid}" for pid in pid_chunk]
    variables = {"ids": global_ids}

    # Choose query based on MODE
    query = WHEELS_DETAILS_QUERY if MODE == 'wheels' else TIRES_DETAILS_QUERY

    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
    }

    payload = {"query": query, "variables": variables}

    async with session.post(SHOPIFY_STORE_URL, headers=headers, json=payload) as resp:
        if resp.status != 200:
            logger.error(f"❌ Failed to fetch chunk details (status {resp.status})")
            return []

        data = await resp.json()

        # Check for errors
        if "errors" in data:
            logger.error(f"❌ GraphQL errors in chunk: {data['errors']}")
            return []

        # Handle rate limiting
        throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
        await handle_rate_limiting(throttle)

        nodes = data.get("data", {}).get("nodes", [])
        records = []

        for product_node in nodes:
            if not product_node:
                continue

            product_id = product_node["legacyResourceId"]
            status = product_node.get("status", None)
            vendor = product_node["vendor"]
            tags = product_node["tags"] or []
            tags_str = ",".join(tags)

            if MODE == 'wheels':
                # Extract all metafields (EXACT from original)
                meta_description = product_node["metaDescription"]["value"] if product_node.get("metaDescription") else None
                template_suffix = product_node.get("templateSuffix", None)
                model = product_node["customWheelModel"]["value"] if product_node.get("customWheelModel") else None
                finish = product_node["customFinish"]["value"] if product_node.get("customFinish") else None
                lug_count = product_node["customLugCount"]["value"] if product_node.get("customLugCount") else None
                diameter = product_node["convermaxWheelDiameter"]["value"] if product_node.get("convermaxWheelDiameter") else None
                width = product_node["convermaxWheelWidth"]["value"] if product_node.get("convermaxWheelWidth") else None
                offset = product_node["convermaxWheelOffset"]["value"] if product_node.get("convermaxWheelOffset") else None

                # Bolt pattern (list-like, needs JSON parsing)
                bolt_pattern_val = None
                bp_field = product_node.get("convermaxWheelBoltPattern")
                if bp_field and bp_field.get("value"):
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
                short_color = product_node["googleWheelColor"]["value"] if product_node.get("googleWheelColor") else None

                # primary_color (convermax.wheel_color) - list-like
                primary_color_val = None
                pc_field = product_node.get("convermaxWheelColor")
                if pc_field and pc_field.get("value"):
                    raw_pc = pc_field["value"]
                    try:
                        pc_list = json.loads(raw_pc)
                        if isinstance(pc_list, list):
                            primary_color_val = ",".join(map(str, pc_list))
                        else:
                            primary_color_val = raw_pc
                    except json.JSONDecodeError:
                        primary_color_val = raw_pc

                load_rating = product_node["customLoadRating"]["value"] if product_node.get("customLoadRating") else None
                weight = product_node["customWeight"]["value"] if product_node.get("customWeight") else None
                hub_bore = product_node["customHubBore"]["value"] if product_node.get("customHubBore") else None

                # Process variants
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

            else:  # tires
                # Tires are simpler - just basic fields
                for ve in product_node["variants"]["edges"]:
                    v_node = ve["node"]
                    variant_id = v_node["legacyResourceId"]
                    sku = v_node["sku"] or ""
                    price = v_node["price"] or "0.00"

                    record = {
                        "shopify_id": product_id,
                        "variant_id": variant_id,
                        "part_number": sku,
                        "brand": vendor,
                        "tags": tags_str,
                        "status": status,
                        "price": price
                    }
                    records.append(record)

        return records


# =============================================================================
# STEP 3: DATABASE UPSERT
# =============================================================================

async def batch_upsert_records(db_pool, records: List[Dict]) -> int:
    """
    UPSERT rows in all_shopify_wheels/shopify_tires (EXACT from original).

    Based on variant_id (unique key).
    """
    if not records:
        return 0

    table_name = 'all_shopify_wheels' if MODE == 'wheels' else 'shopify_tires'

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            if MODE == 'wheels':
                # EXACT upsert from original get_non_sdw_wheels.py
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
                        price = VALUES(price)
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
                        r["lug_count"],
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

            else:  # tires
                upsert_sql = """
                    INSERT INTO shopify_tires
                    (shopify_id, variant_id, part_number, brand, tags, status, price)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        shopify_id = VALUES(shopify_id),
                        part_number = VALUES(part_number),
                        brand = VALUES(brand),
                        tags = VALUES(tags),
                        status = VALUES(status),
                        price = VALUES(price)
                """
                params = []
                for r in records:
                    params.append((
                        r["shopify_id"],
                        r["variant_id"],
                        r["part_number"],
                        r["brand"],
                        r["tags"],
                        r["status"],
                        r["price"]
                    ))

            await cur.executemany(upsert_sql, params)
            await conn.commit()

    return len(records)


# =============================================================================
# STEP 4: DELETE STALE PRODUCTS
# =============================================================================

async def delete_stale_products(db_pool, active_product_ids: List[int]) -> int:
    """
    Delete products from table that are no longer on Shopify (EXACT from original).

    Based on shopify_id.
    """
    if not active_product_ids:
        logger.warning("⚠️  No active product IDs - skipping deletion")
        return 0

    table_name = 'all_shopify_wheels' if MODE == 'wheels' else 'shopify_tires'

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            # First, count stale products
            placeholders = ','.join(['%s'] * len(active_product_ids))
            count_sql = f"""
                SELECT COUNT(DISTINCT shopify_id)
                FROM {table_name}
                WHERE shopify_id NOT IN ({placeholders})
            """
            await cur.execute(count_sql, active_product_ids)
            result = await cur.fetchone()
            stale_count = result[0] if result else 0

            if stale_count == 0:
                logger.info("   ✅ No stale products found - database is up to date")
                return 0

            logger.info(f"   🗑️  Found {stale_count} stale products to delete")

            # Delete stale products
            delete_sql = f"""
                DELETE FROM {table_name}
                WHERE shopify_id NOT IN ({placeholders})
            """
            await cur.execute(delete_sql, active_product_ids)
            rows_deleted = cur.rowcount
            await conn.commit()

            logger.info(f"   ✅ Deleted {rows_deleted} rows for {stale_count} stale products")
            return rows_deleted


# =============================================================================
# MAIN SYNC FUNCTION
# =============================================================================

async def sync_shopify_products_table(session: aiohttp.ClientSession, db_pool):
    """
    Sync all_shopify_wheels or shopify_tires table (EXACT replica of original logic).

    Process:
    1. Gather all product IDs (lightweight query)
    2. Fetch product details in chunks (nodes query)
    3. UPSERT to database
    4. Delete stale products
    """
    logger.info("")
    logger.info("=" * 80)
    logger.info(f"SYNCING SHOPIFY PRODUCTS TABLE: {MODE}")
    logger.info("=" * 80)

    table_name = 'all_shopify_wheels' if MODE == 'wheels' else 'shopify_tires'
    start_time = time.time()

    try:
        # STEP 1: Gather all product IDs
        all_product_ids = await gather_all_product_ids(session)
        if not all_product_ids:
            logger.warning("⚠️  No products found - stopping sync")
            return 0

        # STEP 2: Fetch details in chunks
        logger.info("")
        logger.info(f"🔍 STEP 2: Fetching product details")
        logger.info(f"   Processing {len(all_product_ids)} products in chunks of 250")

        chunk_size = 250
        chunks = [all_product_ids[i:i+chunk_size] for i in range(0, len(all_product_ids), chunk_size)]
        logger.info(f"   Split into {len(chunks)} chunks")

        all_records = []
        for idx, chunk in enumerate(chunks):
            logger.info(f"   Processing chunk {idx+1}/{len(chunks)} ({len(chunk)} products)...")
            records = await fetch_product_details_chunk(session, chunk)
            all_records.extend(records)
            logger.info(f"   ✅ Chunk {idx+1}/{len(chunks)}: Extracted {len(records)} variant records")

        logger.info(f"✅ STEP 2 Complete: Extracted {len(all_records)} total variant records")

        # STEP 3: UPSERT to database
        logger.info("")
        logger.info(f"💾 STEP 3: Upserting to {table_name}")

        # Get existing variant IDs before upsert
        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(f"SELECT variant_id FROM {table_name}")
                existing_variant_ids = {row[0] for row in await cur.fetchall()}

        logger.info(f"   📊 Found {len(existing_variant_ids)} existing variant records in {table_name}")

        # Do the upsert
        upserted_count = await batch_upsert_records(db_pool, all_records)

        # Calculate inserts vs updates
        new_variant_ids = {r["variant_id"] for r in all_records}
        inserted_count = len(new_variant_ids - existing_variant_ids)
        updated_count = upserted_count - inserted_count

        logger.info(f"✅ STEP 3 Complete:")
        logger.info(f"   📥 Inserted: {inserted_count} new records")
        logger.info(f"   🔄 Updated: {updated_count} existing records")
        logger.info(f"   📊 Total upserted: {upserted_count}")

        # STEP 4: Delete stale products
        logger.info("")
        logger.info(f"🗑️  STEP 4: Cleaning up stale products")
        deleted_count = await delete_stale_products(db_pool, all_product_ids)

        # Final stats
        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                final_count = (await cur.fetchone())[0]

        duration = time.time() - start_time
        logger.info("")
        logger.info(f"✅ SYNC COMPLETE in {duration:.1f}s:")
        logger.info(f"   📥 Inserted: {inserted_count}")
        logger.info(f"   🔄 Updated: {updated_count}")
        logger.info(f"   🗑️  Deleted: {deleted_count}")
        logger.info(f"   📊 Final count in {table_name}: {final_count}")
        logger.info("=" * 80)

        return final_count

    except Exception as e:
        logger.error(f"❌ Error syncing Shopify products table: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return 0
