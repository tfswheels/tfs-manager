"""
Product Discovery Module

Identifies new products during scraping and extracts full product data.
"""

import asyncio
import aiohttp
import re
from typing import Dict, List, Set, Optional, Tuple
from bs4 import BeautifulSoup

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import (
        MODE,
        MAX_CONCURRENT_PRODUCT_EXTRACTIONS,
        logger
    )
    from .scraper_core import extract_klaviyo_product, fetch_page
except ImportError:
    from config import (
        MODE,
        MAX_CONCURRENT_PRODUCT_EXTRACTIONS,
        logger
    )
    from scraper_core import extract_klaviyo_product, fetch_page


# =============================================================================
# PRODUCT EXISTENCE CHECKING
# =============================================================================

async def check_product_exists_in_shopify_table(db_pool, url_part_number: str) -> bool:
    """Check if product exists in all_shopify_wheels or shopify_tires table."""
    table_name = 'all_shopify_wheels' if MODE == 'wheels' else 'shopify_tires'

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Check by part_number (which is the SKU/url_part_number)
            query = f"SELECT 1 FROM {table_name} WHERE part_number = %s LIMIT 1"
            await cur.execute(query, (url_part_number,))
            result = await cur.fetchone()
            return result is not None


async def check_product_exists_in_shopify_products(db_pool, url_part_number: str) -> bool:
    """Check if product exists in shopify_products table."""
    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            query = "SELECT 1 FROM shopify_products WHERE url_part_number = %s AND product_type = %s LIMIT 1"
            await cur.execute(query, (url_part_number, MODE[:-1]))  # 'wheels' -> 'wheel'
            result = await cur.fetchone()
            return result is not None


async def check_product_in_main_table(db_pool, url_part_number: str) -> Optional[str]:
    """
    Check if product exists in wheels/tires table.

    Returns:
        None if doesn't exist
        'synced' if exists and product_sync='synced'
        'error' if exists and product_sync='error'
        'pending' if exists and product_sync='pending'
    """
    table_name = MODE  # 'wheels' or 'tires'

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            # url_part_number is unique for CWO products, no need for supplier filter
            query = f"SELECT product_sync FROM {table_name} WHERE url_part_number = %s LIMIT 1"
            await cur.execute(query, (url_part_number,))
            result = await cur.fetchone()

            if result is None:
                return None
            return result[0]


