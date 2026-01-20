import os
import requests
from datetime import datetime
from dotenv import load_dotenv
import json
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from io import BytesIO
import re

# Load environment variables - look in multiple locations
from pathlib import Path
script_dir = Path(__file__).parent.parent.parent.parent  # Go up to TFS Manager root
env_paths = [
    script_dir / '.env',  # TFS Manager/.env
    Path.home() / '.tfs_manager.env',  # ~/.tfs_manager.env
    Path('/Users/jeremiah/Desktop/TFS Wheels/Scripts/.env'),  # Legacy location
]

for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break

SHOPIFY_STORE_URL = os.environ.get('SHOPIFY_STORE_URL')
SHOPIFY_ACCESS_TOKEN = os.environ.get('SHOPIFY_ACCESS_TOKEN')

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
                                        metafield(namespace: "custom", key: "hubbore") {{
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

    data = execute_graphql_query(query)

    if not data or 'orders' not in data or not data['orders']['edges']:
        return None

    return data['orders']['edges'][0]['node']

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

def get_hubbore_for_product(product_id):
    """Get hubbore metafield for a product"""
    # Extract the numeric ID from the GraphQL ID
    numeric_id = product_id.split('/')[-1]

    query = f'''
    query {{
        product(id: "gid://shopify/Product/{numeric_id}") {{
            metafield(namespace: "custom", key: "hubbore") {{
                value
            }}
        }}
    }}
    '''

    data = execute_graphql_query(query)

    if data and 'product' in data and data['product']:
        metafield = data['product'].get('metafield')
        if metafield:
            return metafield.get('value')

    return None

def is_accessory(item):
    """Check if item is an accessory based on tags"""
    if item.get('variant') and item['variant'].get('product'):
        tags = item['variant']['product'].get('tags', [])
        return 'accessories' in [tag.lower() for tag in tags]
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

    # First check if it's an accessory - accessories are NOT wheels even if they contain "wheel" in name
    if is_accessory(item):
        return False

    # Exclude installation kits and other common false positives
    if 'installation kit' in name or 'wheel lock' in name or 'wheel cleaner' in name:
        return False

    # Check if it's a wheel based on:
    # 1. Tagged as 'wheels'
    # 2. Product type contains 'wheel'
    # 3. Name contains 'wheel'
    return 'wheels' in tags or 'wheel' in product_type or 'wheel' in name

def format_shipping_address(address):
    """Format shipping address as a readable string"""
    if not address:
        return "No shipping address available"

    lines = []

    # Name
    name_parts = []
    if address.get('firstName'):
        name_parts.append(address['firstName'])
    if address.get('lastName'):
        name_parts.append(address['lastName'])
    if name_parts:
        lines.append(' '.join(name_parts))

    # Company
    if address.get('company'):
        lines.append(address['company'])

    # Address line 1
    if address.get('address1'):
        lines.append(address['address1'])

    # Address line 2
    if address.get('address2'):
        lines.append(address['address2'])

    # City, Province, Zip
    city_line_parts = []
    if address.get('city'):
        city_line_parts.append(address['city'])
    if address.get('province'):
        city_line_parts.append(address['province'])
    if address.get('zip'):
        city_line_parts.append(address['zip'])
    if city_line_parts:
        lines.append(', '.join(city_line_parts))

    # Country
    if address.get('country'):
        lines.append(address['country'])

    # Phone
    if address.get('phone'):
        lines.append(f"Phone: {address['phone']}")

    return '\n'.join(lines)

def download_logo():
    """Download and cache the TFS Wheels logo"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    logo_path = os.path.join(script_dir, 'tfs_logo.png')

    # If logo already exists, use cached version
    if os.path.exists(logo_path):
        return logo_path

    # Download logo
    logo_url = "https://tfswheels.com/cdn/shop/files/Logo_Green_Black_text_2x_b0ccdf71-c3f9-493a-86b7-49ec3ea59851.webp?v=1750906739&width=360"

    try:
        response = requests.get(logo_url, timeout=10)
        if response.status_code == 200:
            # Save as PNG for ReportLab compatibility
            from PIL import Image as PILImage
            img = PILImage.open(BytesIO(response.content))
            # Convert WEBP to PNG
            img.save(logo_path, 'PNG')
            return logo_path
    except Exception as e:
        print(f"Warning: Could not download logo: {e}")
        return None

def create_pdf_for_order(order_data, output_path, is_accessories=False):
    """Create a PDF for a single order with selected items"""
    # Create the PDF
    doc = SimpleDocTemplate(output_path, pagesize=letter,
                           topMargin=0.75*inch, bottomMargin=0.75*inch,
                           leftMargin=0.75*inch, rightMargin=0.75*inch)

    # Container for PDF elements
    elements = []

    # Define styles
    styles = getSampleStyleSheet()

    # Add company logo and branding header
    logo_path = download_logo()
    if logo_path:
        # Add logo - centered with appropriate width
        logo = Image(logo_path, width=2.5*inch, height=0.6*inch)
        logo.hAlign = 'CENTER'
        elements.append(logo)
        elements.append(Spacer(1, 0.1*inch))

    # Add contact info (bold)
    company_style = ParagraphStyle(
        'CompanyInfo',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#666666'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )

    company_contact = Paragraph(
        "www.tfswheels.com | support@tfswheels.com | 877-290-2955",
        company_style
    )
    elements.append(company_contact)
    elements.append(Spacer(1, 0.15*inch))

    # Add date only
    date_str = datetime.now().strftime('%B %d, %Y')
    date_style = ParagraphStyle(
        'DateStyle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#666666'),
        spaceAfter=12,
        alignment=TA_CENTER,
        fontName='Helvetica'
    )
    date_para = Paragraph(date_str, date_style)
    elements.append(date_para)

    elements.append(Spacer(1, 0.15*inch))

    # Create PO box
    po_elements = []

    # PO header with background
    po_header_text = f"PO #{order_data['order_name']}"

    po_header_data = [[po_header_text]]
    po_header_table = Table(po_header_data, colWidths=[6.6*inch])
    po_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#003366')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    po_elements.append(po_header_table)

    # Line items section
    # Create style for product names to handle wrapping
    product_style = ParagraphStyle(
        'ProductStyle',
        parent=styles['Normal'],
        fontSize=9,
        fontName='Helvetica',
        leading=11
    )

    if is_accessories:
        # For accessories, display as bulleted list
        items_data = []

        for item in order_data['selected_items']:
            # Add bullet point before each item
            bulleted_item = f"• {item}"
            items_data.append([Paragraph(bulleted_item, product_style)])

        items_table = Table(items_data, colWidths=[6.6*inch])
        items_table.setStyle(TableStyle([
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 1),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        po_elements.append(items_table)

        # Add vehicle information if available
        if order_data.get('vehicle_info'):
            vehicle_data = [[f"Vehicle: {order_data['vehicle_info']}"]]
            vehicle_table = Table(vehicle_data, colWidths=[6.6*inch])
            vehicle_table.setStyle(TableStyle([
                ('LEFTPADDING', (0, 0), (-1, -1), 10),
                ('TOPPADDING', (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
            ]))
            po_elements.append(vehicle_table)
    else:
        # Regular items with table
        table_data = []
        table_data.append(['Product', 'SKU', 'Qty'])

        for item in order_data['selected_items']:
            # Wrap product name in Paragraph for proper text wrapping
            product_para = Paragraph(item['name'], product_style)
            sku = item.get('sku', 'N/A')
            quantity = str(item['quantity'])
            table_data.append([product_para, sku, quantity])

        # Adjusted column widths: Product wider, SKU with word wrap, Qty compact
        item_table = Table(table_data, colWidths=[3.8*inch, 2.2*inch, 0.6*inch])
        item_table.setStyle(TableStyle([
            # Header row
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E8F0F7')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#003366')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
            ('TOPPADDING', (0, 0), (-1, 0), 5),
            ('ALIGN', (0, 0), (-1, 0), 'LEFT'),

            # Data rows
            ('FONTNAME', (1, 1), (2, -1), 'Helvetica'),  # SKU and Qty columns
            ('FONTSIZE', (1, 1), (2, -1), 8),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
            ('TOPPADDING', (0, 1), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),

            # Quantity column bold and centered
            ('FONTNAME', (2, 1), (2, -1), 'Helvetica-Bold'),
            ('ALIGN', (2, 0), (2, -1), 'CENTER'),

            # Grid
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))

        po_elements.append(item_table)

    # Add spacing before shipping address
    spacer_data = [[" "]]
    spacer_table = Table(spacer_data, colWidths=[6.6*inch])
    spacer_table.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#CCCCCC')),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    po_elements.append(spacer_table)

    # Shipping address in the same box - completely compact with no spacing
    address_lines = order_data['shipping_address'].split('\n')
    address_data = [["Shipping Address:"]]
    for line in address_lines:
        if line.strip():
            address_data.append([line])

    address_table = Table(address_data, colWidths=[6.6*inch])
    address_table.setStyle(TableStyle([
        # Header
        ('FONTNAME', (0, 0), (0, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (0, 0), 9),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F5F5F5')),
        ('TOPPADDING', (0, 0), (-1, 0), 4),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),

        # Address lines - zero padding for no spacing between lines
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 0),
    ]))
    po_elements.append(address_table)

    # Combine all PO elements into one bordered container
    container_table = Table([[e] for e in po_elements], colWidths=[6.6*inch], spaceBefore=0, spaceAfter=0)
    container_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.HexColor('#003366')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))

    # Wrap in KeepTogether to prevent splitting across pages
    po_block = KeepTogether([container_table])
    elements.append(po_block)

    # Build PDF
    doc.build(elements)
    print(f"  PDF created: {output_path}")

def process_accessories(accessories, wheels, vehicle_info):
    """Process accessories into formatted list"""
    formatted_accessories = []
    hub_rings_info = []
    has_hub_rings = False

    # Check if any accessories are installation kits or hub centric rings
    for acc in accessories:
        name = acc['name'].lower()
        if 'installation kit' in name or 'hub centric' in name or 'hub rings' in name:
            has_hub_rings = True
            break

    # Get hubbore values from wheels
    for wheel in wheels:
        if wheel.get('variant') and wheel['variant'].get('product'):
            product = wheel['variant']['product']
            hubbore = None

            # Try to get from metafield - check the correct path from GraphQL query
            if product.get('metafield') and product['metafield'].get('value'):
                hubbore = product['metafield']['value']

            # If not found, try to get from product ID with separate query
            if not hubbore and product.get('id'):
                hubbore = get_hubbore_for_product(product['id'])

            # If still not found, ask user
            if not hubbore:
                print(f"\n  Hubbore not found for wheel: {wheel['name']}")
                hubbore = input("  Please enter hubbore value (e.g., 73.1): ").strip()

            if hubbore and hubbore not in hub_rings_info:
                hub_rings_info.append(hubbore)

    # If we have hub rings but no hubbore info, ask user to provide it
    if has_hub_rings and not hub_rings_info:
        print(f"\n  This order includes hub rings/installation kit but no wheel to retrieve hubbore from.")
        while True:
            try:
                response = input("  Enter hubbore value? (y/n): ").strip().lower()
                if response in ['y', 'yes']:
                    hubbore = input("  Hubbore value (e.g., 73.1): ").strip()
                    if hubbore:
                        hub_rings_info.append(hubbore)
                        print(f"  ✓ Hubbore value added: {hubbore}")
                    break
                elif response in ['n', 'no']:
                    print(f"  ✓ Processing hub rings without hubbore specification")
                    break
                else:
                    print("  Please enter 'y' or 'n'")
            except KeyboardInterrupt:
                print("\n\nOperation cancelled by user.")
                exit(0)

    # Process each accessory
    for acc in accessories:
        name = acc['name']
        variant_title = acc.get('variant_title', '')

        # Check if it's an installation kit
        if 'installation kit' in name.lower():
            # Split into lugs and hub rings
            color = variant_title if variant_title else 'Black'

            formatted_accessories.append(f"{color} Lugs")

            # Add hub rings with hubbore info
            if hub_rings_info:
                hub_rings_text = f"Hub Rings ({', '.join(hub_rings_info)})"
            else:
                hub_rings_text = "Hub Rings"
            formatted_accessories.append(hub_rings_text)
        elif 'hub centric' in name.lower() or 'hub rings' in name.lower():
            # Standalone hub centric rings - add with hubbore info
            if hub_rings_info:
                formatted_accessories.append(f"{name} ({', '.join(hub_rings_info)})")
            else:
                formatted_accessories.append(name)
        else:
            # Regular accessory - include variant if available and not already in name
            if variant_title and variant_title.lower() != 'default title':
                # Check if variant title is already in the product name
                if variant_title.lower() not in name.lower():
                    formatted_accessories.append(f"{name} ({variant_title})")
                else:
                    formatted_accessories.append(name)
            else:
                formatted_accessories.append(name)

    return formatted_accessories

def get_user_input():
    """Get order numbers from user"""
    print("\n" + "="*60)
    print("SELECTIVE ORDER PROCESSING")
    print("="*60)

    # Get order IDs
    print("\nEnter order numbers (separated by commas or spaces)")
    print("Example: 62423210, 62423311 or #1001 #1002")

    while True:
        try:
            order_input = input("\nOrder IDs: ").strip()
            if not order_input:
                print("Please enter at least one order ID")
                continue

            # Parse order IDs (handle both comma and space separation)
            order_input = order_input.replace(',', ' ')
            order_numbers = [num.strip() for num in order_input.split() if num.strip()]

            if not order_numbers:
                print("Please enter at least one order ID")
                continue

            print(f"\nFound {len(order_numbers)} order(s): {', '.join(order_numbers)}")
            return order_numbers

        except KeyboardInterrupt:
            print("\n\nOperation cancelled by user.")
            exit(0)

def select_items_for_order(order):
    """Interactively select items for an order"""
    print(f"\n{'='*60}")
    print(f"Processing PO #{order['name'].replace('#', '')}")
    print(f"{'='*60}")

    line_items_raw = order['lineItems']['edges']
    selected_regular_items = []
    accessories = []
    wheels = []
    has_accessories = False

    if not line_items_raw:
        print("  No line items found in this order")
        return selected_regular_items, accessories, wheels, False

    # First pass: detect accessories and wheels
    for edge in line_items_raw:
        item = edge['node']

        # Skip shipping protection automatically
        if 'shipping protection' in item['name'].lower():
            continue

        if is_accessory(item):
            has_accessories = True

        if is_wheel(item):
            wheels.append(item)

    # Ask about accessories processing if found
    accessories_mode = None
    if has_accessories:
        print("\n  This order contains accessories.")
        print("  How would you like to process them?")
        print("    1. Process accessories WITH regular items (separate PDFs)")
        print("    2. Process accessories ONLY")
        print("    3. Process regular items ONLY (skip accessories)")

        while True:
            try:
                choice = input("  Enter choice (1/2/3): ").strip()
                if choice == '1':
                    accessories_mode = 'with_regular'
                    break
                elif choice == '2':
                    accessories_mode = 'only'
                    break
                elif choice == '3':
                    accessories_mode = 'skip'
                    break
                else:
                    print("  Please enter 1, 2, or 3")
            except KeyboardInterrupt:
                print("\n\nOperation cancelled by user.")
                exit(0)

    # Second pass: select items based on mode
    for idx, edge in enumerate(line_items_raw, 1):
        item = edge['node']
        product_name = item['name']
        quantity = item['quantity']
        sku = item['variant']['sku'] if item['variant'] else 'N/A'
        variant_title = item['variant']['title'] if item['variant'] else ''

        # Skip shipping protection
        if 'shipping protection' in product_name.lower():
            print(f"\nItem {idx}/{len(line_items_raw)}:")
            print(f"  Product: {product_name}")
            print(f"  ✓ Auto-skipped (Shipping Protection)")
            continue

        is_acc = is_accessory(item)

        # Skip based on accessories mode
        if accessories_mode == 'only' and not is_acc:
            continue
        elif accessories_mode == 'skip' and is_acc:
            continue

        print(f"\nItem {idx}/{len(line_items_raw)}:")
        print(f"  Product: {product_name}")
        print(f"  SKU: {sku}")
        if variant_title and variant_title != 'Default Title':
            print(f"  Variant: {variant_title}")
        print(f"  Quantity: {quantity}")
        if is_acc:
            print(f"  [ACCESSORY]")

        while True:
            try:
                response = input("  Include this item? (Y/n): ").strip().lower()

                if response in ['', 'y', 'yes']:
                    if is_acc:
                        accessories.append({
                            'name': product_name,
                            'quantity': quantity,
                            'sku': sku,
                            'variant_title': variant_title,
                            'variant': item.get('variant')
                        })
                    else:
                        selected_regular_items.append({
                            'name': product_name,
                            'quantity': quantity,
                            'sku': sku
                        })
                    print("    ✓ Item included")
                    break
                elif response in ['n', 'no']:
                    print("    ✗ Item skipped")
                    break
                else:
                    print("    Please enter 'y' or 'n'")

            except KeyboardInterrupt:
                print("\n\nOperation cancelled by user.")
                exit(0)

    return selected_regular_items, accessories, wheels, accessories_mode

def main():
    print("\n" + "="*60)
    print("SELECTIVE ORDER PROCESSING")
    print("="*60)

    # Verify credentials
    if not SHOPIFY_STORE_URL or not SHOPIFY_ACCESS_TOKEN:
        print("\n❌ ERROR: Missing credentials in .env file!")
        return

    # Get order numbers from user
    order_numbers = get_user_input()

    # Get script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Process each order
    for order_num in order_numbers:
        # Clean order number (remove # if present)
        order_num_clean = order_num.replace('#', '').strip()

        print(f"\n📦 Fetching order #{order_num_clean}...")

        order = get_order_by_name(order_num_clean)

        if not order:
            print(f"   ❌ Order #{order_num_clean} not found")
            continue

        print(f"   ✅ Order #{order_num_clean} retrieved")

        # Extract vehicle information
        vehicle_info = extract_vehicle_info(order)
        if vehicle_info:
            print(f"   Vehicle: {vehicle_info}")

        # Select items interactively
        regular_items, accessories, wheels, accessories_mode = select_items_for_order(order)

        # Create order-specific folder
        order_folder = os.path.join(script_dir, f"PO_{order_num_clean}")
        os.makedirs(order_folder, exist_ok=True)

        # Format shipping address
        shipping_address = format_shipping_address(order.get('shippingAddress'))

        # Generate timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        # Process regular items
        if regular_items and accessories_mode != 'only':
            print(f"\n   Selected {len(regular_items)} regular item(s) for processing")

            # Prepare order data
            order_data = {
                'order_name': order['name'].replace('#', ''),
                'selected_items': regular_items,
                'shipping_address': shipping_address
            }

            # Generate PDF filename
            pdf_filename = f"{order_num_clean}_{timestamp}.pdf"
            pdf_path = os.path.join(order_folder, pdf_filename)

            # Create PDF
            print(f"\n   Generating PDF...")
            create_pdf_for_order(order_data, pdf_path, is_accessories=False)

        # Process accessories
        if accessories and accessories_mode in ['with_regular', 'only']:
            print(f"\n   Processing {len(accessories)} accessory/accessories...")

            # If no vehicle info found, ask user if they want to enter it manually
            if not vehicle_info:
                print(f"\n   No vehicle information found for this order.")
                while True:
                    try:
                        response = input("   Enter vehicle info manually? (y/n): ").strip().lower()
                        if response in ['y', 'yes']:
                            vehicle_info = input("   Vehicle: ").strip()
                            if vehicle_info:
                                print(f"   ✓ Vehicle info added: {vehicle_info}")
                            break
                        elif response in ['n', 'no']:
                            print(f"   ✓ Processing accessories without vehicle info")
                            break
                        else:
                            print("   Please enter 'y' or 'n'")
                    except KeyboardInterrupt:
                        print("\n\nOperation cancelled by user.")
                        exit(0)

            # Format accessories
            formatted_accessories = process_accessories(accessories, wheels, vehicle_info)

            # Prepare accessories order data
            accessories_data = {
                'order_name': order['name'].replace('#', ''),
                'selected_items': formatted_accessories,
                'shipping_address': shipping_address,
                'vehicle_info': vehicle_info
            }

            # Generate PDF filename for accessories
            pdf_filename = f"{order_num_clean}_accessories_{timestamp}.pdf"
            pdf_path = os.path.join(order_folder, pdf_filename)

            # Create accessories PDF
            print(f"\n   Generating accessories PDF...")
            create_pdf_for_order(accessories_data, pdf_path, is_accessories=True)

        if not regular_items and not accessories:
            print(f"\n   ⚠️  No items selected for PO #{order_num_clean}.")

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"Orders processed: {len(order_numbers)}")
    print("="*60)

if __name__ == "__main__":
    main()
