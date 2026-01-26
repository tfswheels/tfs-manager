"""
Scraper Core Module

Core scraping functionality from original cwo_scraper.py:
- Product card parsing
- ZenRows API integration
- CAPTCHA/WAF handling
- Page fetching and parsing
"""

import asyncio
import aiohttp
import re
import traceback
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from bs4 import BeautifulSoup
from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from capsolver import Capsolver

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import (
        MODE,
        BASE_URL,
        IN_STOCK_QUANTITY,
        ZENROWS_API_KEY,
        CAPSOLVER_API_KEY,
        SKIP_BRANDS_NORMALIZED,
        SALE_ONLY,
        USE_ZENROWS,
        SCRAPING_MODE,
        HYBRID_RETRY_COUNT,
        logger
    )
except ImportError:
    from config import (
        MODE,
        BASE_URL,
        IN_STOCK_QUANTITY,
        ZENROWS_API_KEY,
        CAPSOLVER_API_KEY,
        SKIP_BRANDS_NORMALIZED,
        SALE_ONLY,
        USE_ZENROWS,
        SCRAPING_MODE,
        HYBRID_RETRY_COUNT,
        logger
    )


# =============================================================================
# PRODUCT DATA CLASS
# =============================================================================

@dataclass
class Product:
    """Represents a wheel/tire product from Custom Wheel Offset."""
    brand: str
    model_color: str
    size_info: str
    price: float
    compare_at_price: Optional[float]
    quantity: int
    url: str
    url_part_number: str
    inventory_status: str
    sale_type: Optional[str] = None
    sale_percentage: Optional[int] = None

    def to_dict(self) -> Dict:
        """Convert product to dictionary for database update."""
        compare_at_price = None
        is_on_sale = False

        if self.sale_type == 'percentage' and self.sale_percentage:
            discount_multiplier = 1 - (self.sale_percentage / 100)
            compare_at_price = round(self.price / discount_multiplier, 2)
            is_on_sale = True
        elif self.sale_type == 'generic':
            compare_at_price = None
            is_on_sale = True
        elif self.compare_at_price is not None:
            compare_at_price = float(self.compare_at_price)
            is_on_sale = True

        if is_on_sale:
            price_map = round(self.price * 0.99, 2)
        else:
            price_map = self.price

        # Determine product_type from MODE ('wheels' -> 'wheel', 'tires' -> 'tire')
        product_type = MODE[:-1] if MODE.endswith('s') else MODE

        return {
            'brand': self.brand,
            'url_part_number': self.url_part_number,
            'quantity': str(self.quantity),
            'price_map': str(price_map),
            'cost': str(self.price),
            'compare_at_price': compare_at_price,
            'url': self.url,
            'sale_type': self.sale_type,
            'product_type': product_type,
        }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def extract_part_number_from_url(url: str) -> Optional[str]:
    """Extract part number from Custom Wheel Offset URL."""
    try:
        match = re.search(r'/buy-wheel-offset2?/([^/]+)/', url)
        if match:
            return match.group(1)
        return None
    except Exception as e:
        logger.debug(f"Error extracting part number from URL {url}: {e}")
        return None