async def get_failed_products_for_retry(db_pool, max_retries: int = 3) -> List[Dict]:
    """
    Get products from wheels/tires table that need retry (product_sync='error' or 'pending').

    Returns products with FULL data from database (no need to re-scrape).
    Only returns products that haven't exceeded max_retries.

    Args:
        db_pool: Database connection pool
        max_retries: Maximum retry attempts (default: 3)
    """
    table_name = MODE

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Get ALL fields for failed products - they already have complete data
            # Include sync_error to check retry count
            if MODE == 'wheels':
                query = f"""
                SELECT
                    url_part_number, brand, part_number, model, model_other, size,
                    diameter, width, bolt_pattern, bolt_pattern2, offset, backspace,
                    finish, short_color, primary_color, hub_bore, load_rating, weight,
                    available_finishes, available_bolt_patterns, image, map_price, quantity,
                    supplier, status, custom_build, sync_error
                FROM {table_name}
                WHERE product_sync IN ('error', 'pending')
                  AND url_part_number IS NOT NULL
                  AND url_part_number != ''
                ORDER BY last_modified ASC
                """
            else:  # tires
                query = f"""
                SELECT
                    url_part_number, brand, part_number, model, size, image1, image2, image3,
                    map_price, quantity, weight, supplier, sync_error
                FROM {table_name}
                WHERE product_sync IN ('error', 'pending')
                  AND url_part_number IS NOT NULL
                  AND url_part_number != ''
                ORDER BY last_modified ASC
                """

            await cur.execute(query)
            results = await cur.fetchall()

            logger.info(f"📦 Found {len(results)} failed products in {table_name} table (checking retry limits...)")

            products = []
            skipped_max_retries = 0

            for row in results:
                # Parse retry count from sync_error field
                sync_error = row[26] if MODE == 'wheels' else row[12]
                retry_count = 0
                if sync_error:
                    # Parse "(attempt X)" from error message
                    import re
                    match = re.search(r'\(attempt (\d+)\)', sync_error)
                    if match:
                        retry_count = int(match.group(1))

                # Skip if exceeded max retries
                if retry_count >= max_retries:
                    skipped_max_retries += 1
                    continue

                if MODE == 'wheels':
                    # Map database row to product dict with klaviyo-like structure
                    products.append({
                        'url_part_number': row[0],
                        'brand': row[1],
                        'part_number': row[2],
                        'quantity': row[22] or 0,
                        'retry_count': retry_count,  # Track current retry count
                        'extracted_data': {
                            'klaviyo_data': {
                                'partnumber': row[2],
                                'brand': row[1],
                                'model': row[3],
                                'modelOther': row[4],
                                'size': row[5],
                                'wheelsize': row[6],  # diameter
                                'wheelwidth': row[7],  # width
                                'boltpattern': row[8],
                                'boltpattern2': row[9],
                                'offset': row[10],
                                'backspace': row[11],
                                'colorlong': row[12],  # finish
                                'colorshort': row[13],  # short_color
                                'color': row[14],  # primary_color
                                'hubbore': row[15],
                                'loadrating': row[16],
                                'weight': row[17],
                                'supplier': row[23],  # actual manufacturer
                                'status': row[24],
                                'custom': row[25],
                            },
                            'images': [row[20]] if row[20] else [],  # image already processed/uploaded
                            'available_finishes': row[18],
                            'available_bolt_patterns': row[19],
                            'html': None,  # Not needed for retry
                        },
                        'map_price': row[21],
                    })
                else:  # tires
                    products.append({
                        'url_part_number': row[0],
                        'brand': row[1],
                        'part_number': row[2],
                        'quantity': row[9] or 0,
                        'retry_count': retry_count,  # Track current retry count
                        'extracted_data': {
                            'klaviyo_data': {
                                'inventoryNumber': row[2],
                                'brand': row[1],
                                'model': row[3],
                                'size': row[4],
                                'weight': row[10],
                                'supplier': row[11],
                            },
                            'images': [img for img in [row[5], row[6], row[7]] if img],  # image1, image2, image3
                            'html': None,
                        },
                        'map_price': row[8],
                    })

            if skipped_max_retries > 0:
                logger.warning(f"⚠️  Skipped {skipped_max_retries} products that exceeded {max_retries} retry attempts")

            logger.info(f"📦 Loaded {len(products)} products eligible for retry (no re-scraping needed)")
            return products


# =============================================================================
# PRODUCT DATA EXTRACTION
# =============================================================================

