import os
import sys
import time
import json
import re
from urllib.parse import quote
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from selenium.webdriver.support.ui import Select
from capsolver import Capsolver
import mysql.connector

# Import interactive prompt module for non-blocking user input
try:
    from interactive_prompt import InteractivePrompt
except ImportError:
    InteractivePrompt = None
    print("⚠️  InteractivePrompt module not found - falling back to blocking input")

# Load environment variables
dotenv_path = "/Users/jeremiah/Desktop/TFS Wheels/Scripts/.env"
load_dotenv(dotenv_path)

# Helper function for non-interactive mode
def is_interactive_mode():
    """Check if running in interactive mode (has TTY)"""
    return sys.stdin.isatty()

def get_interactive_prompt():
    """Get InteractivePrompt instance if job_id is available"""
    job_id = os.environ.get('SDW_JOB_ID')
    if job_id and InteractivePrompt:
        return InteractivePrompt(job_id)
    return None

def safe_input(prompt, default='y'):
    """Get user input if interactive, otherwise return default"""
    if is_interactive_mode():
        try:
            return input(prompt).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n\nOperation cancelled.")
            return 'n'
    else:
        # Non-interactive mode: automatically use default
        print(f"{prompt}[Auto: {default}]")
        return default

SHOPIFY_STORE_URL = os.environ.get('SHOPIFY_STORE_URL')
SHOPIFY_ACCESS_TOKEN = os.environ.get('SHOPIFY_ACCESS_TOKEN')
CAPSOLVER_API_KEY = os.environ.get('CAPSOLVER_API_KEY')
ZENROWS_API_KEY = os.environ.get('ZENROWS_API_KEY', '1952d3d9f407cef089c0871d5d37d426fe78546e')
SDW_EMAIL = os.environ.get('SDW_EMAIL')
SDW_PASS = os.environ.get('SDW_PASS')

# Database configuration
# SDW automation always uses tfs-db database (where shopify_products table lives)
DB_CONFIG = {
    'host': os.environ.get('DB_HOST'),
    'user': os.environ.get('DB_USER'),
    'password': os.environ.get('DB_PASSWORD'),
    'database': 'tfs-db'  # Always use tfs-db for product data
}

# Clean up URL format
if SHOPIFY_STORE_URL:
    if '.myshopify.com' in SHOPIFY_STORE_URL:
        base_url = SHOPIFY_STORE_URL.split('.myshopify.com')[0] + '.myshopify.com'
        SHOPIFY_STORE_URL = base_url
    else:
        SHOPIFY_STORE_URL = SHOPIFY_STORE_URL.rstrip('/')
        if SHOPIFY_STORE_URL.endswith('/admin'):
            SHOPIFY_STORE_URL = SHOPIFY_STORE_URL[:-6]

API_VERSION = "2025-01"
GRAPHQL_URL = f"{SHOPIFY_STORE_URL}/admin/api/{API_VERSION}/graphql.json"

# Headers for GraphQL requests
headers = {
    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    'Content-Type': 'application/json'
}

# Base directory for order processing
BASE_DIR = Path("/Users/jeremiah/Desktop/TFS Wheels/Scripts/Order Management/SDW Order Processing")
BASE_DIR.mkdir(parents=True, exist_ok=True)

# Billing information (always the same)
BILLING_INFO = {
    'first_name': 'Jeremiah',
    'last_name': 'Chukwu',
    'street': '1309 Coffeen Avenue',
    'city': 'Sheridan',
    'state': 'Wyoming',
    'zip': '82801',
    'email': 'jeremiah@autopartspalace.com',
    'who_sent_you': 'Customer Service'
}

# State abbreviation to full name mapping (SDW uses full names)
STATE_MAPPING = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
    'PR': 'Puerto Rico', 'VI': 'Virgin Islands', 'GU': 'Guam', 'AS': 'American Samoa'
}

# Items to skip automatically (case-insensitive)
SKIP_ITEMS = [
    'installation kit',
    'shipping protection',
    'centric rings',
    'mount & balance',
    'hub centric'
]

def execute_graphql_query(query, variables=None):
    """Execute a GraphQL query"""
    payload = {'query': query}
    if variables:
        payload['variables'] = variables

    try:
        response = requests.post(GRAPHQL_URL, json=payload, headers=headers, timeout=30)

        if response.status_code != 200:
            print(f"Error {response.status_code}: {response.text[:200]}")
            return None

        data = response.json()

        if 'errors' in data:
            print(f"GraphQL Errors: {json.dumps(data['errors'], indent=2)}")
            return None

        return data.get('data')

    except Exception as e:
        print(f"Exception: {str(e)}")
        return None


def get_order_by_name(order_name):
    """Fetch a single order by order name with all required fields"""
    query = f'''
    query {{
        orders(first: 1, query: "name:{order_name}") {{
            edges {{
                node {{
                    id
                    name
                    createdAt
                    note
                    tags
                    customAttributes {{
                        key
                        value
                    }}
                    shippingAddress {{
                        firstName
                        lastName
                        address1
                        address2
                        city
                        province
                        zip
                        country
                        phone
                        company
                    }}
                    lineItems(first: 100) {{
                        edges {{
                            node {{
                                id
                                name
                                quantity
                                sku
                                customAttributes {{
                                    key
                                    value
                                }}
                                variant {{
                                    id
                                    sku
                                    title
                                    product {{
                                        id
                                        tags
                                        productType
                                    }}
                                }}
                            }}
                        }}
                    }}
                }}
            }}
        }}
    }}
    '''

    data = execute_graphql_query(query)

    if not data or 'orders' not in data or not data['orders']['edges']:
        return None

    return data['orders']['edges'][0]['node']


def validate_address(address):
    """Validate shipping address"""
    if not address:
        return False, "No shipping address found"

    # Check if address line 1 is valid (not just numbers)
    address1 = address.get('address1', '').strip()

    if not address1:
        return False, "Address line 1 is empty"

    # Check if it's just a number (invalid)
    if address1.isdigit():
        return False, f"Invalid address - address line 1 is just a number: '{address1}'"

    # Basic validation
    if len(address1) < 5:
        return False, f"Address line 1 too short: '{address1}'"

    return True, "Address validated"


def should_skip_item(item_name):
    """Check if item should be skipped automatically"""
    item_lower = item_name.lower()
    for skip_keyword in SKIP_ITEMS:
        if skip_keyword in item_lower:
            return True
    return False


def is_wheel(item):
    """Check if item is a wheel based on tags, product type, or name"""
    name = item['name'].lower()
    product_type = ""
    tags = []

    if item.get('variant') and item['variant'].get('product'):
        product = item['variant']['product']
        product_type = product.get('productType', '').lower()
        tags = [tag.lower() for tag in product.get('tags', [])]

    # Check if it's a wheel
    return 'wheels' in tags or 'wheel' in product_type or 'wheel' in name


def is_tire(item):
    """Check if item is a tire based on product type"""
    if item.get('variant') and item['variant'].get('product'):
        product = item['variant']['product']
        product_type = product.get('productType', '').lower()
        return product_type == 'tires'
    return False


def get_db_connection():
    """Get database connection"""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"❌ Database connection error: {e}")
        return None


def extract_vehicle_info(order):
    """Extract vehicle information from line item notes or order notes"""
    vehicle_info = None

    # Try to get from line items custom attributes (note attributes)
    for edge in order['lineItems']['edges']:
        item = edge['node']
        if item.get('customAttributes'):
            for attr in item['customAttributes']:
                if attr['key'].lower() in ['vehicle', '_vehicle']:
                    vehicle_info = attr['value']
                    break
        if vehicle_info:
            break

    # Try to get from order notes
    if not vehicle_info and order.get('note'):
        note = order['note']
        # Look for "Vehicle:" pattern
        vehicle_match = re.search(r'Vehicle:\s*(.+?)(?:\n|$)', note, re.IGNORECASE)
        if vehicle_match:
            vehicle_info = vehicle_match.group(1).strip()

    # Try custom attributes on order level
    if not vehicle_info and order.get('customAttributes'):
        for attr in order['customAttributes']:
            if attr['key'].lower() == 'vehicle':
                vehicle_info = attr['value']
                break

    return vehicle_info


def parse_vehicle_info(vehicle_str):
    """
    Parse vehicle string into components (Year, Make, Model, Trim)
    Example: "2022 Honda Civic EX FWD Sedan" -> {year: 2022, make: Honda, model: Civic, trim: EX FWD Sedan}
    """
    if not vehicle_str:
        return None

    parts = vehicle_str.strip().split()
    if len(parts) < 3:
        return None

    # First part should be year
    year = None
    if parts[0].isdigit() and len(parts[0]) == 4:
        year = parts[0]
        remaining = parts[1:]
    else:
        remaining = parts

    if len(remaining) < 2:
        return None

    # Second part is make
    make = remaining[0]

    # Third part is model (could be multiple words)
    model = remaining[1]

    # Everything else is trim
    trim = ' '.join(remaining[2:]) if len(remaining) > 2 else ''

    return {
        'year': year,
        'make': make,
        'model': model,
        'trim': trim,
        'full': vehicle_str
    }


def get_url_part_number(sku, product_type):
    """
    Query database for url_part_number by SKU and product_type
    product_type should be 'wheel' or 'tire'
    """
    conn = get_db_connection()
    if not conn:
        return None

    try:
        cursor = conn.cursor()
        query = """
            SELECT url_part_number
            FROM shopify_products
            WHERE part_number = %s
            AND product_type = %s
            LIMIT 1
        """
        cursor.execute(query, (sku, product_type))
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if result:
            return result[0]
        return None
    except Exception as e:
        print(f"   ❌ Database query error: {e}")
        if conn:
            conn.close()
        return None


def search_product_on_sdw(driver, part_number, url_part_number, product_type):
    """
    Search for product on SDW and return product page URL if found
    part_number: Original part number from order (used for search)
    url_part_number: URL-formatted part number from database (used for verification) or None
    product_type: 'wheel' or 'tire'

    If url_part_number is None, will use fallback verification by checking the
    "Partnumber" field in Wheel Specs on each product page.
    """
    # URL-encode the part number to preserve special characters like +
    encoded_part_number = quote(part_number, safe='')

    if product_type == 'wheel':
        search_url = f"https://www.sdwheelwholesale.com/store/wheels?store=wheels&sort=instock&key={encoded_part_number}&saleToggle=0&qdToggle=0&suspension=Leveling%20Kit&modification=Minor%20Plastic%20Trimming&rubbing=No%20rubbing%20or%20scrubbing"
    else:  # tire
        search_url = f"https://www.sdwheelwholesale.com/store/tires?store=tires&sort=instock&key={encoded_part_number}&saleToggle=0&qdToggle=0"

    print(f"   🔍 Searching SDW: {search_url[:80]}...")
    driver.get(search_url)

    try:
        # Wait for product cards to load (like improved_scraper.py does)
        print(f"   ⏳ Waiting for product cards to load...")
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, "product-card"))
        )
        print(f"   ✅ Products loaded")

        # Get all product cards
        product_cards = driver.find_elements(By.CLASS_NAME, "product-card")

        if not product_cards:
            print(f"   ⚠️  No products found for {part_number}")
            return None

        print(f"   📦 Found {len(product_cards)} product(s)")

        # Collect all product URLs
        product_urls = []
        for idx, card in enumerate(product_cards, 1):
            try:
                # Find the product link (a.product-card-a as per improved_scraper.py)
                link = card.find_element(By.CSS_SELECTOR, "a.product-card-a")
                href = link.get_attribute('href')

                if not href:
                    continue

                # Extract part number from product URL
                # Pattern for wheels: /buy-wheel-offset/PARTNUMBER/
                # Pattern for tires: /buy-wheel-offset2/PARTNUMBER/
                if product_type == 'wheel':
                    pattern = r'/buy-wheel-offset/([^/]+)/'
                else:
                    pattern = r'/buy-wheel-offset2/([^/]+)/'

                match = re.search(pattern, href)
                if match:
                    found_part_number = match.group(1)
                    print(f"      [{idx}] Found URL: {found_part_number}")
                    product_urls.append(href)

                    # If we have url_part_number from DB, verify using that (fast path)
                    if url_part_number and found_part_number.upper() == url_part_number.upper():
                        print(f"   ✅ Match verified with URL part number: {href}")
                        return href
            except Exception as e:
                print(f"      ⚠️  Error checking card {idx}: {e}")
                continue

        # If url_part_number was provided but no match found, warn and continue to fallback
        if url_part_number:
            print(f"   ⚠️  No URL match found with database url_part_number")

        # FALLBACK: Open each product page and check the "Partnumber" field in Wheel Specs
        # This is used when:
        # 1. url_part_number is None (not in database), OR
        # 2. url_part_number exists but didn't match any product URLs
        if product_urls:
            print(f"   🔄 Using fallback: checking Partnumber field on each product page...")

            for idx, product_url in enumerate(product_urls, 1):
                try:
                    print(f"      [{idx}/{len(product_urls)}] Checking product page...")
                    driver.get(product_url)
                    time.sleep(2)  # Wait for page to load

                    # Look for the Partnumber field in wheel specs
                    # <div class="wheel-spec-item Partnumber" data-value="H114-2210817045BB">
                    try:
                        partnumber_elem = WebDriverWait(driver, 5).until(
                            EC.presence_of_element_located((By.CSS_SELECTOR, ".wheel-spec-item.Partnumber"))
                        )
                        page_part_number = partnumber_elem.get_attribute('data-value')

                        if page_part_number:
                            print(f"         Part number on page: {page_part_number}")

                            # Compare with the original part number (case-insensitive)
                            if page_part_number.upper() == part_number.upper():
                                print(f"   ✅ EXACT MATCH found via fallback: {product_url}")
                                return product_url
                            else:
                                print(f"         ❌ No match (expected: {part_number})")
                        else:
                            print(f"         ⚠️  Partnumber field has no data-value")
                    except TimeoutException:
                        print(f"         ⚠️  Partnumber field not found on page")
                    except Exception as e:
                        print(f"         ⚠️  Error extracting partnumber: {e}")

                except Exception as e:
                    print(f"      ⚠️  Error checking product page {idx}: {e}")
                    continue

            # If we checked all pages and found no exact match
            print(f"   ❌ No exact match found after checking all {len(product_urls)} product page(s)")
        else:
            print(f"   ❌ No product URLs to check")

        return None

    except TimeoutException:
        print(f"   ⚠️  Timeout waiting for products to load for {part_number}")
        return None
    except Exception as e:
        print(f"   ❌ Error searching for product: {e}")
        import traceback
        traceback.print_exc()
        return None


