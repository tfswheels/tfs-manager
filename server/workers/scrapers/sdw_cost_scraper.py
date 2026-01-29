#!/usr/bin/env python3
"""
SDW Cost Scraper - Scrapes inventory costs from sdwheelwholesale.com

Scrapes cost data for wheels and tires from SDW Wheel Wholesale (behind login).
Updates sdw_cost column in shopify_products table (tfs-db database).

Usage:
    python sdw_cost_scraper.py --wheels
    python sdw_cost_scraper.py --tires
    python sdw_cost_scraper.py --wheels --headed  # Run with visible browser
"""

import asyncio
import re
import time
import sys
import os
from typing import Dict, List, Optional, Set
from dataclasses import dataclass
from bs4 import BeautifulSoup
from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
import logging
from collections import defaultdict
import aiomysql

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import db_client

# =============================================================================
# LOGGING CONFIGURATION
# =============================================================================

class InfoFilter(logging.Filter):
    """Filter to send INFO/DEBUG to stdout, WARNING/ERROR to stderr"""
    def filter(self, record):
        return record.levelno <= logging.INFO

# Create handlers
stdout_handler = logging.StreamHandler(sys.stdout)
stdout_handler.setLevel(logging.DEBUG)
stdout_handler.addFilter(InfoFilter())

stderr_handler = logging.StreamHandler(sys.stderr)
stderr_handler.setLevel(logging.WARNING)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[stdout_handler, stderr_handler]
)
logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

MODE = 'wheels'  # 'wheels' or 'tires'
HEADLESS = True

# Parse command line arguments
if '--wheels' in sys.argv:
    MODE = 'wheels'
if '--tires' in sys.argv:
    MODE = 'tires'
if '--headed' in sys.argv:
    HEADLESS = False

TARGET = f'https://www.sdwheelwholesale.com/store/{MODE}'
EMAIL = "jeremiah@autopartspalace.com"
PASS = "K7}@e)G?d0Gq"

PRODUCT_TYPE = 'wheel' if MODE == 'wheels' else 'tire'

# Scraping configuration
SCRAPING_MODE = os.environ.get('SCRAPING_MODE', 'hybrid').lower()
HYBRID_RETRY_COUNT = int(os.environ.get('HYBRID_RETRY_COUNT', '3'))
MAX_CONSECUTIVE_BACKORDERS = int(os.environ.get('BACKORDER_COUNT', '5'))
ZENROWS_API_KEY = os.environ.get('ZENROWS_API_KEY', '1952d3d9f407cef089c0871d5d37d426fe78546e')

# Concurrency configuration
MAX_CONCURRENT_BRANDS = 1  # Process 1 brand at a time (Selenium driver not thread-safe)
PAGES_PER_BRAND_CONCURRENT = 1  # Scrape 1 page at a time (sequential)

# Database configuration
DB_BATCH_SIZE = 100  # Insert in chunks of 100
DB_CONFIG = {
    'host': os.getenv('DB_HOST', '34.67.162.140'),
    'user': os.getenv('DB_USER', 'tfs'),
    'password': os.getenv('DB_PASSWORD', '[XtlAUU5;"1Ti*Ry'),
    'db': 'tfs-db',  # shopify_products table is in tfs-db
    'port': int(os.getenv('DB_PORT', 3306)),
    'maxsize': 20,
    'minsize': 5
}

# Brand filtering
EXCLUDED_BRANDS = []
SPECIFIC_BRANDS = []

try:
    import json
    if os.environ.get('EXCLUDED_BRANDS'):
        EXCLUDED_BRANDS = json.loads(os.environ.get('EXCLUDED_BRANDS'))
    if os.environ.get('SPECIFIC_BRANDS'):
        SPECIFIC_BRANDS = json.loads(os.environ.get('SPECIFIC_BRANDS'))
except:
    pass

# =============================================================================
# STATISTICS
# =============================================================================

stats = {
    'brands_processed': 0,
    'brands_skipped': 0,
    'pages_scraped': 0,
    'products_found': 0,
    'costs_updated': 0,
    'errors': 0,
    'backorder_stops': 0,
    'direct_requests': 0,
    'zenrows_requests': 0
}

# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class BrandState:
    """Track state for a brand during scraping"""
    brand: str
    known_url_parts: Set[str]
    all_products: List[Dict]
    consecutive_backorders: int = 0
    stopped: bool = False

# =============================================================================
# DRIVER MANAGEMENT
# =============================================================================

def get_driver():
    """Create a new Selenium driver instance"""
    driver = Driver(uc=True, headless=HEADLESS)
    # Set page load timeout to prevent infinite hangs
    driver.set_page_load_timeout(30)
    return driver

# =============================================================================
# LOGIN
# =============================================================================

async def get_login_cookie() -> Optional[Dict]:
    """Login to SDW and retrieve access token cookie"""
    driver = None
    try:
        logger.info("Logging in to SDW Wheel Wholesale...")
        driver = get_driver()
        driver.get('https://www.sdwheelwholesale.com/auth/login')

        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.ID, "login-email")))

        driver.find_element(By.ID, "login-email").send_keys(EMAIL)
        driver.find_element(By.ID, "login-pass").send_keys(PASS)
        driver.find_element(By.ID, "submit-btn").click()

        WebDriverWait(driver, 20).until(lambda d: "auth/login" not in d.current_url)
        logger.info("✓ Login successful")

        cookies = driver.get_cookies()
        access_token = next((c for c in cookies if c['name'] == 'accessToken'), None)

        if access_token:
            return {
                'name': 'accessToken',
                'value': access_token['value'],
                'domain': 'www.sdwheelwholesale.com',
                'path': '/',
            }
        else:
            raise RuntimeError("No access token found after login.")
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise
    finally:
        if driver:
            driver.quit()

# =============================================================================
# BRAND EXTRACTION
# =============================================================================

def get_brands(soup: BeautifulSoup) -> List[str]:
    """Extract brand list from page"""
    brands = []
    brand_list = soup.find('ul', attrs={'data-type': 'brand', 'data-cat': 'Brand'})
    if not brand_list:
        logger.error("Could not find brand list container")
        return brands

    for link in brand_list.find_all('a', class_='filter'):
        brand_name = link.get('data-filter')
        if brand_name:
            brands.append(brand_name.strip())

    logger.info(f"Found {len(brands)} brands on page")
    return brands

# =============================================================================
# COST SCRAPING
# =============================================================================

def scrape_page_costs(html: str, brand: str) -> List[Dict]:
    """Scrape cost data from a page"""
    soup = BeautifulSoup(html, 'html.parser')
    products = []

    pattern = r'/buy-wheel-offset/([^/]+)/' if PRODUCT_TYPE == 'wheel' else r'/buy-wheel-offset2/([^/]+)/'

    for card in soup.select('.product-card'):
        try:
            link = card.select_one('a.product-card-a')
            if not link or 'href' not in link.attrs:
                continue

            match = re.search(pattern, link['href'])
            if not match:
                continue

            url_part = match.group(1)

            # Extract cost
            cost = ''
            cost_elem = card.select_one('.current-price')
            if cost_elem:
                cost_text = cost_elem.text.strip()
                cost_match = re.search(r'([0-9,]+\.?[0-9]*)', cost_text)
                if cost_match:
                    cost = cost_match.group(1).replace(',', '')

            # Detect backorder status (same as inventory scraper)
            backorder_elem = card.select_one('.product-backorder')
            is_backorder = backorder_elem is not None

            products.append({
                'brand': brand,
                'url_part_number': url_part,
                'cost': cost,
                'is_backorder': is_backorder
            })

        except Exception as e:
            logger.debug(f"Error processing product card: {e}")
            continue

    return products

# =============================================================================
# PAGE FETCHING
# =============================================================================

def fetch_page_direct(driver, url: str, cookies: List[Dict]) -> Optional[str]:
    """Fetch a page using direct Selenium"""
    try:
        driver.get("https://www.sdwheelwholesale.com")

        for cookie in cookies:
            try:
                driver.add_cookie(cookie)
            except Exception as e:
                logger.debug(f"Could not add cookie: {e}")

        driver.get(url)

        try:
            WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CLASS_NAME, "product-card"))
            )
        except TimeoutException:
            logger.debug(f"Timeout waiting for products on {url}")
        except Exception as e:
            logger.debug(f"Error waiting for products: {e}")

        return driver.page_source
    except TimeoutException as e:
        logger.warning(f"Page load timeout for {url}: {e}")
        return None
    except Exception as e:
        logger.error(f"Direct fetch failed for {url}: {e}")
        return None