def parse_product_card(card_html: str) -> Optional[Product]:
    """Parse a single product card HTML and extract product information."""
    try:
        soup = BeautifulSoup(card_html, 'html.parser')

        link = soup.find('a', class_='product-card-a')
        if not link or not link.get('href'):
            return None

        url = link.get('href')
        part_number = extract_part_number_from_url(url)
        if not part_number:
            return None

        brand_elem = soup.find('h3', class_='brand')
        if not brand_elem:
            return None
        brand = brand_elem.get_text(strip=True)

        model_elem = soup.find('h4', class_='model-color')
        model_color = model_elem.get_text(strip=True) if model_elem else ''

        size_elem = soup.find('p', class_='subtitle')
        size_info = size_elem.get_text(strip=True) if size_elem else ''

        inventory_status = 'in_stock'
        quantity = IN_STOCK_QUANTITY

        backorder_elem = soup.find('div', class_='product-backorder')
        made_to_order_elem = soup.find('p', class_='made-to-order-text')

        if backorder_elem:
            inventory_status = 'backordered'
            quantity = 0
        elif made_to_order_elem:
            inventory_status = 'made_to_order'
            quantity = 0

        price_elem = soup.find('span', class_='current-price')
        if not price_elem:
            return None

        price_text = price_elem.get_text(strip=True)
        try:
            price = float(price_text.replace(',', ''))
        except ValueError:
            return None

        compare_at_price = None
        old_price_elem = soup.find('div', class_='old-price')
        if old_price_elem:
            old_price_text = old_price_elem.get_text(strip=True)
            match = re.search(r'\$?([\d,]+\.?\d*)', old_price_text)
            if match:
                try:
                    compare_at_price = float(match.group(1).replace(',', ''))
                except ValueError:
                    pass

        sale_type = None
        sale_percentage = None
        sale_banner = soup.find('div', class_='deals-red-banner-text')
        if sale_banner:
            sale_line = sale_banner.find('span', class_='sale-line')
            if sale_line:
                sale_text = sale_line.get_text(strip=True)
                percent_match = re.search(r'(\d+)%\s*off', sale_text, re.IGNORECASE)
                if percent_match:
                    sale_type = 'percentage'
                    sale_percentage = int(percent_match.group(1))
                elif 'sale' in sale_text.lower():
                    sale_type = 'generic'

        product = Product(
            brand=brand,
            model_color=model_color,
            size_info=size_info,
            price=price,
            compare_at_price=compare_at_price,
            quantity=quantity,
            url=f"https://www.customwheeloffset.com{url}",
            url_part_number=part_number,
            inventory_status=inventory_status,
            sale_type=sale_type,
            sale_percentage=sale_percentage,
        )

        if brand.lower() in SKIP_BRANDS_NORMALIZED:
            product.brand = None  # Mark as skipped
            return product

        return product

    except Exception as e:
        logger.error(f"Error parsing product card: {e}")
        return None


# =============================================================================
# CAPTCHA & WAF HANDLING
# =============================================================================

async def handle_initial_captcha(driver: Driver) -> bool:
    """Handle the initial 'Begin' button captcha that appears on first page load."""
    try:
        logger.info("Checking for initial CAPTCHA button...")

        # Wait for the "Begin" button (same as SDW scraper)
        try:
            begin_button = WebDriverWait(driver, 20).until(
                EC.element_to_be_clickable((By.ID, "amzn-captcha-verify-button"))
            )
            logger.info("Found CAPTCHA button. Clicking it using JavaScript...")
            driver.execute_script("arguments[0].click();", begin_button)

            # Wait for button to disappear
            WebDriverWait(driver, 20).until(EC.invisibility_of_element(begin_button))
            logger.info("CAPTCHA button clicked and is now invisible.")

            # Wait a bit for the page to settle
            await asyncio.sleep(3)

            # Check if WAF challenge exists and solve it
            waf_solved = await solve_waf_challenge(driver)
            if waf_solved:
                logger.info("WAF challenge handled successfully")
            else:
                logger.warning("WAF challenge solving failed or not found")

            return True

        except TimeoutException:
            logger.info("No initial CAPTCHA button found (might not be needed)")
            return True

    except Exception as e:
        logger.error(f"Error handling initial captcha: {e}")
        return False