def fill_vehicle_form_interactive(driver, item_info):
    """
    Fill vehicle form interactively by prompting user for each field step-by-step.
    Dynamically handles all vehicle dropdowns (year, make, model, trim, and any others).
    Returns True if successful, False otherwise
    """
    interactive_prompt = get_interactive_prompt()
    if not interactive_prompt:
        print("   ⚠️  Interactive mode not available")
        return False

    current_selections = {}

    try:
        # Define vehicle field IDs in order and their display info
        vehicle_fields = [
            {"id": "year", "name": "year", "label": "Year", "icon": "📅", "placeholder": "Vehicle Year"},
            {"id": "make", "name": "make", "label": "Make", "icon": "🚗", "placeholder": "Vehicle Make"},
            {"id": "model", "name": "model", "label": "Model", "icon": "🚙", "placeholder": "Vehicle Model"},
            {"id": "trim", "name": "trim", "label": "Trim", "icon": "✨", "placeholder": "Vehicle Trim"},
        ]

        # Process each field dynamically
        for field in vehicle_fields:
            try:
                # Wait for dropdown to have real options loaded
                print(f"   ⏳ Waiting for {field['label'].lower()} dropdown to load...")
                time.sleep(2)  # Initial wait for AJAX

                # Wait for options to appear (checks frequently, continues as soon as ready)
                available_options = []
                try:
                    WebDriverWait(driver, 8).until(
                        lambda d: len(d.find_element(By.ID, field["id"]).find_elements(By.TAG_NAME, "option")) > 1
                    )

                    # Re-find element AFTER wait to avoid stale element reference
                    select_elem = driver.find_element(By.ID, field["id"])
                    select_obj = Select(select_elem)

                    # Get available options
                    for opt in select_obj.options:
                        opt_text = opt.text.strip()
                        opt_value = opt.get_attribute('value')
                        # Skip placeholder options
                        if opt_text and opt_text != field["placeholder"] and opt_value:
                            available_options.append({"text": opt_text, "value": opt_value})

                    print(f"   ✅ {field['label']} dropdown loaded with {len(available_options)} options")

                except TimeoutException:
                    print(f"   ℹ️  No {field['label'].lower()} options loaded after waiting")
                    # Don't process more fields if we couldn't load this one
                    break

                # Double check we have options
                if not available_options:
                    print(f"   ℹ️  No {field['label'].lower()} options available, stopping...")
                    break

                # Prompt user for selection
                print(f"   {field['icon']} Getting available {field['label'].lower()}s...")
                prompt_data = {
                    "item": item_info,
                    "current_selections": current_selections,
                    "available_options": available_options
                }

                response = interactive_prompt.request_user_input(f"vehicle_{field['name']}_selection", prompt_data)
                if not response or response.get('action') == 'cancel':
                    print("   ❌ User cancelled")
                    return False

                selected_text = response.get('selected_text')
                selected_value = response.get('selected_value')
                current_selections[field['name']] = selected_text

                # Fill the field
                print(f"   {field['icon']} Filling {field['label'].lower()}: {selected_text}")
                fill_js = f"""
                var select = document.getElementById('{field['id']}');
                if (select) {{
                    // Scroll into view
                    select.scrollIntoView({{block: 'center', behavior: 'smooth'}});

                    // Focus the element
                    select.focus();

                    // Set the value
                    select.value = '{selected_value}';

                    // Trigger all possible events that SDW might be listening for
                    var events = ['change', 'input', 'select', 'blur'];
                    events.forEach(function(eventType) {{
                        var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                        select.dispatchEvent(event);
                    }});

                    // Also try jQuery trigger if jQuery is available
                    if (typeof jQuery !== 'undefined') {{
                        jQuery(select).trigger('change').trigger('blur');
                    }}
                }}
                """
                driver.execute_script(fill_js)

            except NoSuchElementException:
                # Field doesn't exist, that's okay - we're done with vehicle fields
                print(f"   ℹ️  No {field['label'].lower()} dropdown found")
                break
            except Exception as e:
                print(f"   ⚠️  Error processing {field['label'].lower()}: {e}")
                # Continue to next field
                continue

        # Handle drivetrain field (appears AFTER trim is selected)
        print(f"   ⏳ Checking for drivetrain field (appears after trim)...")
        time.sleep(3)  # Drivetrain takes longer to appear

        # Search for drivetrain field dynamically (ID varies)
        drivetrain_check_js = """
        // Try common IDs for drivetrain field
        var possibleIds = ['drive', 'drivetrain', 'drive_train', 'driveTrain', 'vehicle_drivetrain', 'vehicle_drive'];
        var select = null;

        for (var i = 0; i < possibleIds.length; i++) {
            var elem = document.getElementById(possibleIds[i]);
            if (elem && elem.tagName === 'SELECT') {
                return {exists: true, id: possibleIds[i]};
            }
        }

        // Search all select elements for one with "drive" in name/placeholder
        var allSelects = document.getElementsByTagName('select');
        for (var i = 0; i < allSelects.length; i++) {
            var sel = allSelects[i];
            if (sel.name && (sel.name.toLowerCase().includes('drive') || sel.name.toLowerCase().includes('drivetrain'))) {
                return {exists: true, id: sel.id || sel.name};
            }
            var firstOption = sel.options[0];
            if (firstOption && firstOption.text) {
                var optText = firstOption.text.toLowerCase();
                if (optText.includes('drivetrain') || optText.includes('drive train')) {
                    return {exists: true, id: sel.id};
                }
            }
        }
        return {exists: false, id: null};
        """

        drivetrain_info = driver.execute_script(drivetrain_check_js)

        if drivetrain_info['exists']:
            print(f"   ⚙️  Drivetrain field detected (ID: {drivetrain_info['id']})")

            # Wait for options to load
            time.sleep(2)

            try:
                # Get drivetrain options
                drivetrain_elem = driver.find_element(By.ID, drivetrain_info['id'])
                drivetrain_select = Select(drivetrain_elem)
                available_drivetrains = [{"text": opt.text.strip(), "value": opt.get_attribute('value')}
                                        for opt in drivetrain_select.options
                                        if opt.text.strip() and opt.get_attribute('value')]

                if available_drivetrains:
                    print(f"   ✅ Found {len(available_drivetrains)} drivetrain options")
                    prompt_data = {
                        "item": item_info,
                        "current_selections": current_selections,
                        "available_options": available_drivetrains
                    }

                    response = interactive_prompt.request_user_input("vehicle_drivetrain_selection", prompt_data)
                    if response and response.get('action') != 'cancel':
                        selected_text = response.get('selected_text')
                        selected_value = response.get('selected_value')
                        current_selections['drivetrain'] = selected_text

                        print(f"   ⚙️  Filling drivetrain: {selected_text}")
                        fill_js = f"""
                        var select = document.getElementById('{drivetrain_info['id']}');
                        if (select) {{
                            select.scrollIntoView({{block: 'center', behavior: 'smooth'}});
                            select.focus();
                            select.value = '{selected_value}';
                            var events = ['change', 'input', 'select', 'blur'];
                            events.forEach(function(eventType) {{
                                var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                                select.dispatchEvent(event);
                            }});
                            if (typeof jQuery !== 'undefined') {{
                                jQuery(select).trigger('change').trigger('blur');
                            }}
                        }}
                        """
                        driver.execute_script(fill_js)
            except Exception as e:
                print(f"   ⚠️  Error with drivetrain: {e}")
        else:
            print(f"   ℹ️  No drivetrain field found")

        # Give page time to update after all selections
        time.sleep(2)
        print("   ✅ Interactive vehicle form filled successfully!")
        return True

    except Exception as e:
        print(f"   ❌ Error in interactive form filling: {e}")
        import traceback
        traceback.print_exc()
        return False


def detect_spacer_dropdown(driver):
    """
    Detect if a spacer dropdown exists on the current page
    Returns True if found, False otherwise
    """
    try:
        # Try to find spacer dropdown using multiple methods
        spacer_check_js = """
        // Look for select with name="spacer" or class containing "spacer"
        var spacerSelect = document.querySelector('select[name="spacer"]');
        if (spacerSelect && spacerSelect.offsetParent !== null) {
            return {exists: true, id: spacerSelect.id, name: spacerSelect.name};
        }

        // Look for p.spacerDropDown with visible select
        var spacerContainer = document.querySelector('p.spacerDropDown');
        if (spacerContainer && spacerContainer.style.display !== 'none') {
            var select = spacerContainer.querySelector('select');
            if (select) {
                return {exists: true, id: select.id, name: select.name};
            }
        }

        return {exists: false, id: null, name: null};
        """

        result = driver.execute_script(spacer_check_js)
        return result.get('exists', False)
    except Exception as e:
        print(f"   ⚠️  Error detecting spacer dropdown: {e}")
        return False


def parse_spacer_options(driver):
    """
    Parse spacer options from the dropdown
    Returns list of options with text, value, price, and quantity
    """
    try:
        # Get spacer options using JavaScript
        spacer_options_js = """
        var spacerSelect = document.querySelector('select[name="spacer"]');
        if (!spacerSelect) {
            var spacerContainer = document.querySelector('p.spacerDropDown');
            if (spacerContainer) {
                spacerSelect = spacerContainer.querySelector('select');
            }
        }

        if (!spacerSelect) {
            return [];
        }

        var options = [];
        for (var i = 0; i < spacerSelect.options.length; i++) {
            var opt = spacerSelect.options[i];
            var optText = opt.text.trim();
            var optValue = opt.value;

            // Skip placeholder/empty options
            if (!optText || optText.toLowerCase().includes('recommended spacers') || !optValue) {
                continue;
            }

            // Extract price and quantity from data attributes
            var price = opt.getAttribute('data-price') || null;
            var quantity = opt.getAttribute('data-quantity') || null;

            options.push({
                text: optText,
                value: optValue,
                price: price,
                quantity: quantity
            });
        }

        return options;
        """

        options = driver.execute_script(spacer_options_js)
        return options if options else []
    except Exception as e:
        print(f"   ⚠️  Error parsing spacer options: {e}")
        return []


def handle_spacer_selection_interactive(driver, item_info):
    """
    Handle spacer selection interactively by prompting user
    Returns True if successful, False otherwise
    """
    interactive_prompt = get_interactive_prompt()
    if not interactive_prompt:
        print("   ⚠️  Interactive mode not available for spacer selection")
        return False

    try:
        # Get spacer options
        spacer_options = parse_spacer_options(driver)

        if not spacer_options:
            print("   ⚠️  No spacer options found")
            return False

        print(f"   🔧 Found {len(spacer_options)} spacer option(s)")

        # Prompt user for selection
        prompt_data = {
            "item": item_info,
            "available_options": spacer_options
        }

        response = interactive_prompt.request_user_input("spacer_selection", prompt_data)

        if not response or response.get('action') == 'cancel':
            print("   ❌ Spacer selection cancelled")
            return False

        selected_value = response.get('selected_value')
        selected_text = response.get('selected_text')

        if not selected_value:
            print("   ⚠️  No spacer value selected")
            return False

        print(f"   🔧 Filling spacer selection: {selected_text}")

        # Fill spacer selection using JavaScript
        fill_spacer_js = f"""
        var spacerSelect = document.querySelector('select[name="spacer"]');
        if (!spacerSelect) {{
            var spacerContainer = document.querySelector('p.spacerDropDown');
            if (spacerContainer) {{
                spacerSelect = spacerContainer.querySelector('select');
            }}
        }}

        if (spacerSelect) {{
            spacerSelect.scrollIntoView({{block: 'center', behavior: 'smooth'}});
            spacerSelect.focus();
            spacerSelect.value = '{selected_value}';

            // Trigger all possible events
            var events = ['change', 'input', 'select', 'blur'];
            events.forEach(function(eventType) {{
                var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                spacerSelect.dispatchEvent(event);
            }});

            // Also try jQuery trigger if available
            if (typeof jQuery !== 'undefined') {{
                jQuery(spacerSelect).trigger('change').trigger('blur');
            }}

            return true;
        }}
        return false;
        """

        success = driver.execute_script(fill_spacer_js)

        if success:
            # Give page time to update
            time.sleep(2)
            print("   ✅ Spacer selection filled successfully")
            return True
        else:
            print("   ⚠️  Could not fill spacer selection")
            return False

    except Exception as e:
        print(f"   ❌ Error handling spacer selection: {e}")
        import traceback
        traceback.print_exc()
        return False


