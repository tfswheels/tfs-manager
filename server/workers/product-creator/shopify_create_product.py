"""
Shopify Product Creation - EXACT implementation from working create_wheels_2025-01.py

Handles complete product creation with:
- Metafields (global, convermax, custom, google)
- Category/Taxonomy
- Product options and variants
- Inventory tracking and quantities
- Images/Media
- Publishing to sales channels
"""

import asyncio
import aiohttp
import json
from typing import Dict, List, Optional

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import MODE, SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, logger
except ImportError:
    from config import MODE, SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, logger

# Constants from working script
CATEGORY_ID = "gid://shopify/TaxonomyCategory/vp-1-4-20-1-1"  # Wheels category
TIRE_CATEGORY_ID = "gid://shopify/TaxonomyCategory/vp-1-4-20-3-1"  # Tires category
LOCATION_ID = "gid://shopify/Location/69594415255"
THROTTLE_THRESHOLD = 120
MAX_AVAILABLE = 2000


# ==============================================================================
# HELPER FUNCTIONS (from create_wheels_2025-01.py)
# ==============================================================================

def format_offset(offset: str) -> str:
    """Format offset with + sign if positive and append 'mm', e.g. +35mm."""
    if not offset:
        return ""
    try:
        val = float(offset)
        if val.is_integer():
            val = int(val)
        if val > 0:
            return f"+{val}mm"
        elif val < 0:
            return f"{val}mm"
        return "0mm"
    except (ValueError, TypeError):
        return offset

def format_bolt_pattern(pattern: str) -> str:
    """Convert bolt pattern from e.g. '5x4.5' -> '5x114.3' if <10, else leave it."""
    if not pattern:
        return ""
    try:
        lug_count, diameter = pattern.lower().split('x')
        diameter_val = float(diameter)
        if diameter_val < 10:  # treat as inches
            mm = round(diameter_val * 25.4, 1)
            mm_str = f"{mm:.1f}".rstrip('0').rstrip('.')
            return f"{lug_count}x{mm_str}"
        return pattern
    except:
        return pattern

def get_lug_count(bolt_pattern: str) -> Optional[str]:
    """Extract lug count from bolt pattern. Examples: '5x120' -> '5-Lug'"""
    if not bolt_pattern:
        return None

    try:
        parts = bolt_pattern.upper().split('X')
        if len(parts) >= 2:
            lug_num = parts[0].strip()
            if lug_num.isdigit():
                num = int(lug_num)
                if num > 0:
                    return f"{num}-Lug"
    except:
        pass

    return None

def generate_body_html(wheel: Dict) -> str:
    """Generate the product's descriptive HTML (descriptionHtml)."""
    specs = [
        ('Brand', wheel.get('brand')),
        ('Model', wheel.get('model')),
        ('Series', wheel.get('model_other')),
        ('Part Number', wheel.get('part_number')),
        ('Size', wheel.get('size')),
        ('Color', wheel.get('short_color')),
        ('Finish', wheel.get('finish')),
        ('Wheel Diameter', wheel.get('diameter')),
        ('Wheel Width', wheel.get('width')),
        ('Offset', format_offset(wheel.get('offset'))),
        ('Offset Range', wheel.get('offset_range')),
        ('Bolt Pattern', ', '.join(
            p for p in [
                format_bolt_pattern(wheel.get('bolt_pattern')),
                format_bolt_pattern(wheel.get('bolt_pattern2'))
            ]
            if p and p.lower() != 'none'
        )),
        ('Backspace', wheel.get('backspace')),
        ('Hub Bore', wheel.get('hub_bore')),
        ('Lip Size', wheel.get('lip_size')),
        ('Load Rating', wheel.get('load_rating')),
        ('Spokes', wheel.get('spoke_number')),
        ('Wheel Material', wheel.get('material')),
        ('Wheel Style', wheel.get('style')),
        ('Wheel Structure', wheel.get('structure')),
        ('Weight', f"{wheel.get('weight')} lbs" if wheel.get('weight') else None)
    ]

    lines = ['<h3>Wheel Specs</h3>']
    for label, val in specs:
        if val:
            lines.append(f"<b>{label}:</b> {val}<br>")

    # Additional finishes
    if wheel.get('available_finishes'):
        finishes = [
            f.strip() for f in wheel['available_finishes'].split(',')
            if f.strip().lower() != 'none'
        ]
        if finishes:
            lines.append('<b>Other Finishes:</b><br>')
            for fin in finishes:
                lines.append(f"{fin}<br>")

    # Additional bolt patterns
    if wheel.get('available_bolt_patterns'):
        patterns = [
            format_bolt_pattern(p.strip())
            for p in wheel['available_bolt_patterns'].split(',')
            if p.strip().lower() != 'none'
        ]
        if patterns:
            lines.append('<b>Available Bolt Patterns:</b><br>')
            lines.append(', '.join(patterns))

    return "\n".join(lines)

