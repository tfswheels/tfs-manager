"""
Shopify Operations Module

Handles all Shopify GraphQL operations including:
- Table synchronization (all_shopify_wheels, shopify_tires)
- Product creation
- Rate limiting
- Error handling
"""

import asyncio
import aiohttp
import time
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

# Rate limiting thresholds
THROTTLE_THRESHOLD = 120
MAX_AVAILABLE = 2000


async def handle_rate_limiting(throttle_status: Dict):
    """Handle Shopify GraphQL rate limiting."""
    if not throttle_status:
        return

    currently_available = throttle_status.get('currentlyAvailable', MAX_AVAILABLE)
    restore_rate = throttle_status.get('restoreRate', 100.0)

    if currently_available < THROTTLE_THRESHOLD:
        needed = MAX_AVAILABLE - currently_available
        wait_time = needed / restore_rate
        logger.info(f"[RateLimit] Points low ({currently_available}), waiting {wait_time:.2f}s...")
        await asyncio.sleep(wait_time)


async def sync_shopify_products_table(session: aiohttp.ClientSession, db_pool):
    """
    Sync all_shopify_wheels or shopify_tires table with current Shopify state.

    Uses UPSERT logic:
    - Fetch ALL products from Shopify
    - UPDATE existing records
    - INSERT new records
    - DELETE products no longer on Shopify
    """
    logger.info("")
    logger.info("=" * 80)
    logger.info(f"SYNCING SHOPIFY PRODUCTS TABLE: {MODE}")
    logger.info("=" * 80)

    table_name = 'all_shopify_wheels' if MODE == 'wheels' else 'shopify_tires'
    start_time = time.time()

    try:
        # Fetch all products from Shopify using GraphQL
        all_shopify_products = []
        has_next_page = True
        cursor = None
        page_count = 0

        while has_next_page:
            page_count += 1

            # Build query with cursor for pagination
            if cursor:
                products_query = f'first: 250, after: "{cursor}"'
            else:
                products_query = 'first: 250'

            # Query by product type
            product_type_filter = MODE[:-1]  # 'wheels' -> 'wheel', 'tires' -> 'tire'

            logger.info(f"📡 Fetching Shopify products page {page_count} with filter: product_type={product_type_filter}")

            query = f"""
            query {{
              products({products_query}, query: "product_type:{product_type_filter}") {{
                edges {{
                  node {{
                    id
                    title
                    vendor
                    productType
                    tags
                    status
                    variants(first: 1) {{
                      edges {{
                        node {{
                          id
                          sku
                          price
                          inventoryQuantity
                        }}
                      }}
                    }}
                  }}
                  cursor
                }}
                pageInfo {{
                  hasNextPage
                }}
              }}
            }}
            """

            headers = {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
            }

            logger.debug(f"GraphQL Query: {query[:200]}...")  # Log first 200 chars of query

            async with session.post(SHOPIFY_STORE_URL, headers=headers, json={"query": query}) as resp:
                response_status = resp.status
                logger.debug(f"Shopify API response status: {response_status}")

                data = await resp.json()

                # Log the full response for debugging (first page only)
                if page_count == 1:
                    logger.debug(f"First page response keys: {list(data.keys())}")
                    if 'data' in data:
                        logger.debug(f"Data keys: {list(data.get('data', {}).keys())}")

                # Handle rate limiting
                throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
                if throttle:
                    logger.debug(f"Rate limit status: {throttle.get('currentlyAvailable')}/{throttle.get('maximumAvailable')}")
                await handle_rate_limiting(throttle)

                if 'errors' in data:
                    logger.error(f"❌ Shopify GraphQL errors: {data['errors']}")
                    break

                edges = data.get("data", {}).get("products", {}).get("edges", [])
                logger.info(f"  ✅ Page {page_count}: Received {len(edges)} products")

                for edge in edges:
                    node = edge.get("node", {})
                    variant = node.get("variants", {}).get("edges", [{}])[0].get("node", {})

                    product_data = {
                        'shopify_id': int(node['id'].split('/')[-1]),
                        'variant_id': int(variant.get('id', '').split('/')[-1]) if variant.get('id') else None,
                        'brand': node.get('vendor', ''),
                        'part_number': variant.get('sku', ''),
                        'title': node.get('title', ''),
                        'tags': ','.join(node.get('tags', [])),
                        'price': float(variant.get('price', 0)),
                        'status': node.get('status', ''),
                        'product_type': node.get('productType', ''),
                    }
                    all_shopify_products.append(product_data)
                    cursor = edge.get("cursor")

                    # Log first product of first page for verification
                    if page_count == 1 and len(all_shopify_products) == 1:
                        logger.info(f"  📦 Sample product: {product_data['brand']} {product_data['part_number']} (Shopify ID: {product_data['shopify_id']})")

                has_next_page = data.get("data", {}).get("products", {}).get("pageInfo", {}).get("hasNextPage", False)
                logger.debug(f"Has next page: {has_next_page}")

        logger.info(f"✅ Fetched {len(all_shopify_products)} products from Shopify in {page_count} pages")

        if len(all_shopify_products) == 0:
            logger.warning("⚠️  No products fetched from Shopify - skipping database sync")
            logger.warning("   This could mean:")
            logger.warning(f"   1. No products with product_type='{product_type_filter}' exist on Shopify")
            logger.warning("   2. The GraphQL query filter is incorrect")
            logger.warning("   3. There's a permissions issue with the access token")
            return

        # Now UPSERT into database table
        logger.info(f"💾 Syncing {len(all_shopify_products)} products to {table_name} table...")
        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Get current shopify_ids in table
                await cur.execute(f"SELECT shopify_id FROM {table_name}")
                existing_ids = {row[0] for row in await cur.fetchall()}
                logger.info(f"  📊 Found {len(existing_ids)} existing products in {table_name}")

                # Track what we're doing
                inserted_count = 0
                updated_count = 0

                # UPSERT each product
                logger.debug(f"Starting UPSERT operations...")
                for product in all_shopify_products:
                    if MODE == 'wheels':
                        upsert_query = """
                        INSERT INTO all_shopify_wheels
                        (shopify_id, variant_id, vendor, part_number, title, tags, price, status, product_type)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            variant_id = VALUES(variant_id),
                            vendor = VALUES(vendor),
                            part_number = VALUES(part_number),
                            title = VALUES(title),
                            tags = VALUES(tags),
                            price = VALUES(price),
                            status = VALUES(status),
                            product_type = VALUES(product_type)
                        """
                        values = (
                            product['shopify_id'], product['variant_id'], product['brand'],
                            product['part_number'], product['title'], product['tags'],
                            product['price'], product['status'], product['product_type']
                        )
                    else:  # tires
                        upsert_query = """
                        INSERT INTO shopify_tires
                        (shopify_id, variant_id, brand, part_number, title, tags, price, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            variant_id = VALUES(variant_id),
                            brand = VALUES(brand),
                            part_number = VALUES(part_number),
                            title = VALUES(title),
                            tags = VALUES(tags),
                            price = VALUES(price),
                            status = VALUES(status)
                        """
                        values = (
                            product['shopify_id'], product['variant_id'], product['brand'],
                            product['part_number'], product['title'], product['tags'],
                            product['price'], product['status']
                        )

                    await cur.execute(upsert_query, values)

                    if product['shopify_id'] in existing_ids:
                        updated_count += 1
                    else:
                        inserted_count += 1

                # Delete products that no longer exist on Shopify
                shopify_ids = {p['shopify_id'] for p in all_shopify_products}
                deleted_ids = existing_ids - shopify_ids

                deleted_count = 0
                if deleted_ids:
                    logger.info(f"  🗑️  Deleting {len(deleted_ids)} products no longer on Shopify")
                    placeholders = ','.join(['%s'] * len(deleted_ids))
                    delete_query = f"DELETE FROM {table_name} WHERE shopify_id IN ({placeholders})"
                    await cur.execute(delete_query, tuple(deleted_ids))
                    deleted_count = len(deleted_ids)

                await conn.commit()
                logger.debug("Database commit successful")

                # Get final count
                await cur.execute(f"SELECT COUNT(*) FROM {table_name}")
                final_count = (await cur.fetchone())[0]

        duration = time.time() - start_time
        logger.info("")
        logger.info(f"✅ Shopify sync complete in {duration:.1f}s:")
        logger.info(f"  📥 Inserted: {inserted_count}")
        logger.info(f"  🔄 Updated: {updated_count}")
        logger.info(f"  🗑️  Deleted: {deleted_count}")
        logger.info(f"  📊 Total in table: {final_count}")
        logger.info("=" * 80)

        return len(all_shopify_products)

    except Exception as e:
        logger.error(f"Error syncing Shopify products table: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return 0


async def create_product_on_shopify_OLD_BROKEN(session: aiohttp.ClientSession, product_data: Dict) -> Optional[Dict]:
    """
    Create a product on Shopify using GraphQL.

    Args:
        session: aiohttp session
        product_data: Dict with product fields (title, vendor, sku, price, etc.)

    Returns:
        Dict with shopify_id, variant_id, handle if successful, None if failed
    """
    try:
        # STEP 1: Create product (without variants - they're auto-created)
        mutation = """
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              handle
              variants(first: 1) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
        """

        # Prepare input (NO variants field - not allowed in ProductInput)
        variables = {
            "input": {
                "title": product_data.get('title'),
                "vendor": product_data.get('vendor'),
                "productType": product_data.get('product_type', MODE[:-1]),  # 'wheel' or 'tire'
                "tags": product_data.get('tags', []),
                "status": "ACTIVE"
            }
        }

        # Add images if provided
        if product_data.get('images'):
            variables["input"]["images"] = [
                {"src": img_url} for img_url in product_data['images']
            ]

        headers = {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
        }

        async with session.post(SHOPIFY_STORE_URL, headers=headers, json={"query": mutation, "variables": variables}) as resp:
            data = await resp.json()

            # Handle rate limiting
            throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            await handle_rate_limiting(throttle)

            if 'errors' in data:
                logger.error(f"Shopify GraphQL errors: {data['errors']}")
                return None

            create_result = data.get("data", {}).get("productCreate", {})
            user_errors = create_result.get("userErrors", [])

            if user_errors:
                logger.error(f"Shopify product creation errors: {user_errors}")
                return None

            product = create_result.get("product", {})
            variant = product.get("variants", {}).get("edges", [{}])[0].get("node", {})

            if not variant.get('id'):
                logger.error("Product created but no variant ID returned")
                return None

            result = {
                'shopify_id': int(product['id'].split('/')[-1]),
                'variant_id': int(variant['id'].split('/')[-1]),
                'handle': product.get('handle', '')
            }

            # STEP 2: Update the auto-created variant with SKU, price, and inventory settings
            update_mutation = """
            mutation productVariantUpdate($input: ProductVariantInput!) {
              productVariantUpdate(input: $input) {
                productVariant {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
            """

            update_variables = {
                "input": {
                    "id": variant['id'],  # Full GID like "gid://shopify/ProductVariant/123"
                    "sku": product_data.get('sku'),
                    "price": str(product_data.get('price', 0)),
                    "inventoryPolicy": "DENY",
                    "inventoryManagement": "SHOPIFY"
                }
            }

            async with session.post(SHOPIFY_STORE_URL, headers=headers, json={"query": update_mutation, "variables": update_variables}) as update_resp:
                update_data = await update_resp.json()

                # Handle rate limiting
                update_throttle = update_data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
                await handle_rate_limiting(update_throttle)

                if 'errors' in update_data:
                    logger.warning(f"Failed to update variant SKU/price: {update_data['errors']}")
                    # Product still created, just variant not updated
                else:
                    update_errors = update_data.get("data", {}).get("productVariantUpdate", {}).get("userErrors", [])
                    if update_errors:
                        logger.warning(f"Variant update errors: {update_errors}")

            logger.info(f"✅ Created product on Shopify: {product_data.get('title')} (ID: {result['shopify_id']})")
            return result

    except Exception as e:
        logger.error(f"Exception creating product on Shopify: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None