def fill_vehicle_form(driver, vehicle_info):
    """
    Fill the vehicle form on SDW product page using human-like interactions
    Returns True if successful, False otherwise
    """
    if not vehicle_info or not vehicle_info.get('year'):
        print("   ⚠️  No vehicle info provided")
        return False

    try:
        print(f"   📝 Filling vehicle form for: {vehicle_info.get('full', 'Unknown')}")

        # Fill Year using JavaScript to trigger all events
        if vehicle_info.get('year'):
            print(f"      📅 Selecting year: {vehicle_info['year']}")

            # Use JavaScript to set value and trigger events
            year_js = f"""
            var select = document.getElementById('year');
            if (select) {{
                // Scroll into view
                select.scrollIntoView({{block: 'center', behavior: 'smooth'}});

                // Focus the element
                select.focus();

                // Set the value
                select.value = '{vehicle_info['year']}';

                // Trigger all possible events that SDW might be listening for
                var events = ['change', 'input', 'select', 'blur'];
                events.forEach(function(eventType) {{
                    var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                    select.dispatchEvent(event);
                }});

                // Also try jQuery trigger if jQuery is available
                if (typeof jQuery !== 'undefined') {{
                    jQuery(select).trigger('change').trigger('blur');
                }}

                return true;
            }}
            return false;
            """

            result = driver.execute_script(year_js)
            if not result:
                print(f"      ❌ Failed to set year dropdown")
                return False

            print(f"      Year: {vehicle_info['year']}")

            # Wait for make dropdown to populate
            print(f"      ⏳ Waiting for Make dropdown to load...")
            time.sleep(3)

            # Wait for make options to appear
            try:
                WebDriverWait(driver, 10).until(
                    lambda d: len(d.find_element(By.ID, "make").find_elements(By.TAG_NAME, "option")) > 1
                )
                print(f"      ✅ Make dropdown loaded")
            except TimeoutException:
                print(f"      ⚠️  Make dropdown did not load - form may not be responding")
                # Try one more time with a direct jQuery approach if available
                retry_js = f"""
                if (typeof jQuery !== 'undefined') {{
                    jQuery('#year').val('{vehicle_info['year']}').change();
                    return true;
                }}
                return false;
                """
                if driver.execute_script(retry_js):
                    print(f"      🔄 Retried with jQuery...")
                    time.sleep(5)
                    try:
                        WebDriverWait(driver, 10).until(
                            lambda d: len(d.find_element(By.ID, "make").find_elements(By.TAG_NAME, "option")) > 1
                        )
                        print(f"      ✅ Make dropdown loaded after retry")
                    except TimeoutException:
                        print(f"      ❌ Make dropdown still did not load")
                        return False
                else:
                    return False

        # Fill Make using JavaScript
        if vehicle_info.get('make'):
            print(f"      🚗 Selecting make...")

            # First, find the correct option value that matches the make
            make_js_find = f"""
            var select = document.getElementById('make');
            if (!select) return null;

            var targetMake = '{vehicle_info['make']}'.toLowerCase();
            var options = select.getElementsByTagName('option');
            var matchedOption = null;

            for (var i = 0; i < options.length; i++) {{
                var optionText = options[i].text || options[i].innerText;
                if (optionText === 'Vehicle Make') continue;  // Skip placeholder

                if (optionText.toLowerCase().includes(targetMake)) {{
                    matchedOption = {{
                        value: options[i].value,
                        text: optionText
                    }};
                    break;
                }}
            }}

            return matchedOption;
            """

            matched_make = driver.execute_script(make_js_find)

            if not matched_make:
                # List available makes
                make_select_elem = driver.find_element(By.ID, "make")
                make_select = Select(make_select_elem)
                available_makes = [opt.text for opt in make_select.options if opt.text != "Vehicle Make"]
                print(f"      ⚠️  Make '{vehicle_info['make']}' not found in dropdown")
                print(f"      Available makes: {', '.join(available_makes[:5])}...")
                return False

            # Now set the make value and trigger events
            make_js_set = f"""
            var select = document.getElementById('make');
            if (select) {{
                select.scrollIntoView({{block: 'center', behavior: 'smooth'}});
                select.focus();
                select.value = '{matched_make['value']}';

                // Trigger all possible events
                var events = ['change', 'input', 'select', 'blur'];
                events.forEach(function(eventType) {{
                    var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                    select.dispatchEvent(event);
                }});

                // Also try jQuery trigger if jQuery is available
                if (typeof jQuery !== 'undefined') {{
                    jQuery(select).trigger('change').trigger('blur');
                }}

                return true;
            }}
            return false;
            """

            result = driver.execute_script(make_js_set)
            if not result:
                print(f"      ❌ Failed to set make dropdown")
                return False

            print(f"      Make: {matched_make['text']}")

            # Wait for model dropdown to populate
            print(f"      ⏳ Waiting for Model dropdown to load...")
            time.sleep(3)

            try:
                WebDriverWait(driver, 10).until(
                    lambda d: len(d.find_element(By.ID, "model").find_elements(By.TAG_NAME, "option")) > 1
                )
                print(f"      ✅ Model dropdown loaded")
            except TimeoutException:
                print(f"      ⚠️  Model dropdown did not load")
                return False

        # Fill Model using JavaScript
        if vehicle_info.get('model'):
            print(f"      🚙 Selecting model...")

            # First, find the correct option value that matches the model
            model_js_find = f"""
            var select = document.getElementById('model');
            if (!select) return null;

            var targetModel = '{vehicle_info['model']}'.toLowerCase();
            var options = select.getElementsByTagName('option');
            var matchedOption = null;

            for (var i = 0; i < options.length; i++) {{
                var optionText = options[i].text || options[i].innerText;
                if (optionText === 'Vehicle Model') continue;  // Skip placeholder

                if (optionText.toLowerCase().includes(targetModel)) {{
                    matchedOption = {{
                        value: options[i].value,
                        text: optionText
                    }};
                    break;
                }}
            }}

            return matchedOption;
            """

            matched_model = driver.execute_script(model_js_find)

            if not matched_model:
                # List available models
                model_select_elem = driver.find_element(By.ID, "model")
                model_select = Select(model_select_elem)
                available_models = [opt.text for opt in model_select.options if opt.text != "Vehicle Model"]
                print(f"      ⚠️  Model '{vehicle_info['model']}' not found in dropdown")
                print(f"      Available models: {', '.join(available_models[:5])}...")
                return False

            # Now set the model value and trigger events
            model_js_set = f"""
            var select = document.getElementById('model');
            if (select) {{
                select.scrollIntoView({{block: 'center', behavior: 'smooth'}});
                select.focus();
                select.value = '{matched_model['value']}';

                // Trigger all possible events
                var events = ['change', 'input', 'select', 'blur'];
                events.forEach(function(eventType) {{
                    var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                    select.dispatchEvent(event);
                }});

                // Also try jQuery trigger if jQuery is available
                if (typeof jQuery !== 'undefined') {{
                    jQuery(select).trigger('change').trigger('blur');
                }}

                return true;
            }}
            return false;
            """

            result = driver.execute_script(model_js_set)
            if not result:
                print(f"      ❌ Failed to set model dropdown")
                return False

            print(f"      Model: {matched_model['text']}")

            # Wait for trim dropdown to populate
            print(f"      ⏳ Waiting for Trim dropdown to load...")
            time.sleep(3)

        # Fill Trim (if available) using JavaScript
        if vehicle_info.get('trim'):
            try:
                # Wait a bit for trim to fully load
                try:
                    WebDriverWait(driver, 5).until(
                        lambda d: len(d.find_element(By.ID, "trim").find_elements(By.TAG_NAME, "option")) > 1
                    )
                except TimeoutException:
                    print(f"      ℹ️  Trim dropdown may not be available for this vehicle")
                    return True  # Still consider it success if trim is optional

                print(f"      🎯 Selecting trim...")

                # Use JavaScript to find best matching trim
                trim_words = ' '.join(vehicle_info['trim'].lower().split())
                trim_js_find = f"""
                var select = document.getElementById('trim');
                if (!select) return null;

                var targetTrim = '{trim_words}'.toLowerCase();
                var trimWords = targetTrim.split(' ');
                var options = select.getElementsByTagName('option');
                var bestMatch = null;
                var bestScore = 0;

                for (var i = 0; i < options.length; i++) {{
                    var optionText = (options[i].text || options[i].innerText).toLowerCase();
                    if (optionText === 'vehicle trim') continue;  // Skip placeholder

                    // Count how many words from our trim appear in this option
                    var score = 0;
                    for (var j = 0; j < trimWords.length; j++) {{
                        if (optionText.includes(trimWords[j])) {{
                            score++;
                        }}
                    }}

                    if (score > bestScore) {{
                        bestScore = score;
                        bestMatch = {{
                            value: options[i].value,
                            text: options[i].text || options[i].innerText
                        }};
                    }}
                }}

                // If no match found, just use first non-placeholder option
                if (!bestMatch) {{
                    for (var i = 0; i < options.length; i++) {{
                        var optionText = (options[i].text || options[i].innerText).toLowerCase();
                        if (optionText !== 'vehicle trim') {{
                            bestMatch = {{
                                value: options[i].value,
                                text: options[i].text || options[i].innerText,
                                fallback: true
                            }};
                            break;
                        }}
                    }}
                }}

                return bestMatch;
                """

                matched_trim = driver.execute_script(trim_js_find)

                if not matched_trim:
                    print(f"      ⚠️  Could not find any trim options")
                    return True  # Still success, trim is optional

                # Now set the trim value and trigger events
                trim_js_set = f"""
                var select = document.getElementById('trim');
                if (select) {{
                    select.scrollIntoView({{block: 'center', behavior: 'smooth'}});
                    select.focus();
                    select.value = '{matched_trim['value']}';

                    // Trigger all possible events
                    var events = ['change', 'input', 'select', 'blur'];
                    events.forEach(function(eventType) {{
                        var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                        select.dispatchEvent(event);
                    }});

                    // Also try jQuery trigger if jQuery is available
                    if (typeof jQuery !== 'undefined') {{
                        jQuery(select).trigger('change').trigger('blur');
                    }}

                    return true;
                }}
                return false;
                """

                result = driver.execute_script(trim_js_set)
                if result:
                    print(f"      Trim: {matched_trim['text']}")
                    if matched_trim.get('fallback'):
                        print(f"      ⚠️  Original trim '{vehicle_info['trim']}' not found, using first available")
                    elif matched_trim['text'].lower() != vehicle_info['trim'].lower():
                        print(f"      ℹ️  Using closest match (Original: {vehicle_info['trim']})")
                else:
                    print(f"      ⚠️  Failed to set trim dropdown, but continuing anyway")
                    return True  # Still success, trim is optional

                time.sleep(1)
            except NoSuchElementException:
                print(f"      ℹ️  Trim field not available")
                pass

        # IMPORTANT: Drivetrain field appears AFTER trim is selected - wait for it
        print(f"      ⏳ Checking for drivetrain field (appears after trim)...")
        time.sleep(3)  # Give time for drivetrain to appear

        # Fill Drivetrain if available - try to match from vehicle info
        try:
            # Extract drivetrain from vehicle info if available (like "AWD", "RWD", "4WD", "FWD")
            target_drivetrain = None
            if vehicle_info and vehicle_info.get('trim'):
                # Check if trim contains drivetrain info
                trim_upper = vehicle_info['trim'].upper()
                for dt in ['AWD', '4WD', 'RWD', 'FWD', '2WD']:
                    if dt in trim_upper:
                        target_drivetrain = dt
                        break

            # Search for drivetrain select element (try multiple IDs and methods)
            drivetrain_check_js = """
            // First try common IDs for drivetrain field
            var possibleIds = ['drive', 'drivetrain', 'drive_train', 'driveTrain', 'vehicle_drivetrain', 'vehicle_drive'];
            var select = null;

            for (var i = 0; i < possibleIds.length; i++) {
                var elem = document.getElementById(possibleIds[i]);
                if (elem && elem.tagName === 'SELECT') {
                    return {exists: true, id: possibleIds[i], method: 'direct_id'};
                }
            }

            // Search all select elements for one with "drive" or "drivetrain" in name/placeholder
            var allSelects = document.getElementsByTagName('select');
            for (var i = 0; i < allSelects.length; i++) {
                var sel = allSelects[i];

                // Check name attribute
                if (sel.name && (sel.name.toLowerCase().includes('drive') || sel.name.toLowerCase().includes('drivetrain'))) {
                    return {exists: true, id: sel.id || sel.name, method: 'name'};
                }

                // Check if first option contains "drivetrain" or "drive train"
                var firstOption = sel.options[0];
                if (firstOption && firstOption.text) {
                    var optText = firstOption.text.toLowerCase();
                    if (optText.includes('drivetrain') || optText.includes('drive train')) {
                        return {exists: true, id: sel.id, method: 'placeholder'};
                    }
                }
            }

            return {exists: false, id: null};
            """

            drivetrain_info = driver.execute_script(drivetrain_check_js)

            if drivetrain_info['exists']:
                print(f"      ✅ Drivetrain field detected (ID: {drivetrain_info['id']})")
                if target_drivetrain:
                    print(f"      🎯 Looking for: {target_drivetrain}")

                # Wait a bit more for options to populate
                time.sleep(2)

                # Try to select matching drivetrain, otherwise select first valid option
                drivetrain_js = f"""
                var select = document.getElementById('{drivetrain_info['id']}');
                if (!select) return null;

                var options = select.getElementsByTagName('option');
                var targetDrivetrain = '{target_drivetrain or ''}';
                var matchedOption = null;
                var firstValidOption = null;

                for (var i = 0; i < options.length; i++) {{
                    var optionText = (options[i].text || options[i].innerText);
                    var optionValue = options[i].value;

                    // Skip empty/placeholder options
                    if (optionText.toLowerCase().includes('vehicle drive') ||
                        optionText.toLowerCase().includes('select') ||
                        optionText === '' ||
                        optionValue === '') {{
                        continue;
                    }}

                    // Save first valid option as fallback
                    if (!firstValidOption) {{
                        firstValidOption = {{value: optionValue, text: optionText}};
                    }}

                    // Check if this matches our target drivetrain
                    if (targetDrivetrain && optionText.toUpperCase().includes(targetDrivetrain)) {{
                        matchedOption = {{value: optionValue, text: optionText}};
                        break;
                    }}
                }}

                // Use matched option if found, otherwise use first valid option
                var selectedOption = matchedOption || firstValidOption;

                if (selectedOption) {{
                    select.value = selectedOption.value;

                    // Trigger events
                    var events = ['change', 'input', 'select', 'blur'];
                    events.forEach(function(eventType) {{
                        var event = new Event(eventType, {{bubbles: true, cancelable: true}});
                        select.dispatchEvent(event);
                    }});

                    if (typeof jQuery !== 'undefined') {{
                        jQuery(select).trigger('change').trigger('blur');
                    }}

                    return {{text: selectedOption.text, matched: !!matchedOption}};
                }}

                return null;
                """

                result = driver.execute_script(drivetrain_js)
                if result:
                    if result.get('matched'):
                        print(f"      🚙 Drivetrain selected: {result['text']} ✓ (matched from vehicle info)")
                    else:
                        print(f"      🚙 Drivetrain selected: {result['text']} (first available)")
                else:
                    print(f"      ⚠️  Drivetrain field found but no valid options available")

                # Give time for any subsequent fields to load
                time.sleep(2)
            else:
                print(f"      ℹ️  No drivetrain field detected (this is normal for many vehicles)")
        except Exception as e:
            print(f"      ⚠️  Error checking drivetrain: {e}")
            import traceback
            traceback.print_exc()

        print("   ✅ Vehicle form filled")
        return True

    except Exception as e:
        print(f"   ❌ Error filling vehicle form: {e}")
        import traceback
        traceback.print_exc()
        return False


def get_available_cards():
    """Get available credit cards from .env"""
    cards = {}
    i = 1
    while True:
        card_name = os.environ.get(f'CARD_{i}_NAME')
        if not card_name:
            break

        cards[i] = {
            'name': card_name,
            'number': os.environ.get(f'CARD_{i}_NUMBER'),
            'exp': os.environ.get(f'CARD_{i}_EXP'),
            'cvv': os.environ.get(f'CARD_{i}_CVV'),
            'zip': os.environ.get(f'CARD_{i}_ZIP'),
            'last4': os.environ.get(f'CARD_{i}_NUMBER', '')[-4:] if os.environ.get(f'CARD_{i}_NUMBER') else ''
        }
        i += 1

    return cards


def select_card():
    """Prompt user to select a credit card"""
    cards = get_available_cards()

    if not cards:
        print("\n❌ No credit cards found in .env file!")
        print("Please add cards in format:")
        print("CARD_1_NAME=Card Name")
        print("CARD_1_NUMBER=1234567890123456")
        print("CARD_1_EXP=12/25")
        print("CARD_1_CVV=123")
        print("CARD_1_ZIP=82801")
        return None

    print("\n" + "="*60)
    print("SELECT CREDIT CARD")
    print("="*60)

    for card_id, card_info in cards.items():
        print(f"{card_id}. {card_info['name']} (****{card_info['last4']})")

    while True:
        try:
            choice = input(f"\nSelect card (1-{len(cards)}): ").strip()
            card_id = int(choice)

            if card_id in cards:
                return cards[card_id]
            else:
                print(f"Invalid choice. Please enter 1-{len(cards)}")
        except ValueError:
            print("Please enter a number")
        except KeyboardInterrupt:
            print("\n\nOperation cancelled by user.")
            sys.exit(0)


def get_processed_orders():
    """Get list of already processed orders from folder names"""
    processed = {}

    if not BASE_DIR.exists():
        return processed

    for folder in BASE_DIR.iterdir():
        if folder.is_dir() and '_' in folder.name:
            parts = folder.name.split('_')
            if len(parts) >= 2:
                shopify_order = parts[0]
                sdw_invoice = '_'.join(parts[1:])

                if shopify_order not in processed:
                    processed[shopify_order] = []

                processed[shopify_order].append({
                    'invoice': sdw_invoice,
                    'folder': folder
                })

    return processed