def prepare_metafields(wheel_data: Dict) -> List[Dict]:
    """Prepare metafields for the wheel product."""
    metafields: List[Dict] = []

    # Global metafields
    title_str = f"{wheel_data['brand']} {wheel_data['model']}"
    if wheel_data.get('model_other'):
        title_str += f" {wheel_data['model_other']}"
    title_str += f" {wheel_data['size']} {format_offset(wheel_data.get('offset'))} {wheel_data.get('finish','')}"
    metafields.append({
        "namespace": "global",
        "key": "title_tag",
        "type": "single_line_text_field",
        "value": title_str
    })

    desc = (
        f"Shop {wheel_data['brand']} {wheel_data['model']} {wheel_data['size']} "
        f"{format_offset(wheel_data.get('offset'))} {wheel_data.get('finish','')} "
        "wheels from TFS Wheels – Guaranteed fitment!"
    )
    metafields.append({
        "namespace": "global",
        "key": "description_tag",
        "type": "single_line_text_field",
        "value": desc
    })

    # Convermax metafields
    if wheel_data.get('size'):
        metafields.append({
            "namespace": "convermax",
            "key": "wheel_size",
            "type": "single_line_text_field",
            "value": wheel_data['size']
        })
    if wheel_data.get('diameter'):
        metafields.append({
            "namespace": "convermax",
            "key": "wheel_diameter",
            "type": "single_line_text_field",
            "value": wheel_data['diameter']
        })
    if wheel_data.get('width'):
        metafields.append({
            "namespace": "convermax",
            "key": "wheel_width",
            "type": "single_line_text_field",
            "value": wheel_data['width']
        })

    offset_formatted = format_offset(wheel_data.get('offset'))
    offset_no_mm = offset_formatted.replace("mm", "").strip() if offset_formatted else ""
    metafields.append({
        "namespace": "convermax",
        "key": "wheel_offset",
        "type": "single_line_text_field",
        "value": offset_no_mm
    })

    color_list = []
    if wheel_data.get('primary_color'):
        color_list.append(wheel_data['primary_color'])
    metafields.append({
        "namespace": "convermax",
        "key": "wheel_color",
        "type": "list.single_line_text_field",
        "value": json.dumps(color_list)
    })

    raw_patterns = []
    if wheel_data.get('bolt_pattern'):
        raw_patterns.append(wheel_data['bolt_pattern'])
    if wheel_data.get('bolt_pattern2'):
        raw_patterns.append(wheel_data['bolt_pattern2'])
    metafields.append({
        "namespace": "convermax",
        "key": "wheel_bolt_pattern",
        "type": "list.single_line_text_field",
        "value": json.dumps(raw_patterns)
    })

    # Custom metafields
    def weight_str(d: Dict) -> str:
        w = d.get('weight')
        return f"{w} lbs" if w else ""

    custom_map = {
        'hubbore': ['single_line_text_field', 'hub_bore'],
        'wheel_model': ['single_line_text_field', 'model'],
        'finish': ['single_line_text_field', 'finish'],
        'wheel_load_rating': ['single_line_text_field', 'load_rating'],
        'weight': ['single_line_text_field', weight_str],
        'backspace': ['single_line_text_field', 'backspace'],
        'offset_range': ['single_line_text_field', 'offset_range'],
        'lip_size': ['single_line_text_field', 'lip_size'],
        'spoke_count': ['single_line_text_field', 'spoke_number'],
        'wheel_material': ['single_line_text_field', 'material'],
        'wheel_style': ['single_line_text_field', 'style'],
        'wheel_structure': ['single_line_text_field', 'structure'],
        'available_finishes': [
            'list.single_line_text_field',
            lambda d: json.dumps([
                f.strip() for f in (d.get('available_finishes') or '').split(',')
                if f.strip() and f.strip().lower() != 'none'
            ])
        ],
        'available_bolt_patterns': [
            'list.single_line_text_field',
            lambda d: json.dumps([
                p.strip() for p in (d.get('available_bolt_patterns') or '').split(',')
                if p.strip() and p.strip().lower() != 'none'
            ])
        ]
    }
    for field, (field_type, source) in custom_map.items():
        value = source(wheel_data) if callable(source) else wheel_data.get(source)
        if value:
            metafields.append({
                "namespace": "custom",
                "key": field,
                "type": field_type,
                "value": str(value)
            })

    lug_count = get_lug_count(wheel_data.get('bolt_pattern'))
    if not lug_count and wheel_data.get('bolt_pattern2'):
        lug_count = get_lug_count(wheel_data['bolt_pattern2'])

    if lug_count:
        metafields.append({
            "namespace": "custom",
            "key": "lug_count",
            "type": "single_line_text_field",
            "value": lug_count
        })

    # Only add if value is not empty
    short_color = wheel_data.get('short_color', '').strip()
    if short_color:
        metafields.append({
            "namespace": "google",
            "key": "wheel_color",
            "type": "single_line_text_field",
            "value": short_color
        })

    # Generate Google Shopping feed title
    if (wheel_data.get('diameter') and wheel_data.get('width') and
        wheel_data.get('brand') and wheel_data.get('short_color')):

        feed_parts = []
        feed_parts.append(f"{wheel_data['diameter']}x{wheel_data['width']}")
        feed_parts.append(wheel_data['brand'])
        if wheel_data.get('model'):
            feed_parts.append(wheel_data['model'])
        feed_parts.append(wheel_data['short_color'])

        bolt_pattern = wheel_data.get('bolt_pattern')
        if bolt_pattern and not bolt_pattern.lower().startswith('0x'):
            import re
            bolt_pattern = re.sub(r'\([^)]*\)', '', bolt_pattern).strip()
            if 'x' in bolt_pattern.lower() or '-' in bolt_pattern:
                if 'blank' in bolt_pattern.lower():
                    if re.search(r'\d[xX]\s*blank', bolt_pattern, re.IGNORECASE):
                        bolt_pattern = re.sub(r'blank', 'Blank', bolt_pattern, flags=re.IGNORECASE)
                    else:
                        bolt_pattern = None

                if bolt_pattern:
                    bolt_pattern = bolt_pattern.replace(',', '/').replace('X', 'x')
                    if bolt_pattern and bolt_pattern.lower() != 'x':
                        feed_parts.append(bolt_pattern)

        feed_title = ' '.join(feed_parts)
        metafields.append({
            "namespace": "custom",
            "key": "multifeed_title",
            "type": "single_line_text_field",
            "value": feed_title
        })

    return metafields