def fetch_page_zenrows(url: str, cookies: List[Dict]) -> Optional[str]:
    """Fetch a page using ZenRows proxy with authenticated session cookies"""
    try:
        import requests

        if not ZENROWS_API_KEY:
            logger.error("ZenRows API key not found")
            return None

        # Build cookie header string from cookie list
        cookie_str = '; '.join(f"{c['name']}={c['value']}" for c in cookies)

        params = {
            'url': url,
            'apikey': ZENROWS_API_KEY,
            'js_render': 'true',
            'premium_proxy': 'true',
            'proxy_country': 'us',
            'wait_for': '.product-card, .store-active-filters',
            'wait': '5000',
            'custom_headers': 'true'
        }

        headers = {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Cookie': cookie_str
        }

        response = requests.get(
            'https://api.zenrows.com/v1/',
            params=params,
            headers=headers,
            timeout=60
        )

        if response.status_code == 200:
            return response.text
        else:
            logger.error(f"ZenRows returned status {response.status_code}")
            return None

    except Exception as e:
        logger.error(f"ZenRows fetch failed for {url}: {e}")
        return None


def fetch_page_hybrid(driver, url: str, cookies: List[Dict]) -> Optional[str]:
    """Fetch page with hybrid strategy - try direct first, fallback to ZenRows"""
    for attempt in range(HYBRID_RETRY_COUNT):
        html = fetch_page_direct(driver, url, cookies)
        if html and 'product-card' in html:
            return html
        logger.warning(f"Direct fetch attempt {attempt + 1}/{HYBRID_RETRY_COUNT} failed for {url}")
        time.sleep(1)

    # Fallback to ZenRows
    logger.info(f"Falling back to ZenRows for {url}")
    html = fetch_page_zenrows(url, cookies)
    return html


def fetch_page(driver, url: str, cookies: List[Dict]) -> Optional[str]:
    """Fetch page using configured scraping mode"""
    if SCRAPING_MODE == 'direct':
        return fetch_page_direct(driver, url, cookies)
    elif SCRAPING_MODE == 'zenrows':
        return fetch_page_zenrows(url, cookies)
    elif SCRAPING_MODE == 'hybrid':
        return fetch_page_hybrid(driver, url, cookies)
    else:
        logger.error(f"Unknown scraping mode: {SCRAPING_MODE}")
        return fetch_page_direct(driver, url, cookies)

# =============================================================================
# BRAND SCRAPING WITH PROPER BACKORDER DETECTION
# =============================================================================

def scrape_brand_page_sync(driver, cookies: List[Dict], brand: str, page: int, brand_encoded: str, state: BrandState):
    """Scrape a single page for a brand (synchronous)"""
    url = f"{TARGET}?store={MODE}&brand={brand_encoded}&page={page}"

    html = fetch_page(driver, url, cookies)
    if not html:
        logger.warning(f"  ⚠️  Failed to fetch {brand} page {page}")
        return page, []

    products = scrape_page_costs(html, brand)
    stats['pages_scraped'] += 1

    # Filter to only products we know about and process backorder detection
    matched_products = []

    for product in products:
        url_part = product.get('url_part_number')
        if url_part not in state.known_url_parts:
            continue

        # Backorder detection: check for .product-backorder element
        is_backorder = product.get('is_backorder', False)

        if is_backorder:
            state.consecutive_backorders += 1

            if state.consecutive_backorders >= MAX_CONSECUTIVE_BACKORDERS:
                if not state.stopped:
                    logger.info(f"  🛑 {brand}: {MAX_CONSECUTIVE_BACKORDERS} consecutive backorders on page {page}, stopping")
                    stats['backorder_stops'] += 1
                    state.stopped = True
                break
        else:
            # Reset consecutive counter if product is NOT on backorder
            state.consecutive_backorders = 0

        # Add product to matched list if it has a valid cost
        cost = product.get('cost', '').strip()
        if cost and cost != '0':
            matched_products.append(product)

    logger.info(f"  ✓ Page {page}: {len(matched_products)} costs ({state.consecutive_backorders} consecutive backorders)")

    return page, matched_products