def check_if_processed(order_number, line_items):
    """Check if order or items have been processed before"""
    processed_orders = get_processed_orders()

    if order_number in processed_orders:
        print(f"\n⚠️  WARNING: Order #{order_number} has been processed before!")
        print(f"   Found {len(processed_orders[order_number])} previous processing(s):")

        for proc in processed_orders[order_number]:
            print(f"   - Invoice: {proc['invoice']}")
            print(f"     Folder: {proc['folder']}")

            # Try to read processing log if it exists
            log_file = proc['folder'] / 'processing_log.json'
            if log_file.exists():
                with open(log_file, 'r') as f:
                    log_data = json.load(f)
                    if 'items_processed' in log_data:
                        print(f"     Items processed: {', '.join(log_data['items_processed'])}")

        return True, processed_orders[order_number]

    return False, []


def add_order_tags(order_id, tags_to_add):
    """Add tags to a Shopify order"""
    mutation = '''
    mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
            order {
                id
                tags
            }
            userErrors {
                field
                message
            }
        }
    }
    '''

    variables = {
        "input": {
            "id": order_id,
            "tags": tags_to_add
        }
    }

    result = execute_graphql_query(mutation, variables)

    if result and 'orderUpdate' in result:
        if result['orderUpdate']['userErrors']:
            print(f"Error adding tags: {result['orderUpdate']['userErrors']}")
            return False
        return True
    return False


def add_order_timeline_comment(order_id, message):
    """Add a timeline comment to a Shopify order"""
    # Extract numeric ID from GraphQL ID
    numeric_id = order_id.split('/')[-1]

    mutation = '''
    mutation orderUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
            order {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
    '''

    variables = {
        "input": {
            "id": order_id,
            "note": message
        }
    }

    result = execute_graphql_query(mutation, variables)

    if result and 'orderUpdate' in result:
        if result['orderUpdate']['userErrors']:
            print(f"Error adding timeline comment: {result['orderUpdate']['userErrors']}")
            return False
        return True
    return False


def fetch_with_zenrows(url, cookies=None, timeout=60):
    """Fetch a page using ZenRows API - matches improved_scraper.py parameters"""
    try:
        # Format cookies for ZenRows
        cookie_str = ''
        if cookies:
            if isinstance(cookies, list):
                cookie_str = '; '.join(f"{c['name']}={c['value']}" for c in cookies)
            elif isinstance(cookies, dict):
                cookie_str = '; '.join(f"{k}={v}" for k, v in cookies.items())

        params = {
            'apikey': ZENROWS_API_KEY,
            'url': url,
            'js_render': 'true',
            'premium_proxy': 'true',
            'proxy_country': 'us',
            'wait': '5000',
            'custom_headers': 'true'
        }

        headers = {
            'Accept': 'text/html',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }

        if cookie_str:
            headers['Cookie'] = cookie_str

        print(f"   🌐 Fetching via ZenRows: {url[:60]}...")

        response = requests.get(
            'https://api.zenrows.com/v1/',
            params=params,
            headers=headers,
            timeout=timeout
        )

        if response.status_code != 200:
            print(f"   ⚠️  ZenRows returned status {response.status_code}")
            return None

        print(f"   ✅ ZenRows fetch successful")
        return response.text

    except Exception as e:
        print(f"   ❌ ZenRows error: {e}")
        return None


def wait_for_element(driver, by, value, timeout=15, condition="presence"):
    """Wait for an element with different conditions"""
    try:
        wait = WebDriverWait(driver, timeout)
        if condition == "clickable":
            element = wait.until(EC.element_to_be_clickable((by, value)))
        elif condition == "visible":
            element = wait.until(EC.visibility_of_element_located((by, value)))
        else:  # presence
            element = wait.until(EC.presence_of_element_located((by, value)))
        return element
    except TimeoutException:
        return None


def extract_waf_challenge(html):
    """Extract AWS WAF challenge data from HTML"""
    soup = BeautifulSoup(html, 'html.parser')

    # Look for AwsWafCaptcha script
    script_tag = soup.find('script', string=re.compile(r'AwsWafCaptcha'))

    # Also try gokuProps
    if not script_tag:
        script_tag = soup.find('script', string=re.compile(r'gokuProps'))

    if not script_tag:
        # Check if challenge scripts are loaded
        challenge_script = soup.find('script', src=re.compile(r'challenge\.js'))
        if challenge_script:
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

        # Try with single quotes if not found
        if not all([key_match, iv_match, context_match]):
            key_match = re.search(r"'key':\s*'([^']+)'", script_content)
            iv_match = re.search(r"'iv':\s*'([^']+)'", script_content)
            context_match = re.search(r"'context':\s*'([^']+)'", script_content)

        # Extract challenge URL
        challenge_match = re.search(r'src=["\']([^"\']+challenge\.js[^"\']*)["\']', str(soup))

        if not all([key_match, iv_match, context_match, challenge_match]):
            print("   ⚠️  WAF challenge detected but couldn't extract all parameters")
            return {'exists': False}

        print("   ✅ Successfully extracted WAF challenge parameters")
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
        print(f"   ⚠️  Error extracting WAF challenge: {e}")
        return {'exists': False}


def solve_waf_challenge(driver, wait_for_element=None):
    """Solve AWS WAF challenge - wait for manual solving or CapSolver"""
    try:
        html = driver.page_source
        waf_data = extract_waf_challenge(html)

        if not waf_data['exists']:
            print("   ℹ️  No WAF challenge detected")
            return True  # Not an error, just no WAF

        print("   🔐 Detected AWS WAF Challenge")

        # Try CapSolver first
        if CAPSOLVER_API_KEY:
            try:
                print("   🤖 Attempting automatic solve with CapSolver...")
                solver = Capsolver(CAPSOLVER_API_KEY)
                solution = solver.solve_aws_waf({
                    'websiteURL': 'https://www.sdwheelwholesale.com/store/wheels',
                    'awsKey': waf_data['gokuProps']['key'],
                    'awsIv': waf_data['gokuProps']['iv'],
                    'awsContext': waf_data['gokuProps']['context'],
                    'awsChallengeJS': waf_data['challengeUrl']
                })

                print("   ✅ WAF solution obtained from CapSolver")

                # Add the WAF token as a cookie
                waf_cookie = {
                    'name': 'aws-waf-token',
                    'value': solution,
                    'domain': '.www.sdwheelwholesale.com',
                    'path': '/',
                    'expires': time.time() + 4 * 24 * 60 * 60,
                    'secure': True,
                    'sameSite': 'Lax'
                }
                driver.add_cookie(waf_cookie)

                print("   🔄 Refreshing with WAF token...")
                driver.refresh()

            except Exception as e:
                print(f"   ⚠️  CapSolver failed: {e}")
                print("   💡 Falling back to manual solve")

        # Wait for the target element to appear (means challenge was solved)
        if wait_for_element:
            by, value = wait_for_element
            print(f"   ⏳ Waiting for page to load after challenge...")
            print(f"   💡 If CapSolver didn't work, please solve the puzzle manually")
            try:
                WebDriverWait(driver, 120).until(  # 2 minute timeout for manual solve
                    EC.presence_of_element_located((by, value))
                )
                print("   ✅ Challenge passed - page loaded successfully!")
                return True
            except TimeoutException:
                print("   ❌ Timeout - challenge was not solved")
                return False
        else:
            # No specific element - just wait a bit
            time.sleep(5)
            return True

    except Exception as e:
        print(f"   ❌ Error handling WAF challenge: {e}")
        import traceback
        traceback.print_exc()
        return False


def handle_initial_captcha(driver):
    """Handle the initial 'Begin' button CAPTCHA - with manual fallback"""
    try:
        print("   🔍 Checking for CAPTCHA...")

        # Wait for the "Begin" button (only 2 seconds)
        try:
            begin_button = WebDriverWait(driver, 2).until(
                EC.element_to_be_clickable((By.ID, "amzn-captcha-verify-button"))
            )
            print("   ✅ Found CAPTCHA button - Clicking...")
            driver.execute_script("arguments[0].click();", begin_button)

            # Wait for button to disappear
            try:
                WebDriverWait(driver, 20).until(EC.invisibility_of_element(begin_button))
                print("   ✅ CAPTCHA button clicked and disappeared")
                time.sleep(3)

                # Try to solve WAF challenge with CapSolver first
                # Wait for cart products (we're on quote page)
                if solve_waf_challenge(driver, wait_for_element=(By.CLASS_NAME, "cart-product")):
                    print("   ✅ WAF challenge handled")
                    return True
                else:
                    print("   ⚠️  WAF challenge solving failed")
                    # Fall through to manual solve

            except TimeoutException:
                print("   ⏳ CAPTCHA button didn't disappear - challenge may be present")
                # Fall through to manual solve

            # Check if we're still seeing the begin button (CapSolver didn't work)
            try:
                still_has_button = driver.find_element(By.ID, "amzn-captcha-verify-button")
                print("\n   ⚠️  CapSolver token was not accepted by AWS WAF")
                print("   💡 This is likely due to browser fingerprinting mismatch")
                print("\n   🖐️  MANUAL SOLVE REQUIRED")
                print("   Please solve the CAPTCHA in the browser window")
                print("   (The script will wait for you to solve it)")

                # Wait for the begin button to disappear (user solves it)
                print("\n   ⏳ Waiting for CAPTCHA to be solved...")
                WebDriverWait(driver, 300).until(  # 5 minute timeout
                    EC.invisibility_of_element_located((By.ID, "amzn-captcha-verify-button"))
                )
                print("   ✅ CAPTCHA solved manually!")
                time.sleep(3)  # Wait for page to load
                return True

            except NoSuchElementException:
                # No button = already solved
                print("   ✅ No CAPTCHA button present")
                return True

        except TimeoutException:
            print("   ℹ️  No CAPTCHA button found after 2 seconds")

            # Check if login form is present (means no captcha needed)
            try:
                login_form = driver.find_element(By.ID, "username")
                print("   ✅ Login form present - no CAPTCHA needed")
                return True
            except NoSuchElementException:
                # Check if we're already past captcha (look for other expected elements)
                try:
                    # Check for quote page elements
                    driver.find_element(By.CLASS_NAME, "cart-product")
                    print("   ✅ Already on quote page - no CAPTCHA needed")
                    return True
                except NoSuchElementException:
                    # Not sure where we are, but no captcha button found
                    print("   ℹ️  No CAPTCHA or login form found - proceeding")
                    return True

    except Exception as e:
        print(f"   ❌ Error handling CAPTCHA: {e}")
        import traceback
        traceback.print_exc()
        return False


def login_to_sdw(driver):
    """Login to SDW Wheel Wholesale - matches improved_scraper.py implementation"""
    if not SDW_EMAIL or not SDW_PASS:
        print("   ❌ SDW credentials not found in .env file")
        return None

    try:
        print("\n🔐 Logging into SDW Wheel Wholesale...")

        # Navigate to correct login page
        login_url = "https://www.sdwheelwholesale.com/auth/login"
        print(f"   📍 Navigating to: {login_url}")
        driver.get(login_url)

        # Wait for and click CAPTCHA button (only 2 seconds)
        print("   ⏳ Checking for CAPTCHA button...")
        try:
            begin_button = WebDriverWait(driver, 2).until(
                EC.element_to_be_clickable((By.ID, "amzn-captcha-verify-button"))
            )
            print("   ✅ Found CAPTCHA button - Clicking...")
            driver.execute_script("arguments[0].click();", begin_button)

            # Wait for button to disappear
            WebDriverWait(driver, 20).until(EC.invisibility_of_element(begin_button))
            print("   ✅ CAPTCHA button clicked and disappeared")

            time.sleep(3)

            # Solve WAF challenge if present - wait for login form after
            print("   🔍 Checking for WAF challenge...")
            waf_solved = solve_waf_challenge(driver, wait_for_element=(By.ID, "login-email"))
            if not waf_solved:
                print("   ⚠️  WAF challenge failed")
                return False

        except TimeoutException:
            print("   ℹ️  No CAPTCHA button found after 2 seconds")

            # Check if login form is already present (no captcha needed)
            try:
                driver.find_element(By.ID, "login-email")
                print("   ✅ Login form already present - no CAPTCHA needed")
            except NoSuchElementException:
                print("   ⚠️  Neither CAPTCHA nor login form found")
                # Continue anyway - might load later

        # Login form should be loaded now (either directly or after WAF solve)
        print("   ⏳ Waiting for login form...")
        try:
            email_field = WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.ID, "login-email"))
            )
            print("   ✅ Login form loaded")
        except TimeoutException:
            print("   ❌ Login form did not load")
            return False

        # Fill in credentials
        print("   📝 Filling in credentials...")
        email_field.send_keys(SDW_EMAIL)

        password_field = driver.find_element(By.ID, "login-pass")
        password_field.send_keys(SDW_PASS)

        # Click login button
        print("   🔑 Submitting login form...")
        submit_button = driver.find_element(By.ID, "submit-btn")
        submit_button.click()

        # Wait for login to complete (URL changes away from auth/login)
        print("   ⏳ Waiting for login to complete...")
        WebDriverWait(driver, 20).until(
            lambda d: "auth/login" not in d.current_url
        )

        current_url = driver.current_url
        print(f"   ✅ Successfully logged in!")
        print(f"   📍 Current URL: {current_url}")

        # Give it a moment to settle
        time.sleep(2)

        # Get cookies for ZenRows
        cookies = driver.get_cookies()
        print(f"   🍪 Extracted {len(cookies)} cookies for session")

        return cookies

    except Exception as e:
        print(f"   ❌ Error during login: {e}")
        import traceback
        traceback.print_exc()
        return None


