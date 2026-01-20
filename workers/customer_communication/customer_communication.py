"""
TFS Wheels - Customer Communication System

Interactive script for generating customer communication messages with dynamic content.
Handles multi-level decision trees for common customer service scenarios.

Author: TFS Wheels
Date: 2026-01-19
"""

import os
import sys
import re
import json
from datetime import datetime
from pathlib import Path
import requests
from typing import Dict, Optional, Any
from dotenv import load_dotenv

# Add parent directory to path to import shared modules
parent_dir = Path(__file__).parent.parent
sys.path.append(str(parent_dir / "order_processing"))

# Load environment variables - look in multiple locations
script_dir = Path(__file__).parent.parent.parent  # Go up to TFS Manager root
env_paths = [
    script_dir / '.env',  # TFS Manager/.env
    Path.home() / '.tfs_manager.env',  # ~/.tfs_manager.env
    Path('/Users/jeremiah/Desktop/TFS Wheels/Scripts/.env'),  # Legacy location
]

for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break

# Shopify Configuration
SHOPIFY_STORE_URL = os.environ.get('SHOPIFY_STORE_URL')
SHOPIFY_ACCESS_TOKEN = os.environ.get('SHOPIFY_ACCESS_TOKEN')

# Extract store domain from URL
if SHOPIFY_STORE_URL:
    if '.myshopify.com' in SHOPIFY_STORE_URL:
        SHOPIFY_STORE = SHOPIFY_STORE_URL.split('.myshopify.com')[0].split('://')[-1] + '.myshopify.com'
    else:
        SHOPIFY_STORE = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '').rstrip('/')
else:
    SHOPIFY_STORE = "2f3d7a-2.myshopify.com"

SHOPIFY_API_VERSION = "2025-01"
SHOPIFY_GRAPHQL_URL = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"


class Colors:
    """ANSI color codes for terminal output"""
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


def print_header(text: str):
    """Print formatted header"""
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'=' * 80}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text.center(80)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'=' * 80}{Colors.ENDC}\n")


def print_success(text: str):
    """Print success message"""
    print(f"{Colors.OKGREEN}✓ {text}{Colors.ENDC}")


def print_error(text: str):
    """Print error message"""
    print(f"{Colors.FAIL}✗ {text}{Colors.ENDC}")


def print_info(text: str):
    """Print info message"""
    print(f"{Colors.OKCYAN}ℹ {text}{Colors.ENDC}")


def print_warning(text: str):
    """Print warning message"""
    print(f"{Colors.WARNING}⚠ {text}{Colors.ENDC}")


def shopify_graphql_query(query: str, variables: Optional[Dict] = None) -> Dict:
    """Execute a GraphQL query against Shopify API"""
    headers = {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
    }

    payload = {'query': query}
    if variables:
        payload['variables'] = variables

    try:
        response = requests.post(SHOPIFY_GRAPHQL_URL, json=payload, headers=headers, timeout=30)

        if response.status_code != 200:
            print_error(f"Error {response.status_code}: {response.text[:200]}")
            return {}

        data = response.json()

        if 'errors' in data:
            print_error(f"GraphQL Errors: {json.dumps(data['errors'], indent=2)}")
            return {}

        return data.get('data', {})

    except Exception as e:
        print_error(f"Exception: {str(e)}")
        return {}