def scrape_brand_sync(driver, cookies: List[Dict], brand: str, known_url_parts: Set[str]) -> List[Dict]:
    """Scrape all pages for a brand sequentially with proper backorder detection"""
    brand_encoded = brand.replace(' ', '+')
    state = BrandState(
        brand=brand,
        known_url_parts=known_url_parts,
        all_products=[]
    )

    logger.info(f"  Starting brand: {brand} ({len(known_url_parts)} known products)")

    page = 1

    while not state.stopped:
        # Scrape page sequentially
        pg, products = scrape_brand_page_sync(driver, cookies, brand, page, brand_encoded, state)

        if not products and not state.stopped:
            logger.info(f"  📭 No products on page {pg}, stopping")
            break

        state.all_products.extend(products)

        if state.stopped:
            break

        page += 1
        time.sleep(0.3)  # Small delay between pages

    stats['products_found'] += len(state.all_products)
    stats['brands_processed'] += 1

    logger.info(f"  ✅ Completed: {len(state.all_products)} products with costs")
    return state.all_products

# =============================================================================
# DATABASE OPERATIONS
# =============================================================================

async def batch_update_costs_direct(db_pool, products: List[Dict]) -> int:
    """Update costs in shopify_products table using direct SQL"""
    if not products:
        return 0

    # Extract valid costs
    valid_updates = []
    for product in products:
        url_part = product.get('url_part_number')
        cost = product.get('cost', '').strip()

        if url_part and cost:
            try:
                cost_float = float(cost)
                if cost_float > 0:
                    valid_updates.append((url_part, cost_float))
            except:
                continue

    if not valid_updates:
        return 0

    logger.info(f"    Updating {len(valid_updates)} costs in batches of {DB_BATCH_SIZE}...")

    total_updated = 0

    for i in range(0, len(valid_updates), DB_BATCH_SIZE):
        batch = valid_updates[i:i+DB_BATCH_SIZE]

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Build CASE statement
                cost_cases = []
                params = []

                for url_part, cost in batch:
                    cost_cases.append("WHEN %s THEN %s")
                    params.extend([url_part, cost])

                url_parts = [url_part for url_part, _ in batch]
                placeholders = ','.join(['%s'] * len(url_parts))

                query = f"""
                    UPDATE shopify_products
                    SET sdw_cost = CASE url_part_number {' '.join(cost_cases)} ELSE sdw_cost END
                    WHERE url_part_number IN ({placeholders})
                    AND product_type = %s
                """

                params.extend(url_parts)
                params.append(PRODUCT_TYPE)

                await cur.execute(query, params)
                batch_updated = cur.rowcount
                total_updated += batch_updated
                await conn.commit()

                logger.info(f"    ✓ Batch {i//DB_BATCH_SIZE + 1}: Updated {batch_updated} products")

    return total_updated


async def update_database_for_brand(db_pool, brand: str, products: List[Dict]):
    """Update database with all costs for a brand"""
    if not products:
        logger.info(f"  💾 No costs to update for {brand}")
        return

    logger.info(f"  💾 Updating database for {brand}: {len(products)} products...")

    updated = await batch_update_costs_direct(db_pool, products)

    stats['costs_updated'] += updated

    logger.info(f"  ✅ Updated {updated} costs for {brand}")

# =============================================================================
# BRAND COORDINATOR
# =============================================================================

async def process_brand(driver, cookies, db_pool, brand: str, known_url_parts: Set[str], brand_idx: int, total_brands: int):
    """Process a single brand: scrape + update database"""
    try:
        logger.info(f"[{brand_idx}/{total_brands}] Processing: {brand}")

        if not known_url_parts:
            logger.info(f"  Skipping {brand} - no products in database")
            stats['brands_skipped'] += 1
            return

        # Scrape all pages for this brand (synchronous)
        products = scrape_brand_sync(driver, cookies, brand, known_url_parts)

        # Update database with all products at once (batched internally)
        await update_database_for_brand(db_pool, brand, products)

    except Exception as e:
        logger.error(f"  ❌ Error processing {brand}: {e}")
        stats['errors'] += 1

# =============================================================================
# MAIN EXECUTION
# =============================================================================