def complete_checkout_and_submit(driver, order, cart_items, card_info):
    """
    Complete checkout process from cart through submission and invoice capture.
    This function is shared between custom quote and manual search modes.

    Args:
        driver: Selenium WebDriver instance
        order: Shopify order data
        cart_items: List of items in cart (with 'name', 'sku', 'quantity' keys)
        card_info: Selected payment card information

    Returns:
        dict with order_number, invoice_number, processed_skus
    """

    # Uncheck shipping protection
    print("\n🔧 Unchecking shipping protection...")
    try:
        shipping_protection_checkboxes = driver.find_elements(By.CSS_SELECTOR, ".shipping-protection-checkbox.checked")
        for checkbox in shipping_protection_checkboxes:
            checkbox.click()
            time.sleep(0.5)
        print("   ✅ Shipping protection unchecked")
    except Exception as e:
        print(f"   ⚠️  Could not uncheck shipping protection: {e}")

    # Set all additional options to "No" (CRITICAL: This saves us money!)
    print("\n🔧 Setting additional options to 'No'...")
    try:
        # STEP 1: Wait for "Additional Options" section to load (up to 10 seconds)
        print("   ⏳ Waiting for Additional Options section to load...")
        time.sleep(2)  # Initial wait for page to settle

        options_section_loaded = False
        for attempt in range(10):
            dropdowns = driver.find_elements(By.CSS_SELECTOR, ".cart-product-dd")
            if len(dropdowns) > 0:
                print(f"   ✅ Found {len(dropdowns)} add-on dropdowns")
                options_section_loaded = True
                break
            time.sleep(1)

        if not options_section_loaded:
            print("   ⚠️  No add-on dropdowns found - skipping (cart might not have add-ons)")
        else:
            # STEP 2: Set each dropdown to "No" option
            print("   🔧 Setting each add-on to 'No'...")
            dropdowns = driver.find_elements(By.CSS_SELECTOR, ".cart-product-dd")
            changes_made = False

            for idx, dropdown in enumerate(dropdowns):
                try:
                    select = Select(dropdown)
                    current_value = select.first_selected_option.get_attribute('value')
                    current_text = select.first_selected_option.text

                    # Find and select the "No" option
                    no_option_found = False
                    for option in select.options:
                        option_value = option.get_attribute('value')
                        option_text = option.text.strip()

                        # CRITICAL: Match ONLY actual "No" options, NOT header placeholders
                        # Headers like "Valve Stem Options" or "Lug Nut Options" have value=""
                        # Actual "No" options like "No Spiked Valve Stem Caps" start with "No "
                        is_no_option = (
                            option_text.startswith("No ") and  # MUST start with "No "
                            (option_value == '0' or option_value == 'No')  # MUST have valid value (NOT empty string!)
                        )

                        if is_no_option:
                            # Only select if not already selected
                            if current_value != option_value:
                                select.select_by_visible_text(option_text)
                                print(f"      [{idx+1}/{len(dropdowns)}] Changed '{current_text}' → '{option_text}'")
                                changes_made = True
                            else:
                                print(f"      [{idx+1}/{len(dropdowns)}] Already set to '{option_text}' ✓")

                            no_option_found = True
                            break

                    if not no_option_found:
                        print(f"      ⚠️  Dropdown {idx+1}: Could not find 'No' option!")

                except Exception as e:
                    print(f"      ⚠️  Error processing dropdown {idx+1}: {e}")

            # STEP 3: Click UPDATE button if changes were made
            if changes_made:
                print("   📝 Changes made - clicking UPDATE button...")
                try:
                    # Wait for update button to be clickable
                    update_button = WebDriverWait(driver, 5).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, ".cart-product-update-btn"))
                    )
                    update_button.click()
                    print("   ✅ Clicked UPDATE button")

                    # STEP 4: Wait for cart to update (critical!)
                    print("   ⏳ Waiting for cart to update...")
                    time.sleep(5)  # Allow cart to recalculate

                    # STEP 5: Verify add-ons total is $0 or section collapsed
                    try:
                        add_ons_total_elem = driver.find_element(By.CSS_SELECTOR, ".cart-product-options-total")
                        add_ons_total_text = add_ons_total_elem.text.strip()

                        if add_ons_total_text in ['0', '$0', '0.00', '$0.00', '']:
                            print(f"   ✅ Add-ons total verified: ${add_ons_total_text or '0.00'} (SUCCESS!)")
                        else:
                            print(f"   ⚠️  WARNING: Add-ons total is ${add_ons_total_text} (expected $0.00)")
                            print(f"      This might cost extra money - please review!")
                    except NoSuchElementException:
                        print("   ✅ Add-ons section collapsed/removed (all set to No)")

                except TimeoutException:
                    print("   ⚠️  Could not find UPDATE button - changes may not be saved!")
                except Exception as e:
                    print(f"   ⚠️  Error clicking UPDATE button: {e}")
            else:
                print("   ✅ All add-ons already set to 'No' - no update needed")

    except Exception as e:
        print(f"   ⚠️  Error in add-ons processing: {e}")
        import traceback
        print(f"      {traceback.format_exc()}")

    # Final wait to ensure cart is fully updated
    print("   ⏳ Final wait for cart to settle...")
    time.sleep(2)

    # Navigate directly to checkout
    print("\n🛒 Proceeding to checkout...")
    driver.get("https://www.sdwheelwholesale.com/checkout")
    time.sleep(3)

    # Wait for checkout page
    print("   ⏳ Waiting for checkout page to load...")
    if not wait_for_element(driver, By.ID, "first_name", timeout=30):
        print("   ❌ Checkout page did not load")
        return None

    print("   ✅ Navigated to checkout")

    # Fill billing information
    print("\n📝 Filling billing information...")
    try:
        # Business address type
        business_radio = driver.find_element(By.ID, "address_type_business")
        if not business_radio.is_selected():
            business_radio.click()
            time.sleep(0.5)

        # Fill billing fields
        first_name_field = driver.find_element(By.ID, "first_name")
        first_name_field.clear()
        first_name_field.send_keys(BILLING_INFO['first_name'])

        last_name_field = driver.find_element(By.ID, "last_name")
        last_name_field.clear()
        last_name_field.send_keys(BILLING_INFO['last_name'])

        address_street_field = driver.find_element(By.ID, "address_street")
        address_street_field.clear()
        address_street_field.send_keys(BILLING_INFO['street'])

        address_city_field = driver.find_element(By.ID, "address_city")
        address_city_field.clear()
        address_city_field.send_keys(BILLING_INFO['city'])

        # Select state
        state_select = Select(driver.find_element(By.ID, "address_state"))
        state_select.select_by_visible_text(BILLING_INFO['state'])

        address_zip_field = driver.find_element(By.ID, "address_zip")
        address_zip_field.clear()
        address_zip_field.send_keys(BILLING_INFO['zip'])

        payer_email_field = driver.find_element(By.ID, "payer_email")
        payer_email_field.clear()
        payer_email_field.send_keys(BILLING_INFO['email'])

        # Phone from customer - clean it to 10 digits only (form already has +1)
        customer_phone = order['shippingAddress'].get('phone', '')
        # Remove all non-digit characters
        phone_digits = ''.join(filter(str.isdigit, customer_phone))

        # If starts with 1 and has 11 digits, remove the leading 1 (country code)
        if len(phone_digits) == 11 and phone_digits.startswith('1'):
            phone_digits = phone_digits[1:]

        # If not exactly 10 digits, use fallback
        if len(phone_digits) != 10:
            print(f"      ⚠️  Invalid phone number '{customer_phone}', using fallback")
            phone_digits = '3074566378'  # Fallback: 307-456-6378

        print(f"      📞 Phone: {phone_digits[:3]}-{phone_digits[3:6]}-{phone_digits[6:]}")

        phone_field = driver.find_element(By.ID, "phone")
        phone_field.clear()
        phone_field.send_keys(phone_digits)

        # Who sent you
        who_sent_select = Select(driver.find_element(By.ID, "ambassadors"))
        who_sent_select.select_by_value("Customer Service")

        print("   ✅ Billing information filled")
    except Exception as e:
        print(f"   ❌ Error filling billing info: {e}")
        import traceback
        traceback.print_exc()
        return None

    # Check "Different shipping address"
    print("\n📫 Setting up shipping address...")
    try:
        script = """
        var checkbox = document.getElementById('shipping_no');
        if (checkbox && !checkbox.checked) {
            checkbox.click();
            return true;
        }
        return checkbox && checkbox.checked;
        """

        checked = driver.execute_script(script)
        time.sleep(1)

        if checked:
            print("   ✅ 'Different shipping address' checked")
        else:
            print("   ⚠️  Could not check shipping checkbox")
    except Exception as e:
        print(f"   ⚠️  Could not check shipping checkbox: {e}")

    # Fill shipping information
    print("\n📫 Filling shipping information...")
    try:
        shipping_addr = order['shippingAddress']

        print("   ⏳ Waiting for shipping fields to load...")
        time.sleep(2)

        # Address type
        if shipping_addr.get('company'):
            print("   📝 Setting address type to Business...")
            ship_business = wait_for_element(driver, By.ID, "ship_address_type_business", timeout=10, condition="clickable")
            if ship_business:
                driver.execute_script("arguments[0].click();", ship_business)
                time.sleep(0.5)
                print("   📝 Filling business name...")
                business_name_field = driver.find_element(By.ID, "ship_business_name")
                business_name_field.send_keys(shipping_addr['company'])
        else:
            print("   📝 Setting address type to Residential...")
            ship_residential = wait_for_element(driver, By.ID, "ship_address_type_residential", timeout=10, condition="clickable")
            if ship_residential:
                driver.execute_script("arguments[0].click();", ship_residential)

        print("   📝 Filling shipping name...")
        ship_first_name_field = driver.find_element(By.ID, "ship_first_name")
        ship_first_name_field.clear()
        ship_first_name_field.send_keys(shipping_addr.get('firstName', ''))

        ship_last_name_field = driver.find_element(By.ID, "ship_last_name")
        ship_last_name_field.clear()
        ship_last_name_field.send_keys(shipping_addr.get('lastName', ''))

        print("   📝 Filling shipping address...")
        ship_address_street_field = driver.find_element(By.ID, "ship_address_street")
        ship_address_street_field.clear()
        ship_address_street_field.send_keys(shipping_addr.get('address1', ''))

        if shipping_addr.get('address2'):
            try:
                ship_address_street_2_field = driver.find_element(By.ID, "ship_address_street_2")
                # Only interact if the field is displayed and enabled
                if ship_address_street_2_field.is_displayed() and ship_address_street_2_field.is_enabled():
                    ship_address_street_2_field.clear()
                    ship_address_street_2_field.send_keys(shipping_addr['address2'])
            except Exception as e:
                # Address2 field is optional, skip if not available
                print(f"       ⚠️  Could not fill address line 2 (optional field): {e}")
                pass

        print("   📝 Filling city...")
        ship_address_city_field = driver.find_element(By.ID, "ship_address_city")
        ship_address_city_field.clear()
        ship_address_city_field.send_keys(shipping_addr.get('city', ''))

        print("   📝 Selecting state...")
        ship_state_select = Select(driver.find_element(By.ID, "ship_address_state"))
        province_abbr = shipping_addr.get('province', 'WY')
        state_full_name = STATE_MAPPING.get(province_abbr, province_abbr)
        print(f"       Converting {province_abbr} to {state_full_name}")
        ship_state_select.select_by_visible_text(state_full_name)

        print("   📝 Filling zip code...")
        ship_address_zip_field = driver.find_element(By.ID, "ship_address_zip")
        ship_address_zip_field.clear()
        ship_address_zip_field.send_keys(shipping_addr.get('zip', ''))

        print("   ✅ Shipping information filled")

    except Exception as e:
        print(f"   ⚠️  Error filling shipping info: {e}")
        import traceback
        traceback.print_exc()
        print("   💡 Continuing with checkout - please verify shipping info manually")

    # Accept terms and conditions
    print("\n📋 Accepting Terms & Conditions...")
    try:
        terms_checkbox = driver.find_element(By.ID, "text_confirm")
        if not terms_checkbox.is_selected():
            driver.execute_script("arguments[0].click();", terms_checkbox)
            time.sleep(0.5)
        print("   ✅ Terms & Conditions accepted")
    except Exception as e:
        print(f"   ⚠️  Could not check terms checkbox: {e}")

    # Fill payment information
    print(f"\n💳 Filling payment information...")
    print(f"   Using card: {card_info['name']} (****{card_info['number'][-4:]})")
    try:
        # Wait for Braintree iframe
        print("   ⏳ Waiting for Braintree payment form to load...")
        time.sleep(3)

        # Fill all Braintree iframe fields with proper event triggering
        print("   📝 Filling cardholder name...")
        cardholder_iframe = driver.find_element(By.ID, "braintree-hosted-field-cardholderName")
        driver.switch_to.frame(cardholder_iframe)
        cardholder_input = driver.find_element(By.NAME, "cardholder-name")
        cardholder_input.send_keys(f"{BILLING_INFO['first_name']} {BILLING_INFO['last_name']}")
        # Trigger validation events
        driver.execute_script("""
            arguments[0].dispatchEvent(new Event('input', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));
        """, cardholder_input)
        driver.switch_to.default_content()
        time.sleep(0.5)

        print("   📝 Filling card number...")
        card_number_iframe = driver.find_element(By.ID, "braintree-hosted-field-number")
        driver.switch_to.frame(card_number_iframe)
        card_number_input = driver.find_element(By.ID, "credit-card-number")
        card_number_input.send_keys(card_info['number'])
        # Trigger validation events
        driver.execute_script("""
            arguments[0].dispatchEvent(new Event('input', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));
        """, card_number_input)
        driver.switch_to.default_content()
        time.sleep(0.5)

        print("   📝 Filling expiration date...")
        exp_iframe = driver.find_element(By.ID, "braintree-hosted-field-expirationDate")
        driver.switch_to.frame(exp_iframe)
        exp_input = driver.find_element(By.ID, "expiration")
        exp_input.send_keys(card_info['exp'])
        # Trigger validation events
        driver.execute_script("""
            arguments[0].dispatchEvent(new Event('input', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));
        """, exp_input)
        driver.switch_to.default_content()
        time.sleep(0.5)

        print("   📝 Filling CVV...")
        cvv_iframe = driver.find_element(By.ID, "braintree-hosted-field-cvv")
        driver.switch_to.frame(cvv_iframe)
        cvv_input = driver.find_element(By.ID, "cvv")
        cvv_input.send_keys(card_info['cvv'])
        # Trigger validation events
        driver.execute_script("""
            arguments[0].dispatchEvent(new Event('input', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));
        """, cvv_input)
        driver.switch_to.default_content()
        time.sleep(0.5)

        print("   📝 Filling postal code...")
        postal_iframe = driver.find_element(By.ID, "braintree-hosted-field-postalCode")
        driver.switch_to.frame(postal_iframe)
        postal_input = driver.find_element(By.ID, "postal-code")
        postal_input.send_keys(card_info['zip'])
        # Trigger validation events
        driver.execute_script("""
            arguments[0].dispatchEvent(new Event('input', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles: true}));
            arguments[0].dispatchEvent(new Event('blur', {bubbles: true}));
        """, postal_input)
        driver.switch_to.default_content()
        time.sleep(0.5)

        print("   ✅ Payment information filled")

        # Wait for Braintree to validate all fields and enable submit button
        print("\n⏳ Waiting for Braintree validation...")
        time.sleep(3)

        # NOW wait for shipping cost to recalculate
        print("⏳ Waiting for shipping cost to recalculate...")
        time.sleep(8)

    except Exception as e:
        print(f"   ❌ Error filling payment info: {e}")
        import traceback
        traceback.print_exc()
        return None

    # Show order summary and get confirmation
    print("\n" + "="*60)
    print("ORDER SUMMARY")
    print("="*60)
    try:
        # Try to extract order totals (using correct IDs from SDW checkout page)
        subtotal = ""
        shipping = ""
        shipping_protection = ""
        mounting_balancing = ""
        tax = ""
        total = ""

        try:
            subtotal_elem = driver.find_element(By.ID, "subTotal")
            subtotal = subtotal_elem.text.strip()
        except:
            pass

        try:
            shipping_elem = driver.find_element(By.ID, "totalShipping")
            shipping = shipping_elem.text.strip()
        except:
            pass

        try:
            shipping_protection_elem = driver.find_element(By.ID, "totalShippingProtection")
            shipping_protection = shipping_protection_elem.text.strip()
        except:
            pass

        try:
            mounting_balancing_elem = driver.find_element(By.ID, "totalMountBalance")
            mounting_balancing = mounting_balancing_elem.text.strip()
        except:
            pass

        try:
            tax_elem = driver.find_element(By.ID, "totalTax")
            tax = tax_elem.text.strip()
        except:
            tax = "$0.00"

        try:
            total_elem = driver.find_element(By.ID, "totalCost")
            total = total_elem.text.strip()
        except:
            pass

        print(f"SUBTOTAL: {subtotal}")
        print(f"SHIPPING: {shipping}")
        print(f"SHIPPING PROTECTION: {shipping_protection}")
        print(f"MOUNTING & BALANCING: {mounting_balancing}")
        print(f"TAX (PENDING STATE): {tax}")
        print("="*60)
        print(f"TOTAL: {total}")
        print("="*60)

        # Extract numeric values from shipping and total
        shipping_value = "0.00"
        total_value = "0.00"

        try:
            # Remove $ and convert to float
            if shipping:
                shipping_value = shipping.replace('$', '').replace(',', '').strip()
            if total:
                total_value = total.replace('$', '').replace(',', '').strip()
        except:
            pass

        # Output shipping calculation for Node.js to parse (legacy format)
        print(f"\nSHIPPING_CALCULATED:{shipping_value}:{total_value}")
        sys.stdout.flush()  # Force flush to ensure Node.js sees it immediately

        # Output full order summary as JSON for detailed UI
        import json as json_module
        order_summary = {
            "subtotal": subtotal,
            "shipping": shipping,
            "shipping_protection": shipping_protection,
            "mounting_balancing": mounting_balancing,
            "tax": tax,
            "total": total,
            "shipping_value": float(shipping_value) if shipping_value else 0.0,
            "total_value": float(total_value) if total_value else 0.0
        }
        print(f"\nORDER_SUMMARY_JSON:{json_module.dumps(order_summary)}")
        sys.stdout.flush()

    except Exception as e:
        print(f"Could not extract order summary: {e}")
        # Output with zeros if we couldn't extract
        print(f"\nSHIPPING_CALCULATED:0.00:0.00")
        import json as json_module
        order_summary = {
            "subtotal": "$0.00",
            "shipping": "$0.00",
            "shipping_protection": "$0.00",
            "mounting_balancing": "$0.00",
            "tax": "$0.00",
            "total": "$0.00",
            "shipping_value": 0.0,
            "total_value": 0.0
        }
        print(f"\nORDER_SUMMARY_JSON:{json_module.dumps(order_summary)}")
        sys.stdout.flush()

    # Wait for confirmation from Node.js backend via signal file
    print("\n" + "="*60)
    print("⏸️  WAITING FOR USER CONFIRMATION")
    print("="*60)
    print("Waiting for user to confirm purchase in web interface...")
    print("")

    # Create a signal file path based on order number
    signal_dir = Path("/tmp/sdw_signals")
    signal_dir.mkdir(exist_ok=True)
    order_num = order.get('name', '').replace('#', '')
    confirm_file = signal_dir / f"confirm_{order_num}.txt"
    cancel_file = signal_dir / f"cancel_{order_num}.txt"

    # Clean up old signal files
    if confirm_file.exists():
        confirm_file.unlink()
    if cancel_file.exists():
        cancel_file.unlink()

    # Wait for signal file (check every 2 seconds, timeout after 10 minutes)
    max_wait = 600  # 10 minutes
    elapsed = 0

    while elapsed < max_wait:
        if confirm_file.exists():
            print("\n✅ User confirmed purchase")
            confirm_file.unlink()  # Clean up
            break
        elif cancel_file.exists():
            print("\n❌ User cancelled order")
            cancel_file.unlink()  # Clean up
            return None

        time.sleep(2)
        elapsed += 2

    if elapsed >= max_wait:
        print("\n⏱️  Confirmation timeout - order cancelled")
        return None

    # Submit the order
    print("\n🚀 Submitting order...")
    try:
        # Try multiple possible selectors for submit button
        submit_button = None
        possible_selectors = [
            (By.ID, "submit-order"),  # Correct ID from SDW HTML
            (By.ID, "submitOrder"),   # Fallback in case they change it
            (By.CSS_SELECTOR, "button[type='submit']"),
            (By.CSS_SELECTOR, "input[type='submit']"),
            (By.XPATH, "//button[contains(text(), 'Submit')]"),
            (By.XPATH, "//button[contains(text(), 'Place Order')]"),
            (By.XPATH, "//button[contains(text(), 'Choose')]"),  # The button says "Choose Payment"
            (By.XPATH, "//input[@value='Submit Order']"),
        ]

        for by, selector in possible_selectors:
            try:
                submit_button = wait_for_element(driver, by, selector, timeout=5, condition="clickable")
                if submit_button:
                    print(f"   ✅ Found submit button using: {selector}")
                    break
            except:
                continue

        if not submit_button:
            print("   ❌ Could not find submit button with any selector")
            print("   💡 Please submit the order manually in the browser")
            input("\nPress Enter after you've submitted the order and reached confirmation page...")
        else:
            # Scroll to element and use JavaScript click to avoid interception
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", submit_button)
            time.sleep(1)  # Wait for scroll
            try:
                # Try regular click first
                submit_button.click()
                print("   ✅ Order submitted, waiting for response...")
            except Exception as click_error:
                # If regular click fails, use JavaScript click
                print(f"   ⚠️  Regular click failed, using JavaScript click...")
                driver.execute_script("arguments[0].click();", submit_button)
                print("   ✅ Order submitted via JavaScript, waiting for response...")

        # Wait for page to process
        time.sleep(15)

    except Exception as e:
        print(f"   ❌ Error submitting order: {e}")
        import traceback
        traceback.print_exc()
        print("   💡 Please submit the order manually in the browser")
        if is_interactive_mode():
            input("\nPress Enter after you've submitted the order and reached confirmation page...")

    # Check for payment errors
    print("\n🔍 Checking payment status...")
    payment_failed = False

    try:
        # Look for payment error message
        error_divs = driver.find_elements(By.CSS_SELECTOR, "div.error")
        for error_div in error_divs:
            error_text = error_div.text.strip()
            if "Payment Error:" in error_text or "Processor Declined" in error_text:
                print("\n" + "="*60)
                print("❌ PAYMENT FAILED")
                print("="*60)
                print(f"Error: {error_text}")
                print("="*60)
                payment_failed = True
                break

        if payment_failed:
            print("\n⚠️  The order was NOT placed due to payment failure.")
            print("   Please check the card or contact SDW support.")

            # Output failure details as JSON for UI
            import json as json_module
            failure_data = {
                "success": False,
                "error_type": "payment_failed",
                "error_message": error_text,
                "order_number": order.get('name', '').replace('#', '')
            }
            print(f"\nORDER_FAILED_JSON:{json_module.dumps(failure_data)}")
            sys.stdout.flush()

            return None

    except Exception as e:
        print(f"   ⚠️  Error checking for payment errors: {e}")

    # Check if we're on a success page (contains "thank you")
    current_url = driver.current_url
    page_source = driver.page_source.lower()

    print(f"   Current URL: {current_url}")

    if "thank you" in page_source or "thank-you" in current_url:
        print("   ✅ Order placed successfully - found 'thank you' confirmation")

        # IMMEDIATELY tag the order as processed (to prevent duplicate processing)
        print(f"\n🏷️  Adding 'sdw_processed' tag immediately...")
        try:
            order_number = order['name'].replace('#', '')

            # Get current tags
            current_tags = order.get('tags', [])
            if isinstance(current_tags, str):
                current_tags = [tag.strip() for tag in current_tags.split(',') if tag.strip()]

            # Add sdw_processed tag if not already present
            new_tags = current_tags.copy()
            if 'sdw_processed' not in new_tags:
                new_tags.append('sdw_processed')

                # Update tags immediately
                if add_order_tags(order['id'], new_tags):
                    print(f"   ✅ 'sdw_processed' tag added to order #{order_number}")
                else:
                    print(f"   ⚠️  Could not add 'sdw_processed' tag (continuing anyway)")
            else:
                print(f"   ℹ️  Order already has 'sdw_processed' tag")

        except Exception as e:
            print(f"   ⚠️  Error adding immediate tag: {e}")
            print(f"   ℹ️  Continuing with invoice extraction...")

    else:
        print("\n" + "="*60)
        print("❌ ORDER SUBMISSION FAILED")
        print("="*60)
        print("   The order was NOT successfully placed.")
        print("   Did not find 'thank you' confirmation page.")
        print("   Current URL:", current_url)
        print("="*60)
        print("\n⚠️  STOPPING - Will not tag Shopify order")
        print("   Please submit the order manually or investigate the issue")

        # Output failure details as JSON for UI
        import json as json_module
        failure_data = {
            "success": False,
            "error_type": "submission_failed",
            "error_message": "Order submission failed - did not reach confirmation page",
            "current_url": current_url,
            "order_number": order.get('name', '').replace('#', '')
        }
        print(f"\nORDER_FAILED_JSON:{json_module.dumps(failure_data)}")
        sys.stdout.flush()

        return None

    # Try to get invoice number and order details from tracking page (with retries)
    print("\n📄 Looking for invoice number...")
    invoice_number = None
    invoice_total = None
    invoice_items = []

    # Retry logic: Try up to 5 times to fetch invoice
    max_attempts = 5
    attempt = 0

    while attempt < max_attempts and not invoice_number:
        attempt += 1
        try:
            if attempt > 1:
                print(f"\n   🔄 Retry attempt {attempt}/{max_attempts}...")

            # Navigate to tracking page to get the most recent invoice
            tracking_url = f"https://www.sdwheelwholesale.com/track?email={BILLING_INFO['email']}"
            print(f"   🌐 Navigating to tracking page: {tracking_url}")
            driver.get(tracking_url)

            # Wait for page to load (shorter wait, check for elements)
            time.sleep(3)

            # Look for the most recent invoice (first one on page)
            try:
                # Wait for order cards to appear
                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "li.mo-item"))
                )

                # Find all order cards
                order_cards = driver.find_elements(By.CSS_SELECTOR, "li.mo-item")

                if order_cards:
                    print(f"   ✅ Found {len(order_cards)} order(s) on tracking page")
                    # Get the first card (most recent)
                    first_card = order_cards[0]

                    # Extract invoice number
                    try:
                        invoice_elem = first_card.find_element(By.CSS_SELECTOR, "div.mo-num")
                        invoice_text = invoice_elem.text
                        invoice_match = re.search(r'#?(\d{7,})', invoice_text)
                        if invoice_match:
                            invoice_number = invoice_match.group(1)
                            print(f"   ✅ Invoice number found: {invoice_number}")
                    except Exception as e:
                        print(f"   ⚠️  Could not extract invoice number from card: {e}")

                    # Extract total price
                    try:
                        total_elem = first_card.find_element(By.CSS_SELECTOR, "div.mo-total")
                        total_text = total_elem.text.strip().replace('$', '').replace(',', '')
                        invoice_total = total_text
                        print(f"   ✅ Invoice total found: ${invoice_total}")
                    except Exception as e:
                        print(f"   ⚠️  Could not extract total: {e}")

                    # Extract item names from "mo-includes" div
                    try:
                        includes_div = first_card.find_element(By.CSS_SELECTOR, "div.mo-includes")
                        # Get all text content and clean it up
                        items_text = includes_div.text.strip()
                        # The text usually says "This order includes: " followed by items
                        if items_text:
                            # Remove the header text
                            items_text = items_text.replace('This order includes:', '').strip()
                            invoice_items.append(items_text)
                            print(f"   ✅ Invoice items found")
                    except Exception as e:
                        print(f"   ⚠️  Could not extract items: {e}")

                else:
                    print(f"   ⚠️  No order cards found on tracking page")

                # Alternative: look for invoice numbers in page source
                if not invoice_number:
                    print(f"   🔍 Searching page source for invoice number...")
                    all_text = driver.page_source
                    invoice_matches = re.findall(r'Invoice\s*#(\d{7,})', all_text)
                    if invoice_matches:
                        invoice_number = invoice_matches[0]
                        print(f"   ✅ Invoice number found in page source: {invoice_number}")

            except TimeoutException:
                print(f"   ⏱️  Timeout waiting for order cards (attempt {attempt}/{max_attempts})")
            except Exception as e:
                print(f"   ⚠️  Error extracting invoice from tracking page: {e}")

        except Exception as e:
            print(f"   ⚠️  Error navigating to tracking page: {e}")

        # If we didn't find invoice, wait before retrying
        if not invoice_number and attempt < max_attempts:
            wait_time = 3
            print(f"   ⏳ Waiting {wait_time} seconds before retry...")
            time.sleep(wait_time)

        # Fallback: Manual input (only in interactive mode)
        if not invoice_number and is_interactive_mode():
            print("   ⚠️  Could not automatically detect invoice number")
            print("   Please check the tracking page and enter the invoice number manually")

            while True:
                try:
                    invoice_input = input("\nEnter SDW Invoice Number (or press Enter to skip): ").strip().replace('#', '')
                    if not invoice_input:
                        print("   Skipping invoice capture...")
                        break
                    if invoice_input.isdigit():
                        invoice_number = invoice_input
                        break
                    else:
                        print("Please enter a valid invoice number (numbers only)")
                except KeyboardInterrupt:
                    print("\n\nSkipping invoice capture...")
                    break
        elif not invoice_number:
            print("   ⚠️  Could not automatically detect invoice number (non-interactive mode)")

    except Exception as e:
        print(f"   ⚠️  Error getting invoice number: {e}")

    # Get order details for processing log
    order_number = order['name'].replace('#', '')
    processed_skus = [item['sku'] for item in cart_items]

    # Add invoice number tag (sdw_processed was already added immediately after confirmation)
    if invoice_number:
        print(f"\n🏷️  Adding invoice number tag...")
        try:
            # Get current tags
            current_tags = order.get('tags', [])
            if isinstance(current_tags, str):
                current_tags = [tag.strip() for tag in current_tags.split(',') if tag.strip()]

            # Add invoice number as a tag (sdw_processed should already be present)
            new_tags = current_tags.copy()
            if invoice_number not in new_tags:
                new_tags.append(invoice_number)

                # Update tags
                if add_order_tags(order['id'], new_tags):
                    print(f"   ✅ Invoice tag added: {invoice_number}")
                else:
                    print(f"   ⚠️  Could not add invoice tag")
            else:
                print(f"   ℹ️  Invoice number already in tags")

        except Exception as e:
            print(f"   ⚠️  Error tagging order: {e}")

    # Add timeline comment (only if we have invoice number)
    if invoice_number:
        print(f"\n💬 Adding timeline comment to Shopify order...")
        try:
            # Build comment with line items
            comment_message = f"SDW Order Processed\n\n"
            comment_message += f"Invoice: {invoice_number}\n"

            # Add total from tracking page if available
            if invoice_total:
                comment_message += f"Total: ${invoice_total}\n"

            comment_message += f"Processed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"

            # Add line items with product names
            comment_message += "Items Fulfilled:\n"
            for item in cart_items:
                comment_message += f"  - {item['name']} (SKU: {item['sku']}, Qty: {item['quantity']})\n"

            # Note: This updates the order note field. For timeline events, we'd need a different approach
            # The current GraphQL mutation adds to the note field
            current_note = order.get('note', '')
            if current_note:
                comment_message = current_note + "\n\n" + comment_message

            if add_order_timeline_comment(order['id'], comment_message):
                print(f"   ✅ Timeline comment added")
            else:
                print(f"   ⚠️  Could not add timeline comment")

        except Exception as e:
            print(f"   ⚠️  Error adding timeline comment: {e}")
    else:
        print("\n⚠️  Could not retrieve invoice number from tracking page")
        print("   ℹ️  Order was successfully placed and tagged with 'sdw_processed'")
        print("   ℹ️  You may need to manually find the invoice number in SDW")

    # Final summary
    print("\n" + "="*60)
    print("ORDER PROCESSING COMPLETE")
    print("="*60)
    print(f"Shopify Order: #{order_number}")
    if invoice_number:
        print(f"SDW Invoice: {invoice_number}")
    print("="*60)

    # Output success details as JSON for UI
    import json as json_module
    success_data = {
        "success": True,
        "order_number": order_number,
        "invoice_number": invoice_number,
        "invoice_total": invoice_total if invoice_total else None,
        "processed_items": cart_items
    }
    print(f"\nORDER_COMPLETE_JSON:{json_module.dumps(success_data)}")
    sys.stdout.flush()

    return {
        'order_number': order_number,
        'invoice_number': invoice_number,
        'processed_skus': processed_skus
    }


