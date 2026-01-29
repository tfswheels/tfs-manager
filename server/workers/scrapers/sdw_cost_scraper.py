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
from bs4 import BeautifulSoup
from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import logging
from collections import defaultdict

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

# Scraping configuration from environment variables (passed by backend)
SCRAPING_MODE = os.environ.get('SCRAPING_MODE', 'hybrid').lower()
HYBRID_RETRY_COUNT = int(os.environ.get('HYBRID_RETRY_COUNT', '3'))
MAX_CONSECUTIVE_BACKORDERS = int(os.environ.get('BACKORDER_COUNT', '5'))
ZENROWS_API_KEY = os.environ.get('ZENROWS_API_KEY', '1952d3d9f407cef089c0871d5d37d426fe78546e')
CONCURRENT_WORKERS = 5  # Number of concurrent page fetchers

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
    'pages_scraped': 0,
    'products_found': 0,
    'costs_updated': 0,
    'errors': 0,
    'backorder_stops': 0,
    'direct_requests': 0,
    'zenrows_requests': 0
}

# =============================================================================
# DRIVER MANAGEMENT
# =============================================================================

def get_driver():
    """Create a new Selenium driver instance"""
    return Driver(uc=True, headless=HEADLESS)

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

            # Detect backorder
            is_backorder = False
            stock_elem = card.select_one('.stock-status, .availability')
            if stock_elem:
                stock_text = stock_elem.text.lower()
                if 'backorder' in stock_text or 'out of stock' in stock_text:
                    is_backorder = True

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
        except:
            logger.debug(f"No products found on {url}")

        stats['direct_requests'] += 1
        return driver.page_source
    except Exception as e:
        logger.error(f"Direct fetch failed for {url}: {e}")
        return None


def fetch_page_zenrows(url: str, cookies: List[Dict]) -> Optional[str]:
    """
    Fetch a page using ZenRows proxy with authenticated session cookies.
    Passes cookies via custom_headers (same pattern as improved_scraper.py)
    """
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
            'custom_headers': 'true'  # Enable custom headers to pass cookies
        }

        headers = {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Cookie': cookie_str  # Pass the authenticated session cookie
        }

        response = requests.get(
            'https://api.zenrows.com/v1/',
            params=params,
            headers=headers,
            timeout=60
        )

        if response.status_code == 200:
            stats['zenrows_requests'] += 1
            return response.text
        else:
            logger.error(f"ZenRows returned status {response.status_code}")
            return None

    except Exception as e:
        logger.error(f"ZenRows fetch failed for {url}: {e}")
        return None


def fetch_page_hybrid(driver, url: str, cookies: List[Dict]) -> Optional[str]:
    """
    Fetch page with hybrid strategy - try direct first, fallback to ZenRows.
    This matches the pattern from our working inventory scrapers.
    """
    for attempt in range(HYBRID_RETRY_COUNT):
        html = fetch_page_direct(driver, url, cookies)
        if html and 'product-card' in html:
            return html
        logger.warning(f"Direct fetch attempt {attempt + 1}/{HYBRID_RETRY_COUNT} failed for {url}")
        time.sleep(1)

    # Fallback to ZenRows
    logger.info(f"Falling back to ZenRows for {url}")
    return fetch_page_zenrows(url, cookies)


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
# BRAND SCRAPING
# =============================================================================

async def scrape_page_async(driver, cookies: List[Dict], brand: str, page: int, brand_encoded: str) -> tuple:
    """Scrape a single page asynchronously"""
    url = f"{TARGET}?store={MODE}&brand={brand_encoded}&page={page}"
    logger.info(f"  📄 Scraping {brand} page {page}")

    html = fetch_page(driver, url, cookies)
    if not html:
        logger.warning(f"  ⚠️  Failed to fetch {brand} page {page}")
        return page, [], False

    products = scrape_page_costs(html, brand)
    stats['pages_scraped'] += 1

    # Check if all products are backorder
    all_backorder = False
    if products:
        backorder_count = sum(1 for p in products if p['is_backorder'])
        all_backorder = (backorder_count == len(products))

    return page, products, all_backorder


