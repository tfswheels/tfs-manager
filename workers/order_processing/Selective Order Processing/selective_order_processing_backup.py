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
    """Fetch a single order by order name (e.g., #1001) using GraphQL"""
    query = f'''
    query {{
        orders(first: 1, query: "name:{order_name}") {{
            edges {{
                node {{
                    id
                    name
                    createdAt
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
                                name
                                quantity
                                variant {{
                                    sku
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

def create_pdf_for_order(order_data, output_path):
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
    po_header_data = [[f"PO #{order_data['order_name']}"]]
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

    # Line items as table
    # Create style for product names to handle wrapping
    product_style = ParagraphStyle(
        'ProductStyle',
        parent=styles['Normal'],
        fontSize=8,
        fontName='Helvetica',
        leading=10
    )

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
    selected_items = []

    if not line_items_raw:
        print("  No line items found in this order")
        return selected_items

    for idx, edge in enumerate(line_items_raw, 1):
        item = edge['node']
        product_name = item['name']
        quantity = item['quantity']
        sku = item['variant']['sku'] if item['variant'] else 'N/A'

        print(f"\nItem {idx}/{len(line_items_raw)}:")
        print(f"  Product: {product_name}")
        print(f"  SKU: {sku}")
        print(f"  Quantity: {quantity}")

        while True:
            try:
                response = input("  Include this item? (Y/n): ").strip().lower()

                if response in ['', 'y', 'yes']:
                    selected_items.append({
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

    return selected_items

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

        # Select items interactively
        selected_items = select_items_for_order(order)

        if not selected_items:
            print(f"\n   ⚠️  No items selected for PO #{order_num_clean}. Skipping PDF generation.")
            continue

        print(f"\n   Selected {len(selected_items)} item(s) for processing")

        # Create order-specific folder
        order_folder = os.path.join(script_dir, f"PO_{order_num_clean}")
        os.makedirs(order_folder, exist_ok=True)

        # Format shipping address
        shipping_address = format_shipping_address(order.get('shippingAddress'))

        # Prepare order data
        order_data = {
            'order_name': order['name'].replace('#', ''),
            'selected_items': selected_items,
            'shipping_address': shipping_address
        }

        # Generate PDF filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        pdf_filename = f"{order_num_clean}_{timestamp}.pdf"
        pdf_path = os.path.join(order_folder, pdf_filename)

        # Create PDF
        print(f"\n   Generating PDF...")
        create_pdf_for_order(order_data, pdf_path)

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"Orders processed: {len(order_numbers)}")
    print("="*60)

if __name__ == "__main__":
    main()