def process_custom_quote(driver, order, quote_link, card_info):
    """Process a custom quote order"""

    # Login first and get cookies!
    cookies = login_to_sdw(driver)
    if not cookies:
        print("❌ Failed to login to SDW")
        return None

    print("\n🌐 Loading quote page via ZenRows...")

    # Try ZenRows first with authenticated cookies
    html = fetch_with_zenrows(quote_link, cookies)

    if html:
        # Check for CAPTCHA/WAF in ZenRows response
        waf_data = extract_waf_challenge(html)

        if waf_data['exists']:
            print("   🔐 WAF challenge detected in ZenRows response")
            print("   💡 Solving with CapSolver...")

            if CAPSOLVER_API_KEY:
                try:
                    solver = Capsolver(CAPSOLVER_API_KEY)
                    solution = solver.solve_aws_waf({
                        'websiteURL': 'https://www.sdwheelwholesale.com/store/wheels',
                        'awsKey': waf_data['gokuProps']['key'],
                        'awsIv': waf_data['gokuProps']['iv'],
                        'awsContext': waf_data['gokuProps']['context'],
                        'awsChallengeJS': waf_data['challengeUrl']
                    })

                    print("   ✅ WAF solution obtained")

                    # Add WAF cookie to our cookie list
                    waf_cookie = {
                        'name': 'aws-waf-token',
                        'value': solution,
                        'domain': '.www.sdwheelwholesale.com',
                        'path': '/',
                        'expires': time.time() + 4 * 24 * 60 * 60,
                        'secure': True,
                        'sameSite': 'Lax'
                    }
                    cookies.append(waf_cookie)

                    # Retry with WAF cookie
                    print("   🔄 Retrying ZenRows with WAF token...")
                    html = fetch_with_zenrows(quote_link, cookies)

                except Exception as e:
                    print(f"   ⚠️  CapSolver failed: {e}")
                    html = None

    # If ZenRows failed or we need browser for forms, use Selenium
    if not html or 'cart-product' not in html:
        print("   ⚠️  ZenRows didn't work, falling back to Selenium...")

        # Add all cookies to browser
        driver.get(quote_link)
        for cookie in cookies:
            try:
                driver.add_cookie(cookie)
            except:
                pass

        driver.refresh()
        time.sleep(3)

        # Handle CAPTCHA if present
        print("\n🔐 Checking for security challenges...")
        if not handle_initial_captcha(driver):
            print("❌ Failed to handle CAPTCHA")
            return None
    else:
        print("   ✅ Quote page loaded via ZenRows")

        # Load the page in Selenium browser for form interaction
        print("   🌐 Loading page in browser for form filling...")
        driver.get(quote_link)

        # Add cookies to browser
        for cookie in cookies:
            try:
                driver.add_cookie(cookie)
            except:
                pass

        driver.refresh()
        time.sleep(3)

    # Wait for page to load - give it extra time after manual solve
    print("\n⏳ Waiting for quote page to fully load...")
    cart_loaded = wait_for_element(driver, By.CLASS_NAME, "cart-product", timeout=30)

    if not cart_loaded:
        # Try alternate selector
        cart_loaded = wait_for_element(driver, By.CSS_SELECTOR, "ul.cart-products", timeout=10)

    if not cart_loaded:
        print("❌ Failed to load quote page - cart products not found")
        print(f"   Current URL: {driver.current_url}")
        return None

    print("✅ Quote page loaded successfully")

    # Get line items from quote
    try:
        cart_products = driver.find_elements(By.CLASS_NAME, "cart-product")
        print(f"\n📋 Found {len(cart_products)} item(s) in quote")

        # Extract SKUs and quantities from quote
        quote_items = []
        for product in cart_products:
            try:
                sku_elem = product.find_element(By.CLASS_NAME, "cart-product-partnumber")
                sku = sku_elem.text.strip()

                qty_input = product.find_element(By.CSS_SELECTOR, "input.cart-product-qty-input")
                quantity = int(qty_input.get_attribute('value'))

                product_name = product.find_element(By.CLASS_NAME, "cart-product-title").text.strip()

                quote_items.append({
                    'sku': sku,
                    'quantity': quantity,
                    'name': product_name
                })

                print(f"   - {product_name}")
                print(f"     SKU: {sku}, Qty: {quantity}")
            except Exception as e:
                print(f"⚠️  Warning: Could not parse product: {e}")
                continue

    except Exception as e:
        print(f"❌ Error reading quote items: {e}")
        return None

    # Validate against Shopify order
    print("\n🔍 Validating quote against Shopify order...")
    shopify_skus = {}
    for edge in order['lineItems']['edges']:
        item = edge['node']
        if not should_skip_item(item['name']):
            sku = item.get('sku', '')
            qty = item['quantity']
            shopify_skus[sku] = {'quantity': qty, 'name': item['name']}

    # Check for mismatches
    validation_errors = []
    for quote_item in quote_items:
        sku = quote_item['sku']
        if sku in shopify_skus:
            if quote_item['quantity'] != shopify_skus[sku]['quantity']:
                validation_errors.append(
                    f"Quantity mismatch for {sku}: Quote={quote_item['quantity']}, Shopify={shopify_skus[sku]['quantity']}"
                )
            print(f"   ✅ {sku} validated")
        else:
            validation_errors.append(f"SKU {sku} in quote but not in Shopify order")

    if validation_errors:
        print("\n⚠️  VALIDATION WARNINGS:")
        for error in validation_errors:
            print(f"   - {error}")

        while True:
            try:
                response = input("\nDo you want to continue anyway? (y/n): ").strip().lower()
                if response in ['y', 'yes']:
                    break
                elif response in ['n', 'no']:
                    print("Order cancelled.")
                    return None
            except KeyboardInterrupt:
                print("\n\nOperation cancelled.")
                return None
    else:
        print("   ✅ All SKUs and quantities validated")

    # Use shared checkout and submission flow
    return complete_checkout_and_submit(driver, order, quote_items, card_info)