async def extract_waf_challenge(html: str) -> Dict:
    """Extract WAF challenge data from HTML."""
    soup = BeautifulSoup(html, 'html.parser')

    # Method 1: Look for AwsWafCaptcha script
    script_tag = soup.find('script', string=re.compile(r'AwsWafCaptcha'))

    # Method 2: Look for gokuProps inline script
    if not script_tag:
        script_tag = soup.find('script', string=re.compile(r'gokuProps'))

    if not script_tag:
        # Method 3: Check if challenge/captcha scripts are loaded
        challenge_script = soup.find('script', src=re.compile(r'challenge\.js'))
        if challenge_script:
            logger.info("Found AWS WAF challenge scripts in page")
            # Extract from inline script
            for script in soup.find_all('script'):
                if script.string and 'gokuProps' in script.string:
                    script_tag = script
                    break

    if not script_tag or not script_tag.string:
        return {'exists': False}

    try:
        script_content = script_tag.string

        # Extract gokuProps
        key_match = re.search(r'"key":\s*"([^"]+)"', script_content)
        iv_match = re.search(r'"iv":\s*"([^"]+)"', script_content)
        context_match = re.search(r'"context":\s*"([^"]+)"', script_content)

        # Also try with single quotes
        if not all([key_match, iv_match, context_match]):
            key_match = re.search(r"'key':\s*'([^']+)'", script_content)
            iv_match = re.search(r"'iv':\s*'([^']+)'", script_content)
            context_match = re.search(r"'context':\s*'([^']+)'", script_content)

        # Extract challenge URL
        challenge_match = re.search(r'src=["\']([^"\']+challenge\.js[^"\']*)["\']', str(soup))

        if not all([key_match, iv_match, context_match, challenge_match]):
            logger.warning("WAF challenge detected but couldn't extract all parameters")
            logger.debug(f"key: {bool(key_match)}, iv: {bool(iv_match)}, context: {bool(context_match)}, challenge: {bool(challenge_match)}")
            return {'exists': False}

        logger.info("Successfully extracted WAF challenge parameters")
        return {
            'exists': True,
            'gokuProps': {
                'key': key_match.group(1),
                'iv': iv_match.group(1),
                'context': context_match.group(1)
            },
            'challengeUrl': challenge_match.group(1)
        }
    except Exception as e:
        logger.warning(f"Error extracting WAF challenge: {e}")
        logger.debug(traceback.format_exc())
        return {'exists': False}


async def solve_waf_challenge(driver: Driver) -> bool:
    """Solve AWS WAF challenge if present."""
    if not CAPSOLVER_API_KEY:
        logger.warning("No CapSolver API key, skipping WAF challenge")
        return False

    try:
        html = driver.page_source
        waf_data = await extract_waf_challenge(html)

        if not waf_data['exists']:
            logger.info("No WAF challenge detected on page")
            return True  # Not an error, just no WAF

        logger.info("Detected AWS WAF Challenge. Solving challenge...")

        solver = Capsolver(CAPSOLVER_API_KEY)
        solution = solver.solve_aws_waf({
            'websiteURL': driver.current_url,
            'awsKey': waf_data['gokuProps']['key'],
            'awsIv': waf_data['gokuProps']['iv'],
            'awsContext': waf_data['gokuProps']['context'],
            'awsChallengeJS': waf_data['challengeUrl']
        })

        logger.info("WAF challenge solution obtained, adding cookie...")

        # Add the WAF token as a cookie
        waf_cookie = {
            'name': 'aws-waf-token',
            'value': solution,
            'domain': '.customwheeloffset.com',
            'path': '/',
            'secure': True,
            'sameSite': 'Lax'
        }
        driver.add_cookie(waf_cookie)
        driver.refresh()

        # Wait for product cards to actually load after refresh
        logger.info("Waiting for product cards to load after WAF solution...")
        try:
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '.product-card-a'))
            )
            logger.info("Product cards loaded successfully after WAF solution")
            return True
        except TimeoutException:
            logger.warning("Timeout waiting for products after WAF solution, but continuing...")
            return True

    except Exception as e:
        logger.error(f"Error solving WAF challenge: {e}")
        logger.debug(traceback.format_exc())
        return False


# =============================================================================
# PAGE FETCHING
# =============================================================================