async def extract_product_page_data(session: aiohttp.ClientSession, product_url: str, cookies: List[Dict]) -> Optional[Dict]:
    """
    Fetch product page and extract Klaviyo data + images.

    Returns:
        Dict with extracted data or None if failed
    """
    try:
        logger.debug(f"Fetching product page: {product_url}")

        # Fetch page HTML
        html = await fetch_page(session, product_url, cookies)

        if not html:
            logger.warning(f"Failed to fetch product page: {product_url}")
            return None

        # Check if we got redirected to a collection page
        if '/store/wheels' in html or '/store/tires' in html:
            if 'product-card-a' in html:  # Collection page has product cards
                logger.warning(f"Redirected to collection page: {product_url}")
                return None

        # Extract Klaviyo data
        klaviyo_data_list = extract_klaviyo_product(html)

        if not klaviyo_data_list or len(klaviyo_data_list) == 0:
            logger.warning(f"No Klaviyo data found: {product_url}")
            logger.debug(f"HTML length: {len(html)} characters")
            # Save HTML for debugging if Klaviyo extraction fails
            try:
                import os
                debug_dir = os.path.join(os.path.dirname(__file__), 'debug_html')
                os.makedirs(debug_dir, exist_ok=True)
                url_slug = product_url.split('/')[-1][:50]
                html_file = os.path.join(debug_dir, f'{url_slug}.html')
                with open(html_file, 'w', encoding='utf-8') as f:
                    f.write(html)
                logger.info(f"Saved HTML for debugging: {html_file}")
            except Exception as e:
                logger.debug(f"Could not save debug HTML: {e}")
            return None

        # Get first product from Klaviyo data
        klaviyo_data = klaviyo_data_list[0]
        logger.info(f"✅ Klaviyo data extracted: brand={klaviyo_data.get('brand')}, model={klaviyo_data.get('model')}, partnumber={klaviyo_data.get('partnumber')}")

        # Check if product is discontinued - skip if so
        status = klaviyo_data.get('status', '').lower()
        if status == 'discontinued':
            logger.info(f"Skipping discontinued product: {product_url}")
            return None

        # Extract images from page using original SDW scraper logic
        soup = BeautifulSoup(html, 'html.parser')
        images = []

        # Original working logic: Find gallery-slider-wrap div
        gallery_slider = soup.find('div', id='gallery-slider-wrap')

        if gallery_slider:
            logger.debug(f"Found gallery-slider-wrap div")
            img_tags = gallery_slider.find_all('img')
            logger.info(f"Found {len(img_tags)} images in gallery-slider-wrap")

            # Determine the expected image folder based on MODE
            expected_folder = f"https://images.customwheeloffset.com/{MODE}-compressed/"

            # For tires, extract up to 3 images; for wheels, extract 1
            max_images = 3 if MODE == 'tires' else 1

            for img in img_tags:
                if len(images) >= max_images:
                    break  # Stop when we have enough images

                # Check data-srcset first, then src
                srcset = img.get('data-srcset') or img.get('src')
                if srcset and expected_folder in srcset:
                    # Handle srcset format (comma-separated URLs with sizes)
                    srcs = [s.strip().split(' ')[0] for s in srcset.split(',')]
                    for src in srcs:
                        if expected_folder in src and src not in images:
                            images.append(src)
                            logger.info(f"✅ Found product image #{len(images)} in gallery slider: {src}")
                            break  # Take first valid image from this srcset
        else:
            logger.warning(f"No gallery-slider-wrap found on page: {product_url}")

        logger.info(f"📸 FINAL: Extracted {len(images)} image(s) from product page")

        # Extract available finishes/bolt patterns from DOM if present
        available_finishes = []
        available_bolt_patterns = []

        if MODE == 'wheels':
            finish_select = soup.find('select', {'id': re.compile(r'finish|color', re.I)})
            if finish_select:
                options = finish_select.find_all('option')
                available_finishes = [opt.get_text(strip=True) for opt in options if opt.get('value')]

            bolt_pattern_select = soup.find('select', {'id': re.compile(r'bolt.*pattern|drilling', re.I)})
            if bolt_pattern_select:
                options = bolt_pattern_select.find_all('option')
                available_bolt_patterns = [opt.get_text(strip=True) for opt in options if opt.get('value')]

        return {
            'klaviyo_data': klaviyo_data,
            'images': images,
            'available_finishes': ','.join(available_finishes) if available_finishes else None,
            'available_bolt_patterns': ','.join(available_bolt_patterns) if available_bolt_patterns else None,
            'html': html,  # Store HTML for map_price extraction later
        }

    except Exception as e:
        logger.error(f"Error extracting product page data: {product_url} - {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return None


async def discover_new_products(session: aiohttp.ClientSession, db_pool, scraped_products: List[Dict], cookies: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """
    Analyze scraped products and identify which ones need to be created.

    Args:
        session: aiohttp session
        db_pool: Database connection pool
        scraped_products: List of products from CWO scraping
        cookies: Authentication cookies

    Returns:
        Tuple of (discovery_queue, retry_queue)
        - discovery_queue: New products to create
        - retry_queue: Existing products to retry
    """
    logger.info("")
    logger.info("=" * 80)
    logger.info("DISCOVERING NEW PRODUCTS")
    logger.info("=" * 80)

    discovery_queue = []
    retry_queue = []

    # Get failed products for retry
    failed_products = await get_failed_products_for_retry(db_pool)
    logger.info(f"Found {len(failed_products)} products to retry from previous runs")

    # Extract all URL part numbers
    url_part_numbers = [p.get('url_part_number') for p in scraped_products if p.get('url_part_number')]

    if not url_part_numbers:
        logger.warning("No valid URL part numbers in scraped products")
        return discovery_queue, retry_queue

    logger.info(f"Checking {len(url_part_numbers)} products against database (batched)...")

    # BATCHED Check 1: Get all existing products from Shopify table
    shopify_table_name = 'all_shopify_wheels' if MODE == 'wheels' else 'shopify_tires'
    existing_in_shopify = set()

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ','.join(['%s'] * len(url_part_numbers))
            query = f"SELECT part_number FROM {shopify_table_name} WHERE part_number IN ({placeholders})"
            await cur.execute(query, url_part_numbers)
            results = await cur.fetchall()
            existing_in_shopify = {row[0] for row in results}

    logger.info(f"  - Found {len(existing_in_shopify)} products in {shopify_table_name}")

    # BATCHED Check 2: Get all existing products from shopify_products
    existing_in_shopify_products = set()

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ','.join(['%s'] * len(url_part_numbers))
            query = f"SELECT url_part_number FROM shopify_products WHERE url_part_number IN ({placeholders}) AND product_type = %s"
            await cur.execute(query, url_part_numbers + [MODE[:-1]])  # 'wheels' -> 'wheel'
            results = await cur.fetchall()
            existing_in_shopify_products = {row[0] for row in results}

    logger.info(f"  - Found {len(existing_in_shopify_products)} products in shopify_products")

    # BATCHED Check 3: Get all products from main table with sync status
    main_table_name = MODE  # 'wheels' or 'tires'
    sync_statuses = {}

    async with db_pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ','.join(['%s'] * len(url_part_numbers))
            # url_part_number is unique for CWO products, no need for supplier filter
            query = f"SELECT url_part_number, product_sync FROM {main_table_name} WHERE url_part_number IN ({placeholders})"
            await cur.execute(query, url_part_numbers)
            results = await cur.fetchall()
            sync_statuses = {row[0]: row[1] for row in results}

    logger.info(f"  - Found {len(sync_statuses)} products in {main_table_name} table")

    # Now categorize each product
    for product in scraped_products:
        url_part_number = product.get('url_part_number')

        if not url_part_number:
            continue

        # Check 1: Already on Shopify (in dedicated table)?
        if url_part_number in existing_in_shopify:
            logger.debug(f"Product exists in Shopify table: {url_part_number}")
            continue

        # Check 2: Already tracked in shopify_products?
        if url_part_number in existing_in_shopify_products:
            logger.debug(f"Product exists in shopify_products: {url_part_number}")
            continue

        # Check 3: In wheels/tires table?
        sync_status = sync_statuses.get(url_part_number)

        if sync_status is None:
            # New product - add to discovery queue
            discovery_queue.append(product)
        elif sync_status in ['error', 'pending']:
            # Failed/pending product - add to retry queue
            retry_queue.append(product)
        else:  # 'synced'
            # Already successfully synced
            logger.debug(f"Product already synced: {url_part_number}")
            continue

    logger.info(f"Discovery results:")
    logger.info(f"  - New products to create: {len(discovery_queue)}")
    logger.info(f"  - Products to retry: {len(retry_queue)}")
    logger.info(f"  - Failed products from DB: {len(failed_products)}")
    logger.info("=" * 80)

    # Add failed products from DB to retry queue
    retry_queue.extend(failed_products)

    return discovery_queue, retry_queue


async def extract_product_data_batch(session: aiohttp.ClientSession, products: List[Dict], cookies: List[Dict], stats: Optional[Dict] = None) -> List[Dict]:
    """
    Extract full product data for a batch of products (concurrent).

    Args:
        session: aiohttp session
        products: List of product dicts with 'url' field
        cookies: Authentication cookies
        stats: Optional stats dict to update

    Returns:
        List of product dicts with extracted data
    """
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_PRODUCT_EXTRACTIONS)
    discontinued_count = 0

    async def extract_with_semaphore(product):
        nonlocal discontinued_count
        async with semaphore:
            url = product.get('url')
            if not url:
                return None

            extracted_data = await extract_product_page_data(session, url, cookies)

            if extracted_data:
                # Check if product was skipped due to discontinued status
                # (extract_product_page_data returns None for discontinued products)
                # Merge extracted data with original product data
                product['extracted_data'] = extracted_data
                return product
            else:
                return None

    logger.info(f"Extracting data from {len(products)} product pages...")

    tasks = [extract_with_semaphore(product) for product in products]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out None and exceptions, count discontinued
    extracted_products = []
    for i, result in enumerate(results):
        if result is not None and not isinstance(result, Exception):
            extracted_products.append(result)
        elif result is None:
            # Check if it was discontinued by looking at the product URL
            # We already logged it in extract_product_page_data
            discontinued_count += 1
        elif isinstance(result, Exception):
            logger.error(f"Exception during extraction: {result}")

    # Update stats if provided
    if stats is not None:
        stats['products_skipped_discontinued'] = stats.get('products_skipped_discontinued', 0) + discontinued_count

    logger.info(f"Successfully extracted {len(extracted_products)} / {len(products)} products")
    if discontinued_count > 0:
        logger.info(f"  Skipped {discontinued_count} discontinued products")

    return extracted_products