# ==============================================================================
# TIRE HELPER FUNCTIONS (from create_tires_2025-01.py)
# ==============================================================================

def generate_body_html_tire(tire: Dict) -> str:
    """Generate the body HTML for a tire product."""
    try:
        # Safely handle warranty text - replace any text starting with 'Manufacture'
        warranty = tire.get('warranty', '')
        if warranty and warranty.startswith('Manufacture'):
            warranty = "Manufacturer's Warranty"

        specs = [
            ('Brand', tire.get('brand')),
            ('Model', tire.get('model')),
            ('Part Number', tire.get('part_number')),
            ('Size', tire.get('size')),
            ('Category/Type', f"{tire.get('tire_type', '')}, {tire.get('tire_type2', '')}".strip(', ')),
            ('Section Width', tire.get('section_width')),
            ('Aspect Ratio', tire.get('aspect_ratio')),
            ('Rim Diameter', tire.get('rim_diameter')),
            ('Load Index', tire.get('load_index')),
            ('Load Range', tire.get('load_range')),
            ('Speed Rating', tire.get('speed_index')),
            ('Service Description', tire.get('service_description')),
            ('Sidewall', tire.get('sidewall')),
            ('Tread Depth', tire.get('tread_depth')),
            ('Overall Diameter', tire.get('inflated_diameter')),
            ('Overall Width', tire.get('inflated_width')),
            ('Temperature', tire.get('temperature')),
            ('Traction', tire.get('traction')),
            ('Tread Wear', tire.get('tread_wear')),
            ('Max Inflation Pressure', tire.get('metafield_max_inflation_pressure')),
            ('Revs per mile', tire.get('revs_per_mile')),
            ('UTQG', tire.get('utqg')),
            ('Ply Rating', tire.get('ply')),
            ('Warranty (miles)', warranty),
            ('Weight', tire.get('metafield_weight'))
        ]

        html = ['<h3>Tire Spec</h3><hr>']
        for label, value in specs:
            if value:
                html.append(f'<b>{label}: </b>{value}<br>')

        return '\n'.join(html)
    except Exception as e:
        logger.error(f"Error generating HTML for tire: {str(e)}")
        return "<h3>Tire Spec</h3>\n<p>Specifications temporarily unavailable</p>"