def fetch_order_by_name(order_name: str) -> Optional[Dict]:
    """Fetch order details from Shopify by order name"""
    if not order_name.startswith("#"):
        order_name = f"#{order_name}"

    # Query structure based on SDW and Selective scripts - NO customer field
    query = f'''
    query {{
        orders(first: 1, query: "name:{order_name}") {{
            edges {{
                node {{
                    id
                    name
                    createdAt
                    email
                    phone
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
                                        title
                                        productType
                                        tags
                                        vendor
                                        metafield1: metafield(namespace: "custom", key: "hubbore") {{
                                            value
                                        }}
                                        metafield2: metafield(namespace: "convermax", key: "wheel_bolt_pattern") {{
                                            value
                                        }}
                                        metafield3: metafield(namespace: "convermax", key: "wheel_offset") {{
                                            value
                                        }}
                                        metafield4: metafield(namespace: "custom", key: "wheel_model") {{
                                            value
                                        }}
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

    print_info(f"Fetching order {order_name} from Shopify...")
    data = shopify_graphql_query(query)

    if not data or "orders" not in data:
        return None

    edges = data["orders"]["edges"]
    if not edges:
        print_error(f"Order {order_name} not found")
        return None

    order = edges[0]["node"]
    print_success(f"Order {order_name} found!")
    return order


def extract_vehicle_info(order: Dict) -> Optional[str]:
    """Extract vehicle information from order data"""
    # Check custom attributes
    custom_attrs = order.get("customAttributes", [])
    for attr in custom_attrs:
        if attr["key"].lower() in ["vehicle", "vehicle_info"]:
            return attr["value"]

    # Check order note
    note = order.get("note", "")
    if note:
        match = re.search(r"Vehicle:\s*(.+?)(?:\n|$)", note, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    # Check line items custom attributes
    line_items = order.get("lineItems", {}).get("edges", [])
    for item in line_items:
        item_attrs = item["node"].get("customAttributes", [])
        for attr in item_attrs:
            if attr["key"].lower() == "vehicle":
                return attr["value"]

    # Fallback: Check for verify message pattern "fit your [vehicle]" or "fits your [vehicle]"
    # This can be in line item custom attributes, product tags, or order notes
    for item in line_items:
        # Check line item custom attributes for verify message
        item_attrs = item["node"].get("customAttributes", [])
        for attr in item_attrs:
            attr_value = attr.get("value", "")
            # Look for pattern: "fit your" or "fits your" followed by vehicle info
            match = re.search(r"fits?\s+your\s+(.+?)(?:\.|$)", attr_value, re.IGNORECASE)
            if match:
                vehicle = match.group(1).strip()
                print_info(f"Found vehicle in verify message: {vehicle}")
                return vehicle

        # Check product tags for verify message
        product = item["node"].get("variant", {}).get("product", {})
        tags = product.get("tags", [])
        for tag in tags:
            match = re.search(r"fits?\s+your\s+(.+?)(?:\.|$)", tag, re.IGNORECASE)
            if match:
                vehicle = match.group(1).strip()
                print_info(f"Found vehicle in product tag: {vehicle}")
                return vehicle

    # Check order note for verify message pattern as final fallback
    if note:
        match = re.search(r"fits?\s+your\s+(.+?)(?:\.|$)", note, re.IGNORECASE)
        if match:
            vehicle = match.group(1).strip()
            print_info(f"Found vehicle in order note: {vehicle}")
            return vehicle

    return None


def parse_vehicle_string(vehicle_str: str) -> Dict[str, str]:
    """Parse vehicle string into components"""
    if not vehicle_str:
        return {
            "year": "",
            "make": "",
            "model": "",
            "trim": "",
            "full": ""
        }

    parts = vehicle_str.split()

    result = {
        "year": "",
        "make": "",
        "model": "",
        "trim": "",
        "full": vehicle_str
    }

    if len(parts) >= 1 and parts[0].isdigit():
        result["year"] = parts[0]
    if len(parts) >= 2:
        result["make"] = parts[1]
    if len(parts) >= 3:
        result["model"] = parts[2]
    if len(parts) >= 4:
        result["trim"] = " ".join(parts[3:])

    return result


def display_order_verification(order: Dict, vehicle_info: Dict) -> bool:
    """Display order verification message and get confirmation"""
    print_header("Order Verification")

    shipping = order.get("shippingAddress", {})

    # Customer info - get from shippingAddress and order directly
    first_name = shipping.get("firstName", "")
    last_name = shipping.get("lastName", "")
    email = order.get("email", "")

    # Shipping address
    address1 = shipping.get("address1", "")
    address2 = shipping.get("address2", "")
    city = shipping.get("city", "")
    state = shipping.get("province", "")
    zip_code = shipping.get("zip", "")
    country = shipping.get("country", "")

    # Line items
    line_items = order.get("lineItems", {}).get("edges", [])

    print(f"{Colors.BOLD}Order:{Colors.ENDC} {order['name']}")
    print(f"{Colors.BOLD}Customer:{Colors.ENDC} {first_name} {last_name}")
    print(f"{Colors.BOLD}Email:{Colors.ENDC} {email}")

    # Display vehicle info if available
    if vehicle_info and vehicle_info.get('full'):
        print(f"{Colors.BOLD}Vehicle:{Colors.ENDC} {vehicle_info['full']}")
    else:
        print(f"{Colors.BOLD}Vehicle:{Colors.ENDC} Not provided")
    print(f"\n{Colors.BOLD}Shipping Address:{Colors.ENDC}")
    print(f"  {address1}")
    if address2:
        print(f"  {address2}")
    print(f"  {city}, {state} {zip_code}")
    print(f"  {country}")

    # Check for verify message metafield or tag
    verify_message = None
    for item in line_items:
        node = item["node"]
        product = node.get("variant", {}).get("product", {})
        tags = product.get("tags", [])

        # Look for verification message in product data
        for tag in tags:
            if "does not fit" in tag.lower() or "verify" in tag.lower():
                verify_message = tag
                break

    # Also check variant custom attributes
    if not verify_message:
        for item in line_items:
            node = item["node"]
            custom_attrs = node.get("customAttributes", [])
            for attr in custom_attrs:
                if attr["key"].lower() in ["verify_message", "fitment_warning"]:
                    verify_message = attr["value"]
                    break

    if verify_message:
        print(f"\n{Colors.WARNING}{Colors.BOLD}⚠ Verify Message:{Colors.ENDC}")
        print(f"{Colors.WARNING}{verify_message}{Colors.ENDC}")

    print(f"\n{Colors.BOLD}Order Items:{Colors.ENDC}")
    for idx, item in enumerate(line_items, 1):
        node = item["node"]
        name = node.get("name", "")
        sku = node.get("sku", "")
        quantity = node.get("quantity", 0)
        print(f"  {idx}. {name}")
        print(f"     SKU: {sku} | Qty: {quantity}")

    print()
    return True


def display_menu(title: str, options: list, allow_cancel: bool = True) -> int:
    """Display a menu and get user selection"""
    print(f"\n{Colors.BOLD}{title}{Colors.ENDC}\n")

    for idx, option in enumerate(options, 1):
        print(f"  {idx}. {option}")

    if allow_cancel:
        print(f"  0. Cancel")

    while True:
        try:
            choice = input(f"\n{Colors.BOLD}Select option (0-{len(options)}): {Colors.ENDC}").strip()
            choice_num = int(choice)

            if choice_num == 0 and allow_cancel:
                return 0

            if 1 <= choice_num <= len(options):
                return choice_num

            print_error(f"Please enter a number between 0 and {len(options)}")

        except ValueError:
            print_error("Please enter a valid number")
        except KeyboardInterrupt:
            print("\n")
            return 0


def get_input(prompt: str, default: str = "") -> str:
    """Get user input with optional default value"""
    if default:
        user_input = input(f"{Colors.BOLD}{prompt} [{default}]: {Colors.ENDC}").strip()
        return user_input if user_input else default
    else:
        return input(f"{Colors.BOLD}{prompt}: {Colors.ENDC}").strip()


def handle_incorrect_fitment(order: Dict, vehicle_info: Dict):
    """Handle the Incorrect Fitment template flow"""
    print_header("Incorrect Fitment Template")

    # Step 1: Select reason for incorrect fitment
    fitment_reasons = [
        "Incorrect Bolt Pattern",
        "Offset",
        "Other"
    ]

    reason_choice = display_menu("Why is the fitment incorrect?", fitment_reasons)

    if reason_choice == 0:
        print_info("Template cancelled")
        return

    reason = fitment_reasons[reason_choice - 1]

    # Step 2: Select solution
    solutions = [
        "Cancel order",
        "Update order"
    ]

    solution_choice = display_menu("Select solution:", solutions)

    if solution_choice == 0:
        print_info("Template cancelled")
        return

    solution = solutions[solution_choice - 1]

    # Get customer info from shippingAddress
    shipping = order.get("shippingAddress", {})
    first_name = shipping.get("firstName", "")

    # Get line items and find the wheel (not accessories or shipping protection)
    line_items = order.get("lineItems", {}).get("edges", [])
    if not line_items:
        print_error("No line items found in order")
        return

    # Find the wheel item (skip accessories, shipping protection, etc.)
    wheel_item = None
    for item_edge in line_items:
        item = item_edge["node"]
        item_name = item.get("name", "").lower()

        # Skip common non-wheel items
        if any(skip in item_name for skip in ["shipping protection", "installation kit", "hub centric"]):
            continue

        # Check if it's a wheel based on product type or tags
        product = item.get("variant", {}).get("product", {})
        if product:
            product_type = product.get("productType", "").lower()
            tags = [tag.lower() for tag in product.get("tags", [])]

            # Skip accessories
            if "accessories" in tags:
                continue

            # Found a wheel
            if "wheel" in product_type or "wheels" in tags or "wheel" in item_name:
                wheel_item = item
                print_success(f"Found wheel item: {item.get('name', 'Unknown')}")
                break

    if not wheel_item:
        print_error("No wheel item found in order")
        print_warning("Using first item as fallback")
        wheel_item = line_items[0]["node"]

    product = wheel_item.get("variant", {}).get("product", {})

    # Generate message based on reason
    if reason == "Incorrect Bolt Pattern":
        # Get customer vehicle bolt pattern (what their vehicle needs)
        print_info("We need the CUSTOMER'S vehicle bolt pattern (what their vehicle requires)")
        customer_bolt_pattern = get_input(f"Enter {vehicle_info['full']} bolt pattern (e.g., 5x112)")

        # Get wheel bolt pattern from metafield (metafield2 is the alias for convermax.wheel_bolt_pattern)
        wheel_bolt_pattern = None
        metafield2 = product.get("metafield2")
        if metafield2 and isinstance(metafield2, dict):
            wheel_bolt_pattern = metafield2.get("value", "")
            if wheel_bolt_pattern:
                # Clean up the value - it might be in format '["5x4.5"]'
                wheel_bolt_pattern = wheel_bolt_pattern.strip('[]"\'').replace('"', '').replace("'", "")
                print_success(f"✓ Automatically extracted WHEEL bolt pattern from metafield: {wheel_bolt_pattern}")

        if not wheel_bolt_pattern:
            print_warning("Wheel bolt pattern not found in metafield")
            wheel_bolt_pattern = get_input("Enter WHEEL bolt pattern manually (e.g., 5x114.3)")

        # Generate message for bolt pattern mismatch
        message = f"Hey {first_name},\n\n"
        message += f"Unfortunately, the wheel you have selected does not fit your {vehicle_info['full']} due to an incorrect bolt pattern.\n\n"
        message += f"Your {vehicle_info['year']} {vehicle_info['make']} {vehicle_info['model']} has a bolt pattern of {customer_bolt_pattern}, "
        message += f"while the wheel you have selected has a bolt pattern of {wheel_bolt_pattern}.\n\n"
        message += "The bolt pattern is the arrangement of the lug holes on the wheel hub. The first number indicates how many lug holes there are, "
        message += "and the second number indicates the diameter of the circle formed by the centers of the lug holes (measured in millimeters). "
        message += "When these measurements don't match, the wheel cannot be mounted to your vehicle's hub, making it impossible to install safely.\n\n"

        if solution == "Cancel order":
            message += f"Unfortunately, we do not have this wheel in the correct bolt pattern ({customer_bolt_pattern}) for your vehicle, "
            message += "so we have canceled your order. Please allow up to 3 business days for your payment method to be refunded.\n\n"
            message += "If you'd like to find wheels that fit your vehicle, please visit our website or contact us and we'll be happy to help you find the perfect match!\n\n"

        else:  # Update order
            new_wheel_link = get_input("Enter link to the correct wheel")
            price_difference = get_input("Enter price difference (e.g., +15.00 or -15.00)")

            message += f"Good news! We have updated your order to the correct wheel with the proper bolt pattern for your vehicle:\n"
            message += f"{new_wheel_link}\n\n"

            if price_difference.startswith("+") or (price_difference.startswith("-") == False and float(price_difference) > 0):
                # Price increased
                diff_amount = price_difference.replace("+", "").strip()
                message += f"Note: There is a price difference of +${diff_amount}. We will send you an invoice for the difference, "
                message += "which must be paid before we can process and ship your order.\n\n"
            elif price_difference.startswith("-") or float(price_difference) < 0:
                # Price decreased
                diff_amount = price_difference.replace("-", "").strip()
                message += f"Note: There is a price difference of -${diff_amount}. We will refund this difference to your original payment method within 3-5 business days.\n\n"
            else:
                message += "The pricing remains the same.\n\n"

    elif reason == "Offset":
        # Get offset information
        customer_required_offset = get_input("Enter recommended offset for customer's vehicle (e.g., +35 to +45)")

        # Get wheel offset from metafield (metafield3 is the alias for convermax.wheel_offset)
        wheel_offset = None
        metafield3 = product.get("metafield3")
        if metafield3 and isinstance(metafield3, dict):
            wheel_offset = metafield3.get("value", "")
            if wheel_offset:
                print_success(f"✓ Automatically extracted WHEEL offset from metafield: {wheel_offset}")

        if not wheel_offset:
            print_warning("Wheel offset not found in metafield")
            wheel_offset = get_input("Enter WHEEL offset manually (e.g., +20)")

        message = f"Hey {first_name},\n\n"
        message += f"Unfortunately, the wheel you have selected may not be the best fit for your {vehicle_info['full']} due to an offset concern.\n\n"
        message += f"The wheel you selected has an offset of {wheel_offset}mm, "
        message += f"while your {vehicle_info['year']} {vehicle_info['make']} {vehicle_info['model']} typically requires an offset in the range of {customer_required_offset}mm for optimal fitment.\n\n"
        message += "The offset determines how far the wheel sits inward or outward from the hub. An incorrect offset can cause issues such as "
        message += "rubbing on suspension components, fenders, or tires, and can also affect handling and put extra stress on wheel bearings.\n\n"

        if solution == "Cancel order":
            message += f"Unfortunately, we do not have this wheel in the correct offset for your vehicle, "
            message += "so we have canceled your order. Please allow up to 3 business days for your payment method to be refunded.\n\n"
            message += "If you'd like help finding wheels with the proper offset for your vehicle, please contact us!\n\n"

        else:  # Update order
            new_wheel_link = get_input("Enter link to the correct wheel")
            price_difference = get_input("Enter price difference (e.g., +15.00 or -15.00)")

            message += f"Good news! We have updated your order to a wheel with a more suitable offset for your vehicle:\n"
            message += f"{new_wheel_link}\n\n"

            if price_difference.startswith("+") or (price_difference.startswith("-") == False and float(price_difference) > 0):
                diff_amount = price_difference.replace("+", "").strip()
                message += f"Note: There is a price difference of +${diff_amount}. We will send you an invoice for the difference, "
                message += "which must be paid before we can process and ship your order.\n\n"
            elif price_difference.startswith("-") or float(price_difference) < 0:
                diff_amount = price_difference.replace("-", "").strip()
                message += f"Note: There is a price difference of -${diff_amount}. We will refund this difference to your original payment method within 3-5 business days.\n\n"

    else:  # Other reason
        custom_reason = get_input("Enter the specific fitment issue")

        message = f"Hey {first_name},\n\n"
        message += f"Unfortunately, the wheel you have selected does not fit your {vehicle_info['full']}.\n\n"
        message += f"{custom_reason}\n\n"

        if solution == "Cancel order":
            message += "We have canceled your order. Please allow up to 3 business days for your payment method to be refunded.\n\n"
            message += "If you'd like help finding wheels that fit your vehicle, please contact us!\n\n"

        else:  # Update order
            new_wheel_link = get_input("Enter link to the correct wheel")
            price_difference = get_input("Enter price difference (e.g., +15.00 or -15.00, or 0)")

            message += f"We have updated your order to:\n{new_wheel_link}\n\n"

            if price_difference.startswith("+") or (price_difference.startswith("-") == False and float(price_difference.replace("+", "").replace("-", "").strip()) > 0):
                diff_amount = price_difference.replace("+", "").strip()
                message += f"Note: There is a price difference of +${diff_amount}. We will send you an invoice for the difference.\n\n"
            elif price_difference.startswith("-"):
                diff_amount = price_difference.replace("-", "").strip()
                message += f"Note: There is a price difference of -${diff_amount}. We will refund this difference within 3-5 business days.\n\n"

    # Add signature
    message += "Best regards,\nTFS Wheels"

    # Display final message
    print_header("Generated Message")
    print(message)
    print("\n" + "=" * 80 + "\n")

    # Ask what to do with message
    actions = [
        "Copy to clipboard",
        "Save to file",
        "Both",
        "Discard"
    ]

    action_choice = display_menu("What would you like to do?", actions, allow_cancel=False)

    if action_choice in [1, 3]:  # Copy to clipboard
        if copy_to_clipboard(message):
            print_success("Message copied to clipboard!")
        else:
            print_error("Failed to copy to clipboard")

    if action_choice in [2, 3]:  # Save to file
        filepath = save_message_to_file(order['name'], "Incorrect Fitment", message)
        print_success(f"Message saved to: {filepath}")

    if action_choice == 4:
        print_info("Message discarded")


def handle_order_processed(order: Dict, vehicle_info: Dict):
    """Handle the Order Processed - Ready for Fulfillment template flow"""
    print_header("Order Processed - Ready for Fulfillment")

    # Get customer info
    shipping = order.get("shippingAddress", {})
    first_name = shipping.get("firstName", "")
    email = order.get("email", "")

    # Get order details
    order_number = order.get("name", "")

    # Get line items - find wheels only
    line_items = order.get("lineItems", {}).get("edges", [])

    # Build wheel description from vendor and model metafield
    wheel_descriptions = []
    for item_edge in line_items:
        item = item_edge["node"]
        item_name = item.get("name", "")

        # Skip non-wheel items
        if any(skip in item_name.lower() for skip in ["shipping protection", "installation kit", "hub centric"]):
            continue

        product = item.get("variant", {}).get("product", {})
        if product:
            tags = [tag.lower() for tag in product.get("tags", [])]
            product_type = product.get("productType", "").lower()

            # Skip accessories
            if "accessories" in tags:
                continue

            # Only process wheels
            if "wheel" not in product_type and "wheels" not in tags and "wheel" not in item_name.lower():
                continue

            # Get vendor (brand name)
            vendor = product.get("vendor", "")

            # Get wheel model from metafield4 (custom.wheel_model)
            wheel_model = None
            metafield4 = product.get("metafield4")
            if metafield4 and isinstance(metafield4, dict):
                wheel_model = metafield4.get("value", "")

            # Build description
            if vendor and wheel_model:
                wheel_descriptions.append(f"{vendor} {wheel_model}")
            elif vendor:
                wheel_descriptions.append(f"{vendor} wheels")
            else:
                wheel_descriptions.append("wheels")

            break  # Only use first wheel item

    # Build wheel description string
    if wheel_descriptions:
        wheel_desc = wheel_descriptions[0]
    else:
        wheel_desc = "your wheels"

    # If wheel info is missing, prompt for it
    if wheel_desc == "your wheels":
        print_warning("Wheel brand/model information not found in order")
        wheel_brand = get_input("Enter wheel brand (or press Enter to skip)", default="")
        wheel_model = get_input("Enter wheel model (or press Enter to skip)", default="")

        if wheel_brand and wheel_model:
            wheel_desc = f"{wheel_brand} {wheel_model}"
        elif wheel_brand:
            wheel_desc = f"{wheel_brand} wheels"
        else:
            wheel_desc = "your wheels"

    # Vehicle mention - use only year, make, model (no trim)
    vehicle_mention = ""
    vehicle_shorthand = "ride"
    if vehicle_info and vehicle_info.get("full"):
        year = vehicle_info.get("year", "")
        make = vehicle_info.get("make", "")
        model = vehicle_info.get("model", "")

        if year and make and model:
            vehicle_shorthand = f"{year} {make} {model}"
            vehicle_mention = f" for your {vehicle_shorthand}"
        elif vehicle_info.get("full"):
            # Fallback to parsing from full string
            parts = vehicle_info['full'].split()
            if len(parts) >= 3:
                vehicle_shorthand = " ".join(parts[:3])
                vehicle_mention = f" for your {vehicle_shorthand}"

    # If vehicle info is missing, prompt for it
    if not vehicle_mention:
        print_warning("Vehicle information not found in order")
        vehicle_input = get_input("Enter vehicle (Year Make Model, or press Enter to skip)", default="")

        if vehicle_input:
            parts = vehicle_input.split()
            if len(parts) >= 3:
                vehicle_shorthand = " ".join(parts[:3])
            else:
                vehicle_shorthand = vehicle_input
            vehicle_mention = f" for your {vehicle_shorthand}"

    # Product mention for closing
    product_mention = ""
    if wheel_desc and wheel_desc != "your wheels":
        product_mention = f" with your {wheel_desc}"

    # Present 2 draft options
    print(f"\n{Colors.BOLD}Select a message draft:{Colors.ENDC}\n")

    drafts = {
        1: {
            "name": "Friendly & Personal",
            "subject": f"Great News! Your Order {order_number} is Processing",
            "body": f"""Hey {first_name},

Just wanted to reach out and let you know that we've processed your order {order_number}{vehicle_mention}!

Your {wheel_desc} passed our initial verification and accuracy checks, and we're getting everything ready to ship out. If anything comes up on the manufacturer's or warehouse end, we'll reach out to you right away. Otherwise, sit tight – you'll be getting a separate email with tracking numbers as soon as your order ships.

Got questions in the meantime? Don't hesitate to reach out. We're here to help!

**Quick Favor:**
We're a small business trying to make a name for ourselves in the wheels and tires world, and your feedback really helps us stay afloat. About 7-10 days after your delivery, you'll be getting review requests from Google and Judge.me – when they arrive, if you could take a minute to share your experience, we'd be incredibly grateful. Please don't forget about us!

Not comfortable with a public review? No worries! We're always open to private feedback too. It helps us learn and serve you (and future customers) better.

Thanks for choosing TFS Wheels, {first_name}. We really appreciate your business!

Best,
TFS Wheels Team"""
        },
        2: {
            "name": "Appreciative & Heartfelt",
            "subject": f"Thank You, {first_name}! Order {order_number} Update",
            "body": f"""Hi {first_name},

First off – thank you for choosing TFS Wheels! We know you have plenty of options out there, and it means a lot that you trusted us with your order.

I wanted to personally let you know that your order {order_number}{vehicle_mention} has cleared our initial verification checks and is now being processed for fulfillment. Everything looks great on our end!

Here's what to expect:
• We'll keep a close eye on things as your order moves through the warehouse
• If anything unexpected pops up, you'll hear from us immediately
• Otherwise, expect a tracking number in a separate email once it ships
• Questions? We're just an email away

**Here's where I could really use your help:**
Running a small business like TFS Wheels is tough, but customers like you make it worth it. About 7-10 days after your delivery, you'll receive review requests from Google and Judge.me. We'd be honored if you could share your experience when they arrive – please don't forget about us! Your words help other car enthusiasts find us and keep our doors open.

And hey – if you'd rather keep feedback private, that works too! We're always learning and want to know how we can do better.

Thanks again for your order, {first_name}. We're excited to get your {wheel_desc} to you!

Cheers,
The TFS Wheels Team"""
        }
    }

    # Display draft options
    for num, draft in drafts.items():
        print(f"  {num}. {Colors.BOLD}{draft['name']}{Colors.ENDC}")

    print(f"  0. {Colors.WARNING}Cancel{Colors.ENDC}")

    # Get user choice
    while True:
        try:
            choice = input(f"\n{Colors.BOLD}Select draft (0-2): {Colors.ENDC}").strip()
            choice_num = int(choice)

            if choice_num == 0:
                print_info("Template cancelled")
                return

            if 1 <= choice_num <= 2:
                selected_draft = drafts[choice_num]
                break

            print_error("Please enter a number between 0 and 2")

        except ValueError:
            print_error("Please enter a valid number")
        except KeyboardInterrupt:
            print("\n")
            print_info("Template cancelled")
            return

    # Display selected draft
    print_header(f"Selected Draft: {selected_draft['name']}")
    print(f"{Colors.BOLD}Subject:{Colors.ENDC} {selected_draft['subject']}\n")
    print(f"{Colors.BOLD}Body:{Colors.ENDC}")
    print("-" * 80)
    print(selected_draft['body'])
    print("-" * 80)

    # Ask what to do with message
    actions = [
        "Copy to clipboard",
        "Save to file",
        "Both",
        "Discard"
    ]

    action_choice = display_menu("What would you like to do?", actions, allow_cancel=False)

    full_message = f"Subject: {selected_draft['subject']}\n\n{selected_draft['body']}"

    if action_choice in [1, 3]:  # Copy to clipboard
        if copy_to_clipboard(full_message):
            print_success("Message copied to clipboard!")
        else:
            print_error("Failed to copy to clipboard")

    if action_choice in [2, 3]:  # Save to file
        filepath = save_message_to_file(order['name'], "Order_Processed", full_message)
        print_success(f"Message saved to: {filepath}")

    if action_choice == 4:
        print_info("Message discarded")


def handle_vehicle_info_request(order: Dict, vehicle_info: Dict):
    """Handle the Vehicle Information Request template"""
    print_header("Vehicle Information Request")

    # Get customer info
    shipping = order.get("shippingAddress", {})
    first_name = shipping.get("firstName", "")
    email = order.get("email", "")

    # Get order details
    order_number = order.get("name", "")

    # Get line items - find wheels only
    line_items = order.get("lineItems", {}).get("edges", [])

    # Build wheel description and count wheels
    wheel_descriptions = []
    wheel_count = 0

    for item_edge in line_items:
        item = item_edge["node"]
        item_name = item.get("name", "")
        quantity = item.get("quantity", 0)

        # Skip non-wheel items
        if any(skip in item_name.lower() for skip in ["shipping protection", "installation kit", "hub centric"]):
            continue

        product = item.get("variant", {}).get("product", {})
        if product:
            tags = [tag.lower() for tag in product.get("tags", [])]
            product_type = product.get("productType", "").lower()

            # Skip accessories
            if "accessories" in tags:
                continue

            # Only process wheels
            if "wheel" not in product_type and "wheels" not in tags and "wheel" not in item_name.lower():
                continue

            # Count wheels
            wheel_count += quantity

            # Get vendor (brand name)
            vendor = product.get("vendor", "")

            # Get wheel model from metafield4 (custom.wheel_model)
            wheel_model = None
            metafield4 = product.get("metafield4")
            if metafield4 and isinstance(metafield4, dict):
                wheel_model = metafield4.get("value", "")

            # Build description
            if vendor and wheel_model:
                wheel_descriptions.append(f"{vendor} {wheel_model}")
            elif vendor:
                wheel_descriptions.append(f"{vendor} wheels")
            else:
                wheel_descriptions.append("wheels")

            break  # Only use first wheel item for description

    # Build wheel description string
    if wheel_descriptions:
        wheel_desc = wheel_descriptions[0]
    else:
        wheel_desc = "your wheels"

    # If wheel info is missing, prompt for it
    if wheel_desc == "your wheels":
        print_warning("Wheel brand/model information not found in order")
        wheel_brand = get_input("Enter wheel brand (or press Enter to skip)", default="")
        wheel_model = get_input("Enter wheel model (or press Enter to skip)", default="")

        if wheel_brand and wheel_model:
            wheel_desc = f"{wheel_brand} {wheel_model}"
        elif wheel_brand:
            wheel_desc = f"{wheel_brand} wheels"
        else:
            wheel_desc = "your wheels"

    # Determine if single wheel or multiple wheels
    is_single_wheel = (wheel_count == 1)

    print_info(f"Wheel count: {wheel_count} wheel(s)")
    if is_single_wheel:
        print_info("Single wheel detected - will use FINAL SALE message")
    else:
        print_info("Multiple wheels detected - will use return responsibility message")

    # Build the conditional message section
    if is_single_wheel:
        terms_section = """Your order is for a single wheel. Without vehicle verification, this will be processed as a **FINAL SALE** – meaning no returns or exchanges if the fitment isn't correct."""
    else:
        terms_section = """If the wheels turn out to be the wrong fitment for your vehicle, you'll be responsible for:
- Return shipping (to and from our warehouse)
- Restocking fees (20-30% of the order total, depending on the manufacturer)
- Any additional costs related to the incorrect fitment"""

    # Generate the message
    subject = f"Order {order_number} – Vehicle Info Needed for Fitment Verification"

    body = f"""Hi {first_name},

Thanks for your order with TFS Wheels! We're preparing to process order {order_number} for your {wheel_desc}.

**Quick heads up:** We need your vehicle information to verify fitment.

We noticed your order didn't include vehicle details, which we need to confirm that the wheels you've selected will fit correctly. Wrong fitment can mean wheels that don't mount, rub on suspension components, or cause other issues – and we definitely want to help you avoid that!

**What we need:**
Please reply to this email with:
- Year, Make, Model, and Trim of your vehicle
- Example: "2020 Honda CR-V EX AWD"

**Timeline:**
We need to hear back within **5 business days**. If we don't receive your vehicle info by then, we'll process your order without verification.

**Here's what that means:**

{terms_section}

**Bottom line:** We're here to make sure you get the right wheels the first time. A quick reply with your vehicle info is all we need to verify everything and give you peace of mind!

Questions? Just hit reply – we're happy to help.

Thanks,
TFS Wheels Team"""

    # Display the message
    print_header("Generated Message")
    print(f"{Colors.BOLD}Subject:{Colors.ENDC} {subject}\n")
    print(f"{Colors.BOLD}Body:{Colors.ENDC}")
    print("-" * 80)
    print(body)
    print("-" * 80)

    # Ask what to do with message
    actions = [
        "Copy to clipboard",
        "Save to file",
        "Both",
        "Discard"
    ]

    action_choice = display_menu("What would you like to do?", actions, allow_cancel=False)

    full_message = f"Subject: {subject}\n\n{body}"

    if action_choice in [1, 3]:  # Copy to clipboard
        if copy_to_clipboard(full_message):
            print_success("Message copied to clipboard!")
        else:
            print_error("Failed to copy to clipboard")

    if action_choice in [2, 3]:  # Save to file
        filepath = save_message_to_file(order['name'], "Vehicle_Info_Request", full_message)
        print_success(f"Message saved to: {filepath}")

    if action_choice == 4:
        print_info("Message discarded")


def copy_to_clipboard(text: str) -> bool:
    """Copy text to clipboard (macOS)"""
    try:
        import subprocess
        process = subprocess.Popen(
            ['pbcopy'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        process.communicate(text.encode('utf-8'))
        return process.returncode == 0
    except Exception as e:
        print_error(f"Failed to copy to clipboard: {e}")
        return False


def save_message_to_file(order_number: str, template_type: str, message: str) -> str:
    """Save message to a file"""
    output_dir = Path(__file__).parent / "generated_messages"
    output_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_order = order_number.replace("#", "").replace("/", "_")
    safe_template = template_type.replace(" ", "_").lower()
    filename = f"{safe_order}_{safe_template}_{timestamp}.txt"
    filepath = output_dir / filename

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(message)

    return str(filepath)


def main():
    """Main application loop"""
    print_header("TFS Wheels - Customer Communication System")

    if not SHOPIFY_ACCESS_TOKEN:
        print_error("SHOPIFY_ACCESS_TOKEN not found in environment variables!")
        print_info("Please add it to your .env file")
        return

    while True:
        # Step 1: Get order number
        print(f"\n{Colors.BOLD}Enter order number (or 'q' to quit):{Colors.ENDC} ", end="")
        order_input = input().strip()

        if order_input.lower() in ['q', 'quit', 'exit']:
            print_success("Goodbye!")
            break

        if not order_input:
            continue

        # Step 2: Fetch order
        order = fetch_order_by_name(order_input)
        if not order:
            continue

        # Step 3: Extract vehicle info
        vehicle_str = extract_vehicle_info(order)
        if not vehicle_str:
            print_warning("No vehicle information found in order")
            vehicle_str = get_input("Enter vehicle info manually (or press Enter to skip)", default="")

        vehicle_info = parse_vehicle_string(vehicle_str) if vehicle_str else {}

        # Step 4: Display order verification
        display_order_verification(order, vehicle_info)

        # Step 5: Select template
        templates = [
            "Incorrect Fitment",
            "Order Processed - Ready for Fulfillment",
            "Vehicle Information Request",
            # Add more templates here in the future
        ]

        template_choice = display_menu("Which template would you like to use?", templates)

        if template_choice == 0:
            print_info("Template selection cancelled")
            continue

        # Step 6: Handle selected template
        if template_choice == 1:  # Incorrect Fitment
            handle_incorrect_fitment(order, vehicle_info)
        elif template_choice == 2:  # Order Processed
            handle_order_processed(order, vehicle_info)
        elif template_choice == 3:  # Vehicle Information Request
            handle_vehicle_info_request(order, vehicle_info)

        print("\n" + "=" * 80)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Colors.WARNING}Operation cancelled by user{Colors.ENDC}")
        sys.exit(0)
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