# ZenRows usage tracking (for hybrid mode analytics)
zenrows_stats = {
    'used': 0,
    'success': 0,
    'failed': 0
}

async def fetch_page_with_zenrows(session: aiohttp.ClientSession, url: str, cookies: List[Dict], max_retries: int = 3, track_stats: bool = False) -> Optional[str]:
    """Fetch a page using ZenRows API with cookies from initial authentication."""
    if track_stats:
        zenrows_stats['used'] += 1

    for attempt in range(max_retries):
        try:
            # Format cookies for ZenRows
            cookie_str = '; '.join(f"{c['name']}={c['value']}" for c in cookies)

            # Tires pages have 4x more products and need longer timeout
            timeout = 90 if MODE == 'tires' else 45
            wait_time = '8000' if MODE == 'tires' else '5000'

            params = {
                'apikey': ZENROWS_API_KEY,
                'url': url,
                'js_render': 'true',
                'premium_proxy': 'true',
                'proxy_country': 'us',
                'wait': wait_time,  # Tires: 8s, Wheels: 5s
                'custom_headers': 'true'
            }

            headers = {
                'Accept': 'text/html',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cookie': cookie_str
            }

            logger.debug(f"Fetching via ZenRows (attempt {attempt + 1}/{max_retries}): {url}")

            async with session.get('https://api.zenrows.com/v1/',
                                 params=params,
                                 headers=headers,
                                 timeout=timeout) as resp:

                if resp.status != 200:
                    logger.warning(f"ZenRows returned status {resp.status} for {url}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 * (attempt + 1))  # Exponential backoff
                        continue
                    return None

                text = await resp.text()

                # Validate response based on page type
                is_product_page = '/buy-wheel-offset' in url or '/store/product/' in url
                is_valid = False

                if is_product_page:
                    # Product detail page - check for Klaviyo data
                    has_klaviyo = 'klaviyoProduct' in text
                    is_valid = has_klaviyo

                    if not is_valid:
                        logger.warning(f"Product page missing Klaviyo data: {url}")
                else:
                    # Listing page - check for product cards or no-results
                    has_products = '.product-card-a' in text or 'product-card' in text
                    has_no_results = 'no-results-container' in text
                    is_valid = has_products or has_no_results

                    if not is_valid:
                        logger.warning(f"Listing page missing product cards or no-results: {url}")

                if is_valid:
                    logger.debug(f"Successfully fetched page via ZenRows")
                    if track_stats:
                        zenrows_stats['success'] += 1
                    return text
                else:
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    if track_stats:
                        zenrows_stats['failed'] += 1
                    return None

        except asyncio.TimeoutError:
            logger.warning(f"Timeout fetching {url} via ZenRows (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            if track_stats:
                zenrows_stats['failed'] += 1
            return None
        except Exception as e:
            logger.error(f"Error fetching via ZenRows (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            if track_stats:
                zenrows_stats['failed'] += 1
            return None

    return None


async def fetch_page_direct(session: aiohttp.ClientSession, url: str, cookies: List[Dict], max_retries: int = 3) -> Optional[str]:
    """
    Fetch a page directly without ZenRows (no proxy).
    Uses the same validation logic as ZenRows version.
    """
    for attempt in range(max_retries):
        try:
            # Format cookies for request
            cookie_str = '; '.join(f"{c['name']}={c['value']}" for c in cookies)

            # Tires pages have 4x more products and need longer timeout
            timeout = 90 if MODE == 'tires' else 45

            headers = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookie_str,
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            }

            logger.debug(f"Fetching directly (attempt {attempt + 1}/{max_retries}): {url}")

            async with session.get(url,
                                 headers=headers,
                                 timeout=aiohttp.ClientTimeout(total=timeout),
                                 allow_redirects=True) as resp:

                if resp.status != 200:
                    logger.warning(f"Direct fetch returned status {resp.status} for {url}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 * (attempt + 1))  # Exponential backoff
                        continue
                    return None

                text = await resp.text()

                # Validate response based on page type (same validation as ZenRows)
                is_product_page = '/buy-wheel-offset' in url or '/store/product/' in url
                is_valid = False

                if is_product_page:
                    # Product detail page - check for Klaviyo data
                    has_klaviyo = 'klaviyoProduct' in text
                    is_valid = has_klaviyo

                    if not is_valid:
                        logger.warning(f"Product page missing Klaviyo data: {url}")
                else:
                    # Listing page - check for product cards or no-results
                    has_products = '.product-card-a' in text or 'product-card' in text
                    has_no_results = 'no-results-container' in text
                    is_valid = has_products or has_no_results

                    if not is_valid:
                        logger.warning(f"Listing page missing product cards or no-results: {url}")

                if is_valid:
                    logger.debug(f"Successfully fetched page directly")
                    return text
                else:
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    return None

        except asyncio.TimeoutError:
            logger.warning(f"Timeout fetching {url} directly (attempt {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            return None
        except Exception as e:
            logger.error(f"Error fetching directly (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            return None

    return None


async def fetch_page(session: aiohttp.ClientSession, url: str, cookies: List[Dict], max_retries: int = 3) -> Optional[str]:
    """
    Fetch a page using ZenRows, direct fetch, or hybrid mode based on SCRAPING_MODE config.

    This is the main fetch function that should be used throughout the codebase.
    It automatically chooses the appropriate scraping method.

    Modes:
    - 'direct': Always use direct fetch (no proxy)
    - 'zenrows': Always use ZenRows proxy
    - 'hybrid': Try direct fetch first, fallback to ZenRows on failure
    """
    if SCRAPING_MODE == 'direct':
        logger.debug(f"[Direct Mode] Fetching: {url}")
        return await fetch_page_direct(session, url, cookies, max_retries)

    elif SCRAPING_MODE == 'zenrows':
        logger.debug(f"[ZenRows Mode] Fetching: {url}")
        return await fetch_page_with_zenrows(session, url, cookies, max_retries)

    elif SCRAPING_MODE == 'hybrid':
        # Hybrid mode: Try direct first (with limited retries), fallback to ZenRows
        logger.debug(f"[Hybrid Mode] Attempting direct fetch (max {HYBRID_RETRY_COUNT} attempts): {url}")

        # Try direct fetch with custom retry count
        result = await fetch_page_direct(session, url, cookies, max_retries=HYBRID_RETRY_COUNT)

        if result is not None:
            logger.debug(f"[Hybrid Mode] Direct fetch succeeded: {url}")
            return result

        # Direct fetch failed, fallback to ZenRows
        logger.info(f"[Hybrid Mode] Direct fetch failed after {HYBRID_RETRY_COUNT} attempts, trying ZenRows: {url}")
        return await fetch_page_with_zenrows(session, url, cookies, max_retries, track_stats=True)

    else:
        # Fallback to legacy USE_ZENROWS for backward compatibility
        if USE_ZENROWS:
            logger.debug(f"[Legacy] Using ZenRows for: {url}")
            return await fetch_page_with_zenrows(session, url, cookies, max_retries)
        else:
            logger.debug(f"[Legacy] Using direct fetch for: {url}")
            return await fetch_page_direct(session, url, cookies, max_retries)


# =============================================================================
# KLAVIYO DATA EXTRACTION (for product pages)
# =============================================================================

def extract_klaviyo_product(html: str) -> List[Dict]:
    """Extract klaviyoProduct JSON data from HTML."""
    pattern = re.compile(r'(?:let|var|const)\s+klaviyoProduct\s*=\s*(\[\{.*?\}\]);', re.DOTALL)
    match = pattern.search(html)
    if match:
        json_str = match.group(1)
        try:
            import json
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error(f"JSON decoding failed: {e}")
            return []
    return []