async def main():
    logger.info("=" * 80)
    logger.info("SDW COST SCRAPER")
    logger.info("=" * 80)
    logger.info(f"Mode: {MODE}")
    logger.info(f"Headless: {HEADLESS}")
    logger.info(f"Scraping Mode: {SCRAPING_MODE}")
    if SCRAPING_MODE == 'hybrid':
        logger.info(f"Hybrid Retry Count: {HYBRID_RETRY_COUNT}")
    logger.info(f"Backorder Stop: {MAX_CONSECUTIVE_BACKORDERS} consecutive backorders")
    logger.info(f"Concurrency: {MAX_CONCURRENT_BRANDS} brands, {PAGES_PER_BRAND_CONCURRENT} pages/brand")
    logger.info(f"DB Batch Size: {DB_BATCH_SIZE}")
    if EXCLUDED_BRANDS:
        logger.info(f"Excluded Brands: {len(EXCLUDED_BRANDS)}")
    if SPECIFIC_BRANDS:
        logger.info(f"Specific Brands: {', '.join(SPECIFIC_BRANDS)}")
    logger.info("=" * 80)

    start_time = time.time()
    driver = None
    db_pool = None

    try:
        # Initialize database pool
        logger.info("Creating database pool...")
        db_pool = await aiomysql.create_pool(**DB_CONFIG)
        logger.info("✓ Database pool created")

        # Login
        login_cookie = await get_login_cookie()
        if not login_cookie:
            raise Exception("Failed to login")
        cookies = [login_cookie]

        # Create driver for scraping
        driver = get_driver()
        logger.info("✓ Browser driver created")

        # Get brand list
        logger.info("Fetching brand list...")
        html = fetch_page(driver, TARGET, cookies)
        if not html:
            raise Exception("Failed to fetch initial page")

        soup = BeautifulSoup(html, 'html.parser')
        all_brands = get_brands(soup)

        if not all_brands:
            raise Exception("No brands found")

        # Filter brands
        if SPECIFIC_BRANDS:
            brands_to_scrape = [b for b in all_brands if b in SPECIFIC_BRANDS]
            logger.info(f"Scraping specific brands: {', '.join(brands_to_scrape)}")
        else:
            brands_to_scrape = [b for b in all_brands if b not in EXCLUDED_BRANDS]
            logger.info(f"Scraping {len(brands_to_scrape)}/{len(all_brands)} brands (excluding {len(EXCLUDED_BRANDS)})")

        if not brands_to_scrape:
            raise Exception("No brands to scrape after filtering")

        # Prefetch URL parts for all brands
        logger.info("Prefetching known products from database...")
        await db_client.init(MODE)
        await db_client.prefetch_url_parts(brands_to_scrape)

        # Process brands sequentially (Selenium driver is not thread-safe)
        for idx, brand in enumerate(brands_to_scrape, start=1):
            known_url_parts = db_client.get_cached_url_parts(brand)
            try:
                await process_brand(driver, cookies, db_pool, brand, known_url_parts, idx, len(brands_to_scrape))
            except Exception as e:
                logger.error(f"❌ Brand '{brand}' failed: {e}")

        # Final stats
        elapsed = time.time() - start_time
        logger.info("=" * 80)
        logger.info("SCRAPING COMPLETED")
        logger.info("=" * 80)
        logger.info(f"Time: {elapsed/60:.1f} minutes ({elapsed:.1f} seconds)")
        logger.info(f"Brands processed: {stats['brands_processed']}")
        logger.info(f"Brands skipped: {stats['brands_skipped']}")
        logger.info(f"Pages scraped: {stats['pages_scraped']}")
        logger.info(f"Products found: {stats['products_found']}")
        logger.info(f"Costs updated: {stats['costs_updated']}")
        logger.info(f"Backorder stops: {stats['backorder_stops']}")
        logger.info(f"Direct requests: {stats['direct_requests']}")
        logger.info(f"ZenRows requests: {stats['zenrows_requests']}")
        logger.info(f"Errors: {stats['errors']}")
        logger.info("=" * 80)

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        if driver:
            driver.quit()
        if db_pool:
            db_pool.close()
            await db_pool.wait_closed()
        await db_client.close()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)