def process_manual_search(driver, order, card_info, selected_line_items=None):
    """Process order by manually searching for items on SDW

    Args:
        driver: Selenium WebDriver instance
        order: Shopify order data
        card_info: Payment card information
        selected_line_items: Optional list of line item IDs to process (filters which items to process)
    """

    # Check if order already has sdw_processed tag
    current_tags = order.get('tags', [])
    if isinstance(current_tags, str):
        current_tags = [tag.strip() for tag in current_tags.split(',') if tag.strip()]

    if 'sdw_processed' in current_tags:
        print("\n" + "⚠️ " * 30)
        print("⚠️  CAUTION: THIS ORDER HAS ALREADY BEEN PROCESSED")
        print("⚠️ " * 30)
        print(f"\n   Order #{order.get('name', '').replace('#', '')} has the 'sdw_processed' tag")
        print("   This means the order was already submitted to SDW.")
        print("\n   📋 Current tags:", ', '.join(current_tags))
        print("\n   ⚠️  Processing this order again may result in duplicate orders!")
        print("\n" + "⚠️ " * 30)

        # In non-interactive mode, stop immediately
        interactive_prompt = get_interactive_prompt()
        if interactive_prompt:
            # Interactive mode - ask user to confirm
            prompt_data = {
                "order_number": order.get('name', '').replace('#', ''),
                "tags": current_tags,
                "message": "This order has already been processed (has sdw_processed tag). Processing again may create duplicate orders.",
                "options": [
                    {"value": "proceed", "label": "⚠️ Proceed Anyway (Risk of Duplicate)"},
                    {"value": "cancel", "label": "❌ Cancel Processing"}
                ]
            }

            response = interactive_prompt.request_user_input("already_processed_warning", prompt_data)

            if not response or response.get('action') != 'proceed':
                print("\n   ❌ Processing cancelled by user")
                return None
            else:
                print("\n   ⚠️  User chose to proceed despite warning")
        else:
            # Non-interactive: stop immediately
            print("\n   ❌ Cannot proceed - order already processed")
            print("   Remove the 'sdw_processed' tag if you want to reprocess this order")
            return None

    # Login first and get cookies
    cookies = login_to_sdw(driver)
    if not cookies:
        print("❌ Failed to login to SDW")
        return None

    # Extract vehicle information
    print("\n🚗 Extracting vehicle information...")

    # Check if vehicle info was provided via override (from form input)
    vehicle_info = None
    if order.get('_override_vehicle'):
        print(f"   ✅ Using provided vehicle info: {order['_override_vehicle']}")
        vehicle_info = parse_vehicle_info(order['_override_vehicle'])
        if vehicle_info:
            print(f"      Year: {vehicle_info['year']}")
            print(f"      Make: {vehicle_info['make']}")
            print(f"      Model: {vehicle_info['model']}")
            if vehicle_info['trim']:
                print(f"      Trim: {vehicle_info['trim']}")
        else:
            print(f"   ⚠️  Could not parse provided vehicle info")
            vehicle_info = None

    # If no override, try to extract from order
    if not vehicle_info:
        vehicle_str = extract_vehicle_info(order)

        if vehicle_str:
            print(f"   ✅ Found vehicle info from order: {vehicle_str}")
            vehicle_info = parse_vehicle_info(vehicle_str)
            if vehicle_info:
                print(f"      Year: {vehicle_info['year']}")
                print(f"      Make: {vehicle_info['make']}")
                print(f"      Model: {vehicle_info['model']}")
                if vehicle_info['trim']:
                    print(f"      Trim: {vehicle_info['trim']}")
            else:
                print(f"   ⚠️  Could not parse vehicle info")
                vehicle_info = None
        else:
            print(f"   ⚠️  No vehicle information found")
            # Ask if they want to enter manually (only in interactive mode)
            if is_interactive_mode():
                while True:
                    try:
                        response = input("\n   Enter vehicle info manually? (y/n): ").strip().lower()
                        if response in ['y', 'yes']:
                            vehicle_input = input("   Vehicle (e.g., '2022 Honda Civic EX'): ").strip()
                            if vehicle_input:
                                vehicle_info = parse_vehicle_info(vehicle_input)
                                if vehicle_info:
                                    print(f"   ✅ Vehicle info added")
                                    break
                                else:
                                    print(f"   ⚠️  Could not parse vehicle info, try again")
                            else:
                                vehicle_info = None
                                break
                        elif response in ['n', 'no']:
                            print(f"   ⚠️  Cannot proceed without vehicle info for wheels/tires")
                            return None
                    except KeyboardInterrupt:
                        print("\n\nOperation cancelled.")
                        return None
            else:
                # Non-interactive mode: vehicle_info remains None (will be handled later)
                vehicle_info = None

    # Collect items to process (wheels and tires only)
    items_to_process = []

    # Debug: Show selected line items if provided
    if selected_line_items is not None:
        print(f"\n📋 Selected line item IDs: {selected_line_items}")

    for edge in order['lineItems']['edges']:
        item = edge['node']

        # If selected_line_items is provided, only process items in that list
        if selected_line_items is not None:
            # Extract numeric ID from GraphQL GID format (gid://shopify/LineItem/12345 -> 12345)
            item_id = item['id']
            numeric_id = item_id.split('/')[-1] if '/' in item_id else item_id

            # Check if this item ID (or numeric ID) is in the selected list
            # Support both formats: numeric (123) and GraphQL GID (gid://shopify/LineItem/123)
            is_selected = (
                str(numeric_id) in [str(x) for x in selected_line_items] or
                item_id in selected_line_items
            )

            if not is_selected:
                print(f"\n⏭️  Skipping (not selected): {item['name']} [ID: {numeric_id}]")
                continue
            else:
                print(f"\n✅ Selected: {item['name']} [ID: {numeric_id}]")

        # Skip items that should be skipped
        if should_skip_item(item['name']):
            print(f"\n⏭️  Skipping: {item['name']}")
            continue

        # Determine product type
        if is_wheel(item):
            product_type = 'wheel'
        elif is_tire(item):
            product_type = 'tire'
        else:
            print(f"\n⏭️  Skipping (not wheel or tire): {item['name']}")
            continue

        items_to_process.append({
            'name': item['name'],
            'sku': item.get('sku', ''),
            'quantity': item['quantity'],
            'product_type': product_type
        })

    if not items_to_process:
        print("\n❌ No wheels or tires found in order")
        return None

    print(f"\n📋 Found {len(items_to_process)} item(s) to process")

    # Output items being processed as JSON for UI
    import json as json_module
    print(f"\nITEMS_TO_PROCESS_JSON:{json_module.dumps(items_to_process)}")
    sys.stdout.flush()

    # Process each item
    cart_items = []
    for idx, item in enumerate(items_to_process, 1):
        print(f"\n[{idx}/{len(items_to_process)}] Processing: {item['name']}")
        print(f"   SKU: {item['sku']}, Qty: {item['quantity']}, Type: {item['product_type']}")

        # Get url_part_number from database
        print(f"   📊 Looking up in database...")
        url_part_number = get_url_part_number(item['sku'], item['product_type'])

        if url_part_number:
            print(f"   ✅ Found URL part number: {url_part_number}")
        else:
            print(f"   ⚠️  SKU {item['sku']} not found in database - will use fallback verification")

        # Search for product on SDW using original part number, verify with URL part number (or fallback if None)
        product_url = search_product_on_sdw(driver, item['sku'], url_part_number, item['product_type'])

        if not product_url:
            print(f"   ❌ Product not found on SDW")
            response = safe_input(f"   Continue without this item? (y/n): ", default='y')
            if response in ['n', 'no']:
                print("Order processing cancelled.")
                return None
            continue

        # Navigate to product page
        print(f"   🌐 Opening product page...")
        driver.get(product_url)
        time.sleep(3)

        # Check if we have vehicle info to attempt auto-fill
        form_filled = False
        if vehicle_info and vehicle_info.get('year'):
            # Try to fill vehicle form automatically
            form_filled = fill_vehicle_form(driver, vehicle_info)
        else:
            print(f"   ℹ️  No vehicle info provided, offering interactive form...")

        # If auto-fill failed or no vehicle info, offer interactive form
        if not form_filled:
            if vehicle_info and vehicle_info.get('year'):
                print(f"   ❌ Failed to fill vehicle form automatically")

            # Get interactive prompt handler
            interactive_prompt = get_interactive_prompt()

            if interactive_prompt:
                # Non-blocking interactive prompt via frontend
                prompt_data = {
                    "item": {
                        "name": item['name'],
                        "sku": item.get('sku', ''),
                        "quantity": item['quantity']
                    },
                    "options": [
                        {"value": "interactive_form", "label": "Interactive Vehicle Info Form"},
                        {"value": "cancel", "label": "Cancel order processing"}
                    ]
                }

                response_data = interactive_prompt.request_user_input("vehicle_form_needed", prompt_data)

                if not response_data or response_data.get('action') == 'cancel':
                    print("   ❌ Order processing cancelled.")
                    return None
                elif response_data.get('action') == 'interactive_form':
                    # User wants to fill form interactively step-by-step
                    print(f"   🎯 Starting interactive vehicle form...")
                    item_info = {
                        "name": item['name'],
                        "sku": item.get('sku', ''),
                        "quantity": item['quantity']
                    }
                    form_filled = fill_vehicle_form_interactive(driver, item_info)
                    if not form_filled:
                        print(f"   ❌ Interactive form filling failed or was cancelled")
                        print(f"   ⏭️  Skipping this item")
                        continue
                    # If successful, proceed with adding to cart below
            else:
                # Fallback to blocking console input (for local testing)
                print(f"\n   💡 Options:")
                print(f"      1. Fill the form manually in the browser and add to cart")
                print(f"      2. Skip this item")
                print(f"      3. Cancel order processing")

                while True:
                    try:
                        response = input(f"\n   Choose option (1/2/3): ").strip()
                        if response == '1':
                            print(f"\n   👉 Please fill the vehicle form manually in the browser window")
                            print(f"      Then set quantity to {item['quantity']} and click 'Buy Wheels Only'")
                            input(f"\n   Press Enter once you've added the item to cart...")
                            cart_items.append(item)
                            print(f"   ✅ Item marked as added to cart")
                            break
                        elif response == '2':
                            print(f"   ⏭️  Skipping this item")
                            break
                        elif response == '3':
                            print("   ❌ Order processing cancelled.")
                            return None
                        else:
                            print("   Invalid option. Please enter 1, 2, or 3")
                    except KeyboardInterrupt:
                        print("\n\n   ❌ Operation cancelled.")
                        return None

                if response in ['1', '2']:
                    continue

            # After manual add or retry success, check if we should skip to next item
            if form_filled:
                # Form was filled (either initially or after retry), proceed with auto add to cart
                pass
            else:
                # Form still not filled, item was handled manually or skipped
                continue

        # Check for spacer recommendations after vehicle form is filled
        print(f"   🔍 Checking for spacer recommendations...")
        has_spacers = detect_spacer_dropdown(driver)

        if has_spacers:
            print(f"   🔧 Spacer dropdown detected!")
            # Handle spacer selection interactively
            item_info = {
                "name": item['name'],
                "sku": item.get('sku', ''),
                "quantity": item['quantity']
            }
            spacer_selected = handle_spacer_selection_interactive(driver, item_info)
            if not spacer_selected:
                print(f"   ⚠️  Spacer selection failed or was skipped")
                # Continue anyway - spacer is optional
        else:
            print(f"   ℹ️  No spacer recommendations found")

        # Automated filling succeeded - proceed with automatic add to cart
        # Set quantity (target the visible input with class itemQuantity, not the hidden one)
        try:
            quantity_input = driver.find_element(By.CSS_SELECTOR, "input.itemQuantity[type='number']")
            quantity_input.clear()
            quantity_input.send_keys(str(item['quantity']))
            print(f"   📝 Set quantity to {item['quantity']}")
        except Exception as e:
            print(f"   ⚠️  Could not set quantity: {e}")

        # Click "Buy Wheels Only" or "Buy Tires Only" button
        print(f"   🛒 Adding to cart...")
        try:
            if item['product_type'] == 'wheel':
                # Try multiple selectors for wheels
                add_button = None
                try:
                    add_button = driver.find_element(By.CSS_SELECTOR, "a.addToCart[data-site='sdw']")
                except:
                    try:
                        add_button = driver.find_element(By.XPATH, "//a[contains(text(), 'Buy Wheels Only')]")
                    except:
                        pass

                if add_button:
                    driver.execute_script("arguments[0].click();", add_button)

                    # Wait for cart to update (can take a few seconds)
                    print(f"   ⏳ Waiting for cart to update...")
                    time.sleep(5)

                    # Verify item was added by checking if we can access cart
                    added_successfully = False
                    try:
                        # Navigate to cart to verify
                        driver.get("https://www.sdwheelwholesale.com/cart")
                        time.sleep(2)

                        # Check if checkout button exists (means cart has items)
                        checkout_btn = driver.find_elements(By.CSS_SELECTOR, "a.checkout-btn")
                        if checkout_btn and checkout_btn[0].is_displayed():
                            added_successfully = True

                        # Also verify by checking for cart products
                        if not added_successfully:
                            cart_products = driver.find_elements(By.CLASS_NAME, "cart-product")
                            if cart_products:
                                added_successfully = True
                    except:
                        pass

                    if added_successfully:
                        print(f"   ✅ Added to cart (verified by cart page)")
                        cart_items.append(item)
                    else:
                        print(f"   ⚠️  Item may not have been added to cart")
                        # Don't add to cart_items if we're not sure it worked
                else:
                    print(f"   ❌ Could not find 'Buy Wheels Only' button")
            else:  # tire
                # Try to find add to cart button for tires
                add_button = None
                try:
                    add_button = driver.find_element(By.CSS_SELECTOR, "a.addTireToCart")
                except:
                    try:
                        add_button = driver.find_element(By.XPATH, "//a[contains(text(), 'Buy Tires Only')]")
                    except:
                        pass

                if add_button:
                    driver.execute_script("arguments[0].click();", add_button)

                    # Wait for cart to update (can take a few seconds)
                    print(f"   ⏳ Waiting for cart to update...")
                    time.sleep(5)

                    # Verify item was added by checking if we can access cart
                    added_successfully = False
                    try:
                        # Navigate to cart to verify
                        driver.get("https://www.sdwheelwholesale.com/cart")
                        time.sleep(2)

                        # Check if checkout button exists (means cart has items)
                        checkout_btn = driver.find_elements(By.CSS_SELECTOR, "a.checkout-btn")
                        if checkout_btn and checkout_btn[0].is_displayed():
                            added_successfully = True

                        # Also verify by checking for cart products
                        if not added_successfully:
                            cart_products = driver.find_elements(By.CLASS_NAME, "cart-product")
                            if cart_products:
                                added_successfully = True
                    except:
                        pass

                    if added_successfully:
                        print(f"   ✅ Added to cart (verified by cart page)")
                        cart_items.append(item)
                    else:
                        print(f"   ⚠️  Item may not have been added to cart")
                else:
                    print(f"   ❌ Could not find add to cart button for tires")

        except Exception as e:
            print(f"   ❌ Error adding to cart: {e}")
            import traceback
            traceback.print_exc()

    if not cart_items:
        print("\n❌ No items were added to cart")
        return None

    print(f"\n✅ Successfully added {len(cart_items)} item(s) to cart")

    # Ensure we're on cart page for checkout process
    current_url = driver.current_url
    if "cart" not in current_url.lower():
        print(f"\n🛒 Navigating to cart...")
        driver.get("https://www.sdwheelwholesale.com/cart")
        time.sleep(3)
    else:
        print(f"\n✅ Already on cart page")

    # Verify cart actually has items before proceeding
    print(f"   🔍 Verifying cart contents...")
    try:
        # Check for cart products
        cart_products = driver.find_elements(By.CLASS_NAME, "cart-product")

        if not cart_products:
            # Also check for empty cart message
            empty_cart_indicators = [
                (By.XPATH, "//*[contains(text(), 'Your cart is empty')]"),
                (By.XPATH, "//*[contains(text(), 'cart is empty')]"),
                (By.CSS_SELECTOR, ".empty-cart"),
            ]

            is_empty = False
            for by, selector in empty_cart_indicators:
                try:
                    if driver.find_elements(by, selector):
                        is_empty = True
                        break
                except:
                    continue

            if is_empty or not cart_products:
                print(f"   ❌ Cart is empty! Items were not successfully added.")
                print(f"   💡 This likely means the vehicle form was incomplete or add to cart failed.")
                return None

        print(f"   ✅ Cart contains {len(cart_products)} product(s)")
    except Exception as e:
        print(f"   ⚠️  Could not verify cart contents: {e}")
        # Ask user to confirm
        response = input("\n   ⚠️  Cannot verify cart has items. Continue anyway? (y/n): ").strip().lower()
        if response not in ['y', 'yes']:
            print("   ❌ Order processing cancelled")
            return None

    # Use shared checkout and submission flow
    return complete_checkout_and_submit(driver, order, cart_items, card_info)