def prepare_metafields_tire(tire_data: Dict) -> List[Dict]:
    """Prepare all metafields for a tire product."""
    metafields = []

    # Global metafields
    global_fields = {
        'title_tag': tire_data.get('metafield_title_tag'),
        'description_tag': tire_data.get('metafield_description_tag')
    }

    for key, value in global_fields.items():
        if value:
            metafields.append({
                "namespace": "global",
                "key": key,
                "type": "single_line_text_field",
                "value": str(value)
            })

    # Custom metafields
    custom_fields = {
        'tire_model': 'single_line_text_field',
        'service_description': 'single_line_text_field',
        'tire_type_combined': 'list.single_line_text_field',
        'tire_sidewall': 'single_line_text_field',
        'overall_diameter': 'single_line_text_field',
        'overall_width': 'single_line_text_field',
        'load_range': 'single_line_text_field',
        'max_inflation_pressure': 'single_line_text_field',
        'ply_rating': 'single_line_text_field',
        'tread_depth': 'single_line_text_field',
        'weight': 'single_line_text_field',
        'revs_per_mile': 'single_line_text_field',
        'utqg': 'single_line_text_field',
        'temperature': 'single_line_text_field',
        'traction': 'single_line_text_field',
        'tread_wear': 'single_line_text_field',
        'tire_mileage_warranty': 'single_line_text_field'
    }

    for field, field_type in custom_fields.items():
        metafield_key = f'metafield_{field}'
        if tire_data.get(metafield_key):
            metafields.append({
                "namespace": "custom",
                "key": field,
                "type": field_type,
                "value": str(tire_data[metafield_key])
            })

    # Convermax metafields
    convermax_fields = {
        'tire_size': 'single_line_text_field',
        'tire_width': 'single_line_text_field',
        'tire_aspect_ratio': 'single_line_text_field',
        'tire_rim': 'single_line_text_field',
        'tire_speed_rating': 'single_line_text_field',
        'tire_load_index': 'single_line_text_field'
    }

    for field, field_type in convermax_fields.items():
        metafield_key = f'metafield_{field}'
        if tire_data.get(metafield_key):
            metafields.append({
                "namespace": "convermax",
                "key": field,
                "type": field_type,
                "value": str(tire_data[metafield_key])
            })

    return metafields


# ==============================================================================
# RATE LIMITING
# ==============================================================================

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


# ==============================================================================
# SHOPIFY MUTATIONS
# ==============================================================================