async def scrape_brand(driver, cookies: List[Dict], brand: str, known_url_parts: Set[str]) -> List[Dict]:
    """Scrape all pages for a brand with concurrent page fetching"""
    all_products = []
    brand_encoded = brand.replace(' ', '+')
    consecutive_backorders = 0
    page = 1
    max_concurrent_pages = 3  # Scrape 3 pages at a time

    logger.info(f"Starting brand: {brand} ({len(known_url_parts)} known products)")

    while True:
        # Create tasks for next batch of pages
        tasks = []
        page_numbers = []

        for i in range(max_concurrent_pages):
            current_page = page + i
            page_numbers.append(current_page)
            task = scrape_page_async(driver, cookies, brand, current_page, brand_encoded)
            tasks.append(task)

        # Execute pages concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        found_empty_page = False
        pages_processed = 0

        for page_num, (pg, products, all_backorder) in zip(page_numbers, results):
            if isinstance(results, Exception):
                logger.error(f"  ❌ Error scraping page {page_num}: {results}")
                continue

            if not products:
                logger.info(f"  📭 No products on {brand} page {pg}, stopping brand")
                found_empty_page = True
                break

            # Filter to only products we know about
            matched_products = [p for p in products if p['url_part_number'] in known_url_parts]
            stats['products_found'] += len(matched_products)

            # Check backorder logic
            if all_backorder:
                consecutive_backorders += 1
                logger.info(f"  📦 Page {pg}: All {len(products)} products are backorder ({consecutive_backorders}/{MAX_CONSECUTIVE_BACKORDERS})")

                if consecutive_backorders >= MAX_CONSECUTIVE_BACKORDERS:
                    logger.info(f"  🛑 Reached {MAX_CONSECUTIVE_BACKORDERS} consecutive backorder pages for {brand}")
                    stats['backorder_stops'] += 1
                    found_empty_page = True
                    break
            else:
                consecutive_backorders = 0  # Reset counter

            all_products.extend(matched_products)
            logger.info(f"  ✓ Found {len(matched_products)} costs on {brand} page {pg}")
            pages_processed += 1

        if found_empty_page or consecutive_backorders >= MAX_CONSECUTIVE_BACKORDERS:
            break

        page += max_concurrent_pages
        await asyncio.sleep(0.3)  # Small delay between batches

    logger.info(f"✅ Completed brand: {brand} - {len(all_products)} products with costs")
    stats['brands_processed'] += 1
    return all_products

# =============================================================================
# DATABASE OPERATIONS
# =============================================================================

async def update_database(brand: str, products: List[Dict]) -> int:
    """Update database with scraped costs"""
    if not products:
        return 0

    try:
        logger.info(f"  💾 Updating database for {brand}: {len(products)} products...")

        # Use the new batch_update_costs function
        updated = await db_client.batch_update_costs(products, PRODUCT_TYPE)
        stats['costs_updated'] += updated

        logger.info(f"  ✅ Updated {updated} costs for {brand}")
        return updated
    except Exception as e:
        logger.error(f"  ❌ Database update error for {brand}: {e}")
        import traceback
        traceback.print_exc()
        stats['errors'] += 1
        return 0

async def get_url_parts_for_brand(brand: str) -> Set[str]:
    """Fetch known url_part_numbers for a brand from database"""
    try:
        url_parts = await db_client.get_all_url_part_numbers(brand)
        return url_parts
    except Exception as e:
        logger.error(f"Error fetching URL parts for {brand}: {e}")
        return set()

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
    logger.info(f"Backorder Stop Limit: {MAX_CONSECUTIVE_BACKORDERS} consecutive pages")
    if EXCLUDED_BRANDS:
        logger.info(f"Excluded Brands: {len(EXCLUDED_BRANDS)}")
    if SPECIFIC_BRANDS:
        logger.info(f"Specific Brands: {', '.join(SPECIFIC_BRANDS)}")
    logger.info("=" * 80)

    start_time = time.time()
    driver = None
    total_products = 0
    total_updates = 0

    try:
        # Initialize database
        await db_client.init(MODE)
        logger.info("✓ Database initialized")

        # Login
        login_cookie = await get_login_cookie()
        if not login_cookie:
            raise Exception("Failed to login")
        cookies = [login_cookie]

        # Create driver for scraping
        driver = get_driver()
        logger.info("✓ Browser driver created")

        # Get initial page and brands
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
        await db_client.prefetch_url_parts(brands_to_scrape)

        # Scrape each brand
        for idx, brand in enumerate(brands_to_scrape, 1):
            try:
                logger.info(f"[{idx}/{len(brands_to_scrape)}] Processing brand: {brand}")

                # Get known URL parts for this brand
                known_url_parts = db_client.get_cached_url_parts(brand)

                if not known_url_parts:
                    logger.info(f"  Skipping {brand} - no products in database")
                    continue

                products = await scrape_brand(driver, cookies, brand, known_url_parts)
                total_products += len(products)

                if products:
                    updated = await update_database(brand, products)
                    total_updates += updated

            except Exception as e:
                logger.error(f"Error scraping brand {brand}: {e}")
                stats['errors'] += 1
                continue

        # Final stats
        elapsed = time.time() - start_time
        logger.info("=" * 80)
        logger.info("SCRAPING COMPLETED")
        logger.info("=" * 80)
        logger.info(f"Time: {elapsed/60:.1f} minutes")
        logger.info(f"Brands processed: {stats['brands_processed']}/{len(brands_to_scrape)}")
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