def main():
    print("\n" + "="*60)
    print("SDW ORDER AUTOMATION")
    print("="*60)

    # Verify credentials
    if not SHOPIFY_STORE_URL or not SHOPIFY_ACCESS_TOKEN:
        print("\n❌ ERROR: Missing Shopify credentials in .env file!")
        return

    # Get order number from user
    while True:
        try:
            order_input = input("\nEnter Shopify order number: ").strip().replace('#', '')
            if not order_input:
                print("Please enter an order number")
                continue
            break
        except KeyboardInterrupt:
            print("\n\nOperation cancelled by user.")
            sys.exit(0)

    print(f"\n📦 Fetching order #{order_input}...")

    order = get_order_by_name(order_input)

    if not order:
        print(f"   ❌ Order #{order_input} not found")
        return

    print(f"   ✅ Order #{order_input} retrieved")

    # Validate shipping address
    shipping_address = order.get('shippingAddress')
    is_valid, validation_msg = validate_address(shipping_address)

    if not is_valid:
        print(f"\n❌ Address validation failed: {validation_msg}")
        return

    print(f"   ✅ {validation_msg}")

    # Check if already processed
    was_processed, _ = check_if_processed(order_input, order['lineItems']['edges'])

    if was_processed:
        while True:
            try:
                response = input("\nDo you want to continue and process again? (y/n): ").strip().lower()
                if response in ['y', 'yes']:
                    print("⚠️  Continuing with re-processing...")
                    break
                elif response in ['n', 'no']:
                    print("Operation cancelled.")
                    return
                else:
                    print("Please enter 'y' or 'n'")
            except KeyboardInterrupt:
                print("\n\nOperation cancelled by user.")
                sys.exit(0)

    # Display shipping address
    print(f"\n📫 Shipping Address:")
    if shipping_address.get('company'):
        print(f"   {shipping_address['company']}")
    print(f"   {shipping_address.get('firstName', '')} {shipping_address.get('lastName', '')}")
    print(f"   {shipping_address.get('address1', '')}")
    if shipping_address.get('address2'):
        print(f"   {shipping_address['address2']}")
    print(f"   {shipping_address.get('city', '')}, {shipping_address.get('province', '')} {shipping_address.get('zip', '')}")
    print(f"   {shipping_address.get('country', '')}")
    if shipping_address.get('phone'):
        print(f"   Phone: {shipping_address['phone']}")

    # Ask for processing mode
    print("\n" + "="*60)
    print("PROCESSING MODE")
    print("="*60)
    print("1. Custom Quote (I have a quote link)")
    print("2. Manual Search (Search and add items)")

    while True:
        try:
            mode = input("\nSelect mode (1/2): ").strip()
            if mode in ['1', '2']:
                break
            else:
                print("Please enter 1 or 2")
        except KeyboardInterrupt:
            print("\n\nOperation cancelled by user.")
            sys.exit(0)

    if mode == '1':
        print("\n📝 CUSTOM QUOTE MODE")
        print("Please provide the quote link (e.g., https://www.sdwheelwholesale.com/cart/quote/xxxxx)")

        while True:
            try:
                quote_link = input("\nQuote Link: ").strip()
                if not quote_link:
                    print("Please enter a quote link")
                    continue

                if 'sdwheelwholesale.com/cart/quote/' not in quote_link:
                    print("Invalid quote link format")
                    continue

                break
            except KeyboardInterrupt:
                print("\n\nOperation cancelled by user.")
                sys.exit(0)

        # Select payment card
        card_info = select_card()
        if not card_info:
            return

        # Initialize browser
        print("\n🌐 Initializing browser...")
        driver = Driver(uc=True, headless=False)

        try:
            result = process_custom_quote(driver, order, quote_link, card_info)

            if result:
                print("\n✅ Order processed successfully!")
            else:
                print("\n⚠️  Order processing incomplete")
                print("\n   ⏸️  Browser will stay open for debugging...")
                input("\nPress Enter to close browser...")

        except Exception as e:
            print(f"\n❌ Error processing order: {e}")
            import traceback
            traceback.print_exc()
            print("\n   ⏸️  Browser will stay open for debugging...")
            input("\nPress Enter to close browser...")

        finally:
            print("\n🔒 Closing browser...")
            try:
                driver.quit()
            except:
                pass

    else:
        print("\n🔍 MANUAL SEARCH MODE")
        print("This mode will search for each item individually on SDW.")

        # Select payment card
        card_info = select_card()
        if not card_info:
            return

        # Initialize browser
        print("\n🌐 Initializing browser...")
        driver = Driver(uc=True, headless=False)

        try:
            result = process_manual_search(driver, order, card_info)

            if result:
                print("\n✅ Order processed successfully!")
            else:
                print("\n⚠️  Order processing incomplete")
                print("\n   ⏸️  Browser will stay open for debugging...")
                input("\nPress Enter to close browser...")

        except Exception as e:
            print(f"\n❌ Error processing order: {e}")
            import traceback
            traceback.print_exc()
            print("\n   ⏸️  Browser will stay open for debugging...")
            input("\nPress Enter to close browser...")

        finally:
            print("\n🔒 Closing browser...")
            try:
                driver.quit()
            except:
                pass

    print("\n" + "="*60)
    print("Session complete. Exiting...")
    print("="*60)


if __name__ == "__main__":
    main()