async def create_product_asynchronous_mutation(wheel_data: Dict):
    """
    Build the productSet mutation and variables.
    Detects product type (wheel vs tire) and uses appropriate settings.
    """
    # Detect product type: if has 'finish', it's a wheel; if has 'size' but no 'finish', it's a tire
    is_tire = not wheel_data.get('finish') and wheel_data.get('size')

    variant_weight = 0.0
    if wheel_data.get('weight'):
        try:
            variant_weight = float(wheel_data['weight'])
        except:
            pass

    # Tags - wheels can have custom_build tags, tires always just SDW Wholesale
    tags = ["SDW Wholesale"]
    if not is_tire:
        if wheel_data.get('custom_build') == '1':
            tags.append('made-to-order')
        if wheel_data.get('custom_build') == '2':
            tags.append('custom-drill')

    # Use tire-specific or wheel-specific functions
    if is_tire:
        description_html = generate_body_html_tire(wheel_data)
        metafields_raw = prepare_metafields_tire(wheel_data)
        product_type = "Tires"
        category_id = TIRE_CATEGORY_ID
        template_suffix = "ecom-tires"
    else:
        description_html = generate_body_html(wheel_data)
        metafields_raw = prepare_metafields(wheel_data)
        product_type = "Wheels"
        category_id = CATEGORY_ID
        template_suffix = "ecom-new-product-page"

    # Filter out any metafields with empty/None values
    metafields = []
    for mf in metafields_raw:
        value = mf.get('value', '')
        if value is not None and str(value).strip():
            metafields.append(mf)
        else:
            logger.warning(f"Skipping empty metafield: {mf['namespace']}.{mf['key']} (value={repr(value)})")

    logger.info(f"Product {wheel_data.get('part_number')} ({product_type}): {len(metafields)} metafields (filtered from {len(metafields_raw)})")

    price_str = str(wheel_data.get('map_price', '0.00'))

    mutation = """
    mutation createProductAsynchronous($productSet: ProductSetInput!, $synchronous: Boolean!) {
      productSet(synchronous: $synchronous, input: $productSet) {
        product {
          id
          handle
          variants(first: 5) {
            edges {
              node {
                id
                inventoryItem {
                  id
                }
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
    # Inventory settings - tires always track inventory and DENY, wheels may vary
    if is_tire:
        inventory_tracked = True
        inventory_policy = "DENY"
    else:
        inventory_tracked = (wheel_data.get('custom_build') != '1')
        inventory_policy = "CONTINUE" if wheel_data.get('custom_build') == '1' else "DENY"

    variables = {
        "synchronous": True,
        "productSet": {
            "title": wheel_data['title'],
            "handle": wheel_data['handle'],
            "vendor": wheel_data['brand'],
            "productType": product_type,
            "status": "ACTIVE",
            "descriptionHtml": description_html,
            "templateSuffix": template_suffix,
            "tags": tags,
            "metafields": metafields,
            "category": category_id,
            "productOptions": [
                {
                    "name": "Title",
                    "position": 1,
                    "values": [{"name": "Default Title"}]
                }
            ],
            "variants": [
                {
                    "sku": wheel_data['part_number'],
                    "price": price_str,
                    "optionValues": [{"optionName": "Title", "name": "Default Title"}],
                    "inventoryItem": {
                        "tracked": inventory_tracked,
                        "requiresShipping": True,
                        "measurement": {
                            "weight": {
                                "value": variant_weight,
                                "unit": "POUNDS"
                            }
                        }
                    },
                    "inventoryPolicy": inventory_policy
                }
            ]
        }
    }
    return mutation, variables

async def update_inventory_item(session: aiohttp.ClientSession, inventory_item_id: str, quantity: int) -> bool:
    """Update inventory quantity for a variant."""
    mutation = """
    mutation adjustInventoryQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors {
          field
          message
        }
        inventoryAdjustmentGroup {
          changes {
            delta
          }
        }
      }
    }
    """
    variables = {
        "input": {
            "reason": "correction",
            "name": "available",
            "changes": [
                {
                    "delta": quantity,
                    "inventoryItemId": inventory_item_id,
                    "locationId": LOCATION_ID
                }
            ]
        }
    }
    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
    }
    async with session.post(
        SHOPIFY_STORE_URL, headers=headers, json={"query": mutation, "variables": variables}
    ) as resp:
        data = await resp.json()
        throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
        await handle_rate_limiting(throttle)
        user_errors = data.get("data", {}).get("inventoryAdjustQuantities", {}).get("userErrors")
        if user_errors:
            logger.error(f"inventoryAdjustQuantities errors: {user_errors}")
            return False
        return True

async def product_create_media_mutation(session: aiohttp.ClientSession, product_id: str, url: str, alt_text: str):
    """Add media/image to a product."""
    mutation = """
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          mediaContentType
          status
        }
        mediaUserErrors {
          field
          message
        }
      }
    }
    """
    variables = {
        "productId": product_id,
        "media": [{
            "alt": alt_text,
            "mediaContentType": "IMAGE",
            "originalSource": url
        }]
    }
    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
    }
    async with session.post(
        SHOPIFY_STORE_URL, headers=headers, json={"query": mutation, "variables": variables}
    ) as resp:
        data = await resp.json()
        throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
        await handle_rate_limiting(throttle)
        if 'errors' in data:
            logger.error(f"Error uploading media: {data['errors']}")

async def publish_to_sales_channels(session: aiohttp.ClientSession, product_id: str):
    """Publish a product to specific sales channels."""
    publication_ids = [
        "gid://shopify/Publication/132182868119",  # Online Store
        "gid://shopify/Publication/133352751255",  # Facebook & Instagram
        "gid://shopify/Publication/134946783383",  # Google & YouTube
        "gid://shopify/Publication/154619510935"   # Microsoft Channel
    ]

    mutation = """
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors {
          field
          message
        }
      }
    }
    """

    variables = {
        "id": product_id,
        "input": [{"publicationId": pub_id} for pub_id in publication_ids]
    }

    headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
    }

    try:
        async with session.post(
            SHOPIFY_STORE_URL, headers=headers, json={"query": mutation, "variables": variables}
        ) as resp:
            data = await resp.json()
            throttle = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            await handle_rate_limiting(throttle)
            user_errors = data.get("data", {}).get("publishablePublish", {}).get("userErrors")
            if user_errors:
                logger.warning(f"Publishing errors for product {product_id}: {user_errors}")
                return False
            logger.info(f"✅ Published product {product_id} to sales channels")
            return True
    except Exception as e:
        logger.error(f"Failed to publish product {product_id}: {str(e)}")
        return False


# ==============================================================================
# MAIN PRODUCT CREATION FUNCTION
# ==============================================================================

async def create_product_on_shopify(session: aiohttp.ClientSession, wheel_data: Dict, gcs_image_url: Optional[str] = None):
    """
    Create a product on Shopify using productSet mutation.

    This is the EXACT implementation from create_wheels_2025-01.py that WORKS.

    Args:
        session: aiohttp session
        wheel_data: Dict with complete wheel data (klaviyo + extracted data)
        gcs_image_url: Optional GCS image URL

    Returns:
        Tuple of (result_dict, error_message):
        - result_dict: Dict with shopify_id, variant_id, handle if successful, None if failed
        - error_message: String with error details if failed, None if successful
    """
    try:
        logger.info(f"Creating product: {wheel_data.get('part_number')}")

        # Build mutation
        mutation, variables = await create_product_asynchronous_mutation(wheel_data)

        headers = {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
        }

        async with session.post(
            SHOPIFY_STORE_URL, headers=headers, json={"query": mutation, "variables": variables}
        ) as resp:
            result = await resp.json()
            throttle = result.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            await handle_rate_limiting(throttle)

            user_errors = result.get("data", {}).get("productSet", {}).get("userErrors")
            if 'errors' in result or (user_errors and len(user_errors) > 0):
                # Format error message for database
                errors = result.get('errors') or user_errors
                error_message = json.dumps(errors, indent=2)
                logger.error(f"productSet errors for SKU={wheel_data['part_number']}:\n{error_message}")
                return None, error_message

            product_data = result["data"]["productSet"]["product"]
            product_id = product_data["id"]
            shopify_handle = product_data["handle"]

            # Extract variant information
            variant_node = product_data["variants"]["edges"][0]["node"]
            shopify_variant_id = variant_node["id"]
            inventory_item_id = variant_node["inventoryItem"]["id"]

            logger.info(f"✅ Created product {product_id} for SKU={wheel_data['part_number']}")

            # Publish to all sales channels
            await publish_to_sales_channels(session, product_id)

            # Update inventory if needed
            qty = int(wheel_data.get("quantity", 0))
            if qty > 0:
                ok = await update_inventory_item(session, inventory_item_id, qty)
                if not ok:
                    logger.error(f"Could not adjust inventory for SKU={wheel_data['part_number']}")

            # Add product images
            # Detect if this is a tire (tires have multiple images: image3, image1, image2)
            is_tire = not wheel_data.get('finish') and wheel_data.get('size')

            if is_tire:
                # Tire: Add multiple images in order: image3, image1, image2
                alt_text = f"{wheel_data['brand']} {wheel_data['model']} {wheel_data.get('size', '')} Tire"

                # Process images in order (from reference script lines 694-795)
                for image_field in ['image3', 'image1', 'image2']:
                    image_url = wheel_data.get(image_field)
                    if image_url:
                        await product_create_media_mutation(
                            session,
                            product_id,
                            image_url,
                            alt_text.strip()
                        )
            else:
                # Wheel: Add single image
                alt_text = f"{wheel_data['brand']} {wheel_data['model']} {wheel_data['finish']}"

                if gcs_image_url:
                    await product_create_media_mutation(
                        session,
                        product_id,
                        gcs_image_url,
                        alt_text.strip()
                    )
                elif wheel_data.get('image'):
                    await product_create_media_mutation(
                        session,
                        product_id,
                        wheel_data['image'],
                        alt_text.strip()
                    )

            return {
                'shopify_id': int(product_id.split('/')[-1]),
                'variant_id': int(shopify_variant_id.split('/')[-1]),
                'handle': shopify_handle
            }, None

    except Exception as e:
        logger.error(f"Exception creating product: {e}")
        import traceback
        error_traceback = traceback.format_exc()
        logger.error(error_traceback)
        return None, str(e)
