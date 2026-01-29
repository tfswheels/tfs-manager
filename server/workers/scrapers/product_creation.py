"""
Product Creation Module

Handles creating products in database and on Shopify.
"""

import asyncio
import aiohttp
from typing import Dict, List, Optional
from datetime import datetime, timedelta

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import (
        MODE,
        DISCOVERY_BATCH_SIZE,
        logger
    )
    from .image_processing import process_product_image
    from .shopify_create_product import create_product_on_shopify
    from .pricing_extractor import extract_map_price_from_html
except ImportError:
    from config import (
        MODE,
        DISCOVERY_BATCH_SIZE,
        logger
    )
    from image_processing import process_product_image
    from shopify_create_product import create_product_on_shopify
    from pricing_extractor import extract_map_price_from_html


# =============================================================================
# HELPER FUNCTIONS (from SDW scraper)
# =============================================================================

def convert_to_int(value):
    """Convert value to int, return None if conversion fails."""
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def convert_to_decimal(value, decimal_places=2):
    """Convert value to decimal with specified places, return None if conversion fails."""
    try:
        return round(float(value), decimal_places)
    except (ValueError, TypeError):
        return None


def process_image_url(image_url):
    """Replace compressed folder with regular folder in image URLs."""
    if image_url and isinstance(image_url, str):
        if MODE == 'wheels':
            return image_url.replace('/wheels-compressed/', '/wheels/')
        else:  # tires
            return image_url.replace('/tires-compressed/', '/tires/')
    return image_url


# =============================================================================
# PRODUCT CREATION
# =============================================================================
#
# NOTE: Daily limit tracking removed from scraper.
# Product creation limits are now handled by the product creation worker
# (server/workers/product-creator/create_shopify_products.py) using the
# daily_shopify_creation_limit table in the tfs-manager database.
#
# The scraper only saves products to wheels/tires table with product_sync='pending'.
# =============================================================================

def map_klaviyo_to_wheels_table(klaviyo_data: Dict, product_data: Dict, gcs_image_url: str, map_price: float) -> Dict:
    """Map Klaviyo data to wheels table schema (adapted from SDW scraper)."""
    return {
        'part_number': klaviyo_data.get('partnumber'),
        'url_part_number': product_data.get('url_part_number'),
        'status': klaviyo_data.get('status'),
        'brand': klaviyo_data.get('brand'),
        'supplier': klaviyo_data.get('supplier'),  # Actual wheel manufacturer from Klaviyo
        'supplier_cost': klaviyo_data.get('cost'),
        'sdw_markup_model': klaviyo_data.get('markupModel'),
        'custom_build': klaviyo_data.get('custom'),
        'preorder': klaviyo_data.get('preorder'),
        'preorder_status': klaviyo_data.get('preorderStatus'),
        'accept_backorder': klaviyo_data.get('backorderPurchase'),
        'quantity': convert_to_int(klaviyo_data.get('quantity')) or product_data.get('quantity', 0),
        'instock': convert_to_int(klaviyo_data.get('instock')),
        'model': klaviyo_data.get('model'),
        'model_other': klaviyo_data.get('modelOther'),
        'size': klaviyo_data.get('size'),
        'diameter': klaviyo_data.get('wheelsize'),
        'width': klaviyo_data.get('wheelwidth'),
        'backspace': convert_to_decimal(klaviyo_data.get('backspacing')),
        'bolt_pattern': klaviyo_data.get('boltpattern'),
        'bolt_pattern2': klaviyo_data.get('boltpattern2'),
        'primary_color': klaviyo_data.get('wheelPrirmaryColor'),
        'short_color': klaviyo_data.get('color'),
        'finish': klaviyo_data.get('colorlong'),
        'offset': klaviyo_data.get('offset'),
        'offset_range': klaviyo_data.get('offset_atv'),
        'lip_size': klaviyo_data.get('wheelLipSize'),
        'hub_bore': klaviyo_data.get('hubbore'),
        'load_rating': convert_to_int(klaviyo_data.get('loadrating')),
        'spoke_number': convert_to_int(klaviyo_data.get('wheelSpokeNumber')),
        'true_directional': klaviyo_data.get('trueDirectional'),
        'exposed_lugs': klaviyo_data.get('wheelExposedLugs'),
        'material': klaviyo_data.get('wheelMaterial'),
        'weight': convert_to_decimal(klaviyo_data.get('weight')),
        'product_weight': klaviyo_data.get('weightProduct'),
        'structure': klaviyo_data.get('wheelStructure'),
        'style': klaviyo_data.get('wheelStyle'),
        'fitment_type': klaviyo_data.get('type'),
        'vehicle_type': klaviyo_data.get('vehicleType'),
        'map_price': float(map_price) if map_price else None,
        'image': gcs_image_url,  # Already processed and uploaded to GCS
        'available_finishes': product_data.get('extracted_data', {}).get('available_finishes'),
        'available_bolt_patterns': product_data.get('extracted_data', {}).get('available_bolt_patterns'),
        'product_sync': 'pending',
    }


def map_klaviyo_to_tires_table(klaviyo_data: Dict, product_data: Dict, gcs_images: List[str], map_price: float) -> Dict:
    """Map Klaviyo data to tires table schema (adapted from SDW scraper)."""
    # GCS images are already processed and uploaded
    image1 = gcs_images[0] if gcs_images and len(gcs_images) > 0 else None
    image2 = gcs_images[1] if gcs_images and len(gcs_images) > 1 else None
    image3 = gcs_images[2] if gcs_images and len(gcs_images) > 2 else None

    return {
        'url_part_number': product_data.get('url_part_number'),
        'brand': klaviyo_data.get('brand'),
        'part_number': klaviyo_data.get('inventoryNumber'),
        'supplier': klaviyo_data.get('supplier') or 'SDW',  # Default to 'SDW' if no supplier in Klaviyo
        'supplier_cost': klaviyo_data.get('sellerCost') or klaviyo_data.get('cost'),
        'map_price': float(map_price) if map_price else None,
        'model': klaviyo_data.get('model'),
        'size': klaviyo_data.get('size'),
        'aspect_ratio': klaviyo_data.get('aspectRatio'),
        'inflated_diameter': klaviyo_data.get('inflatedDiameter'),
        'inflated_width': klaviyo_data.get('inflatedWidth'),
        'load_index': klaviyo_data.get('loadIndex'),
        'load_range': klaviyo_data.get('loadRange'),
        'max_pressure': klaviyo_data.get('maxLoadPressure'),
        'ply': klaviyo_data.get('ply'),
        'section_width': klaviyo_data.get('sectionWidth'),
        'service_description': klaviyo_data.get('serviceDescription'),
        'sidewall': klaviyo_data.get('sidewall'),
        'speed_index': klaviyo_data.get('speedIndex'),
        'rim_diameter': klaviyo_data.get('tireRimDiameter'),
        'tire_type': klaviyo_data.get('tireType'),
        'tire_type2': klaviyo_data.get('tireType2'),
        'tread_depth': klaviyo_data.get('treadDepth'),
        'weight': klaviyo_data.get('weight'),
        'warranty': klaviyo_data.get('warranty'),
        'temperature': klaviyo_data.get('tempature'),  # Note the typo
        'traction': klaviyo_data.get('traction'),
        'tread_wear': klaviyo_data.get('treadWear'),
        'utqg': klaviyo_data.get('utqg'),
        'revs_per_mile': klaviyo_data.get('revsPerMile'),
        'status': klaviyo_data.get('status') or 'Active',
        'image1': image1,
        'image2': image2,
        'image3': image3,
        'product_sync': 'pending',
    }


async def get_product_id_from_table(db_pool, url_part_number: str) -> Optional[int]:
    """
    Get product ID from wheels/tires table by url_part_number.

    Returns:
        Product ID if exists, None if not found
    """
    try:
        table_name = MODE
        id_column = 'wheel_id' if MODE == 'wheels' else 'tire_id'

        query = f"SELECT {id_column} FROM {table_name} WHERE url_part_number = %s LIMIT 1"

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, (url_part_number,))
                result = await cur.fetchone()
                return result[0] if result else None

    except Exception as e:
        logger.error(f"Error getting product ID from table: {e}")
        return None


async def create_product_in_table(db_pool, product_data: Dict, klaviyo_data: Dict, gcs_images: any, map_price: float) -> Optional[int]:
    """
    Create product in wheels or tires table.

    Returns:
        Product ID if successful, None if failed
    """
    try:
        table_name = MODE

        # Map data to table schema
        if MODE == 'wheels':
            # For wheels, gcs_images is a single image URL
            mapped_data = map_klaviyo_to_wheels_table(klaviyo_data, product_data, gcs_images, map_price)
        else:  # tires
            # For tires, gcs_images is a list of up to 3 image URLs
            mapped_data = map_klaviyo_to_tires_table(klaviyo_data, product_data, gcs_images, map_price)

        # Build INSERT query
        columns = ', '.join(mapped_data.keys())
        placeholders = ', '.join(['%s'] * len(mapped_data))
        values = tuple(mapped_data.values())

        query = f"""
        INSERT INTO {table_name} ({columns})
        VALUES ({placeholders})
        """

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, values)
                product_id = cur.lastrowid
                await conn.commit()

                logger.info(f"✅ Created product in {table_name} table: {mapped_data.get('part_number')} (ID: {product_id})")
                return product_id

    except Exception as e:
        logger.error(f"Error creating product in table: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return None


async def update_product_sync_status(db_pool, url_part_number: str, status: str, error: str = None, shopify_id: int = None, retry_count: int = 0):
    """Update product_sync status in wheels/tires table."""
    try:
        table_name = MODE

        if error:
            # Include retry count in error message for tracking
            error_with_retry = f"{error} (attempt {retry_count})" if retry_count > 0 else error
            query = f"""
            UPDATE {table_name}
            SET product_sync = %s, sync_error = %s
            WHERE url_part_number = %s
            """
            values = (status, error_with_retry, url_part_number)
        else:
            query = f"""
            UPDATE {table_name}
            SET product_sync = %s, sync_error = NULL
            WHERE url_part_number = %s
            """
            values = (status, url_part_number)

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, values)
                await conn.commit()

    except Exception as e:
        logger.error(f"Error updating product sync status: {e}")


async def insert_into_shopify_products(db_pool, product_data: Dict, shopify_result: Dict, klaviyo_data: Dict, map_price: float):
    """Insert product into shopify_products table."""
    try:
        query = """
        INSERT INTO shopify_products
        (brand, part_number, url_part_number, product_type, shopify_id, variant_id, handle,
         map_price, quantity, sdw_cost, needs_sync, sync_status, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """

        # Use supplier_cost from Klaviyo as sdw_cost
        supplier_cost = klaviyo_data.get('cost') or klaviyo_data.get('sellerCost')

        values = (
            klaviyo_data.get('brand'),
            klaviyo_data.get('partnumber') or klaviyo_data.get('inventoryNumber'),
            product_data.get('url_part_number'),
            MODE[:-1],  # 'wheels' -> 'wheel'
            shopify_result['shopify_id'],
            shopify_result.get('variant_id'),
            shopify_result.get('handle'),
            float(map_price) if map_price else 0,
            product_data.get('quantity', 0),
            supplier_cost,  # sdw_cost = supplier_cost from Klaviyo
            0,  # needs_sync
            'active',
            'CWO'
        )

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, values)
                await conn.commit()

                logger.debug(f"Inserted into shopify_products: {klaviyo_data.get('partnumber')}")

    except Exception as e:
        logger.error(f"Error inserting into shopify_products: {e}")
        import traceback
        logger.error(traceback.format_exc())


async def create_single_product(session: aiohttp.ClientSession, gcs_manager, db_pool, product: Dict, skip_shopify_creation: bool = False) -> bool:
    """
    Create a single product end-to-end using EXACT implementation from create_wheels_2025-01.py.

    Steps:
    1. Extract Klaviyo data (already done in discovery)
    2. Process and upload image to GCS
    3. Insert into wheels/tires table
    4. Create on Shopify with FULL functionality (UNLESS skip_shopify_creation=True):
       - Proper metafields (global, convermax, custom, google)
       - Category/taxonomy
       - Product options and variants with weight/shipping
       - Inventory tracking and quantity updates
       - Media/images
       - Publishing to all sales channels
    5. If successful, insert into shopify_products and update status
    6. If failed, update status to error

    Args:
        skip_shopify_creation: If True, only save to database without creating on Shopify

    Returns:
        True if successful, False if failed
    """
    try:
        extracted_data = product.get('extracted_data')
        if not extracted_data:
            logger.error(f"No extracted data for product: {product.get('url_part_number')}")
            return False

        klaviyo_data = extracted_data.get('klaviyo_data', {})
        images = extracted_data.get('images', [])
        html = extracted_data.get('html', '')  # HTML from fetch

        # Check if product is discontinued - skip if so
        status = klaviyo_data.get('status', '').lower()
        if status == 'discontinued':
            logger.info(f"Skipping discontinued product: {product.get('url_part_number')}")
            return False

        # Get map_price - either from product dict (for retries) or extract from HTML (for new products)
        map_price = product.get('map_price')
        if not map_price and html:
            # Extract from HTML if not already provided
            map_price = extract_map_price_from_html(html)
        if not map_price:
            logger.warning(f"Could not get map_price for: {product.get('url_part_number')}")
            # Don't fail completely, just use 0
            map_price = 0

        # Process images based on mode
        if MODE == 'wheels':
            # Wheels: Process 1 image
            gcs_image_url = None
            if images:
                # Check if image is already a GCS URL (from retry/database)
                if images[0] and images[0].startswith('https://storage.googleapis.com/'):
                    gcs_image_url = images[0]
                    logger.info(f"Using existing GCS image: {gcs_image_url}")
                else:
                    # New product - download and process image
                    logger.info(f"Processing wheel image: {images[0]}")
                    image_data = {
                        'image_url': images[0],
                        'product_id': product.get('url_part_number'),
                        'brand': klaviyo_data.get('brand', product.get('brand')),
                        'model': klaviyo_data.get('model', ''),
                    }
                    gcs_image_url = await process_product_image(session, gcs_manager, image_data)
                    if gcs_image_url:
                        logger.info(f"Image processed successfully: {gcs_image_url}")
                    else:
                        logger.warning(f"Image processing returned None for: {images[0]}")
            else:
                logger.warning(f"No images found to process for: {product.get('url_part_number')}")

            # For retry products, skip table creation (already exists)
            # For new products, create in table
            product_id = await get_product_id_from_table(db_pool, product.get('url_part_number'))
            if not product_id:
                # New product - create in table
                product_id = await create_product_in_table(db_pool, product, klaviyo_data, gcs_image_url, map_price)
            else:
                logger.info(f"Product already exists in table (retry): {product.get('url_part_number')} (ID: {product_id})")

        else:  # tires
            # Tires: Process up to 3 images
            # Database has: image1, image2, image3 fields
            # Processed in order: image3, image1, image2 (per create_tires_2025-01.py:695)
            gcs_image_urls = []

            # Process up to 3 images from the images list
            for idx in range(min(3, len(images))):
                # Check if image is already a GCS URL (from retry/database)
                if images[idx] and images[idx].startswith('https://storage.googleapis.com/'):
                    gcs_image_urls.append(images[idx])
                    logger.info(f"Using existing GCS image {idx+1}: {images[idx]}")
                else:
                    # New product - download and process image
                    image_data = {
                        'image_url': images[idx],
                        'product_id': product.get('url_part_number'),
                        'brand': klaviyo_data.get('brand', product.get('brand')),
                        'model': klaviyo_data.get('model', ''),
                    }
                    gcs_url = await process_product_image(session, gcs_manager, image_data)
                    if gcs_url:
                        gcs_image_urls.append(gcs_url)
                    else:
                        # Keep None for failed images to maintain order
                        gcs_image_urls.append(None)

            # map_klaviyo_to_tires_table expects list where:
            # gcs_images[0] → image1, gcs_images[1] → image2, gcs_images[2] → image3
            # Pass as-is, mapping function handles the assignment

            # For retry products, skip table creation (already exists)
            # For new products, create in table
            product_id = await get_product_id_from_table(db_pool, product.get('url_part_number'))
            if not product_id:
                # New product - create in table
                product_id = await create_product_in_table(db_pool, product, klaviyo_data, gcs_image_urls, map_price)
            else:
                logger.info(f"Product already exists in table (retry): {product.get('url_part_number')} (ID: {product_id})")

        if not product_id:
            logger.error(f"Failed to create product in table: {product.get('url_part_number')}")
            return False

        # Build product data based on mode
        if MODE == 'wheels':
            # Generate title for wheels
            try:
                from .shopify_create_product import format_offset
            except ImportError:
                from shopify_create_product import format_offset

            title = f"{klaviyo_data.get('brand', '')} {klaviyo_data.get('model', '')}"
            if klaviyo_data.get('modelOther'):
                title += f" {klaviyo_data['modelOther']}"
            title += f" {klaviyo_data.get('size', '')}"
            if klaviyo_data.get('offset'):
                title += f" {format_offset(klaviyo_data['offset'])}"
            title += f" {klaviyo_data.get('colorlong', '')}"
            title = title.strip()

            # Generate handle (URL-friendly)
            handle = f"{klaviyo_data.get('brand', '')}-{klaviyo_data.get('model', '')}-{klaviyo_data.get('size', '')}-{klaviyo_data.get('offset', '')}-{klaviyo_data.get('colorshort', '')}-{klaviyo_data.get('partnumber', '')}"
            handle = handle.replace(' ', '-').replace('/', '-').lower()

            # Format complete wheel_data with ALL fields
            wheel_data = {
                'part_number': klaviyo_data.get('partnumber', product.get('url_part_number')),
                'url_part_number': product.get('url_part_number'),
                'brand': klaviyo_data.get('brand', product.get('brand')),
                'model': klaviyo_data.get('model', ''),
                'model_other': klaviyo_data.get('modelOther', ''),
                'size': klaviyo_data.get('size', ''),
                'title': title,
                'handle': handle,
                'map_price': float(map_price) if map_price else 0,
                'quantity': int(product.get('quantity', 0)),
                # Convert numeric values to strings for Shopify metafields
                'diameter': str(klaviyo_data.get('wheelsize', '')) if klaviyo_data.get('wheelsize') else '',
                'width': str(klaviyo_data.get('wheelwidth', '')) if klaviyo_data.get('wheelwidth') else '',
                'bolt_pattern': klaviyo_data.get('boltpattern', ''),
                'bolt_pattern2': klaviyo_data.get('boltpattern2', ''),
                'offset': klaviyo_data.get('offset', ''),
                'backspace': klaviyo_data.get('backspace'),
                'finish': klaviyo_data.get('colorlong', ''),
                'short_color': klaviyo_data.get('colorshort', ''),
                'primary_color': klaviyo_data.get('color', ''),
                'hub_bore': klaviyo_data.get('hubbore', ''),
                'load_rating': klaviyo_data.get('loadrating'),
                'weight': klaviyo_data.get('weight'),
                'available_finishes': extracted_data.get('available_finishes'),
                'available_bolt_patterns': extracted_data.get('available_bolt_patterns'),
                'image': gcs_image_url,
                'custom_build': None,
            }

        else:  # tires
            # Generate title for tires
            title = f"{klaviyo_data.get('brand', '')} {klaviyo_data.get('model', '')} {klaviyo_data.get('size', '')}"
            title = title.strip()

            # Generate handle
            handle = f"{klaviyo_data.get('brand', '')}-{klaviyo_data.get('model', '')}-{klaviyo_data.get('size', '')}-{klaviyo_data.get('inventoryNumber', '')}"
            handle = handle.replace(' ', '-').replace('/', '-').lower()

            # Format tire_data
            tire_data = {
                'part_number': klaviyo_data.get('inventoryNumber', product.get('url_part_number')),
                'url_part_number': product.get('url_part_number'),
                'brand': klaviyo_data.get('brand', product.get('brand')),
                'model': klaviyo_data.get('model', ''),
                'size': klaviyo_data.get('size', ''),
                'title': title,
                'handle': handle,
                'map_price': float(map_price) if map_price else 0,
                'quantity': int(product.get('quantity', 0)),
                'weight': klaviyo_data.get('weight'),
                # Use first image for Shopify (tires table stores 3, but Shopify gets 1)
                'image': gcs_image_urls[0] if gcs_image_urls else None,
            }

        # If skip_shopify_creation is True, just save to database and mark as 'pending'
        if skip_shopify_creation:
            # Set status to 'pending' so the product creation job can pick it up later
            await update_product_sync_status(
                db_pool,
                product.get('url_part_number'),
                'pending'
            )

            # Get part number based on mode
            part_number = wheel_data['part_number'] if MODE == 'wheels' else tire_data['part_number']
            logger.info(f"✅ Saved {part_number} to database (pending Shopify creation)")
            return True

        # Otherwise, create on Shopify
        if MODE == 'wheels':
            shopify_result, shopify_error = await create_product_on_shopify(session, wheel_data, gcs_image_url)
        else:  # tires
            shopify_result, shopify_error = await create_product_on_shopify(session, tire_data, tire_data.get('image'))

        # Get retry count from product (0 for new products, >0 for retries)
        retry_count = product.get('retry_count', 0)

        if shopify_result:
            # Success! Update status and insert into shopify_products
            await update_product_sync_status(
                db_pool,
                product.get('url_part_number'),
                'synced'
            )

            await insert_into_shopify_products(db_pool, product, shopify_result, klaviyo_data, map_price)

            # Get part number based on mode
            part_number = wheel_data['part_number'] if MODE == 'wheels' else tire_data['part_number']
            logger.info(f"✅ Successfully created {part_number} on Shopify")
            return True
        else:
            # Failed to create on Shopify - increment retry count
            new_retry_count = retry_count + 1
            # Use actual Shopify error if available, otherwise generic message
            error_message = shopify_error if shopify_error else 'Failed to create on Shopify (no error details)'
            await update_product_sync_status(
                db_pool,
                product.get('url_part_number'),
                'error',
                error_message,
                retry_count=new_retry_count
            )
            logger.warning(f"❌ Failed to create product (attempt {new_retry_count}): {product.get('url_part_number')}")
            logger.warning(f"   Error: {error_message}")
            return False

    except Exception as e:
        logger.error(f"Exception creating product: {e}")
        import traceback
        logger.error(traceback.format_exc())

        # Update status to error - increment retry count
        retry_count = product.get('retry_count', 0)
        new_retry_count = retry_count + 1
        await update_product_sync_status(
            db_pool,
            product.get('url_part_number'),
            'error',
            str(e),
            retry_count=new_retry_count
        )
        return False


async def batch_insert_products_optimized(db_pool, products: List[Dict], stats: Dict):
    """
    Optimized batch insert for products when skip_shopify_creation=True.
    Uses multi-row INSERT which is 10-50x faster than individual inserts.

    Returns:
        (successful, failed) counts
    """
    logger.info(f"Starting optimized batch insert for {len(products)} products...")

    successful = 0
    failed = 0

    try:
        # Prepare all product data
        table_name = MODE
        all_data = []

        for product in products:
            extracted_data = product.get('extracted_data')
            if not extracted_data:
                logger.error(f"No extracted data for product: {product.get('url_part_number')}")
                failed += 1
                continue

            klaviyo_data = extracted_data.get('klaviyo_data', {})

            # Check if discontinued
            status = klaviyo_data.get('status', '').lower()
            if status == 'discontinued':
                failed += 1
                continue

            images = extracted_data.get('images', [])
            html = extracted_data.get('html', '')

            # Get map_price
            map_price = product.get('map_price')
            if not map_price and html:
                map_price = extract_map_price_from_html(html)
            if not map_price:
                map_price = 0

            # Map data to table schema
            if MODE == 'wheels':
                # For wheels, use first image
                gcs_image = images[0] if images else None
                mapped_data = map_klaviyo_to_wheels_table(klaviyo_data, product, gcs_image, map_price)
            else:  # tires
                # For tires, use up to 3 images
                gcs_images = images[:3] if images else []
                mapped_data = map_klaviyo_to_tires_table(klaviyo_data, product, gcs_images, map_price)

            all_data.append(mapped_data)

        if not all_data:
            logger.warning("No valid products to insert")
            return 0, len(products)

        # Split into chunks to avoid memory issues and transaction timeouts
        CHUNK_SIZE = 100  # Insert 100 products per batch
        total_inserted = 0
        total_chunks = (len(all_data) + CHUNK_SIZE - 1) // CHUNK_SIZE

        logger.info(f"Splitting {len(all_data)} products into {total_chunks} chunks of {CHUNK_SIZE}")

        # Get column structure from first product
        columns = list(all_data[0].keys())
        column_str = ', '.join(columns)
        placeholders = ', '.join(['%s'] * len(columns))

        query = f"""
        INSERT INTO {table_name} ({column_str})
        VALUES ({placeholders})
        """

        # Process in chunks
        for chunk_idx in range(0, len(all_data), CHUNK_SIZE):
            chunk = all_data[chunk_idx:chunk_idx + CHUNK_SIZE]
            chunk_num = (chunk_idx // CHUNK_SIZE) + 1

            # Prepare values as list of tuples
            values_list = [tuple(data[col] for col in columns) for data in chunk]

            async with db_pool.acquire() as conn:
                async with conn.cursor() as cur:
                    # Use executemany for batch insert
                    await cur.executemany(query, values_list)
                    await conn.commit()

                    chunk_inserted = len(values_list)
                    total_inserted += chunk_inserted
                    logger.info(f"✅ Chunk {chunk_num}/{total_chunks}: Inserted {chunk_inserted} products ({total_inserted}/{len(all_data)} total)")

                    # Batch update product_sync status to 'pending' for this chunk
                    url_parts = [data.get('url_part_number') for data in chunk]
                    if url_parts:
                        placeholders_update = ','.join(['%s'] * len(url_parts))
                        update_query = f"""
                        UPDATE {table_name}
                        SET product_sync = 'pending', sync_error = NULL
                        WHERE url_part_number IN ({placeholders_update})
                        """
                        await cur.execute(update_query, url_parts)
                        await conn.commit()

        logger.info(f"✅ Batch insert complete: {total_inserted} products saved to {table_name} table")
        successful = total_inserted
        stats['products_created_wheels_table'] += successful
        return successful, failed

    except Exception as e:
        logger.error(f"Error in batch insert: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return successful, len(products) - successful


async def create_products_batch(session: aiohttp.ClientSession, gcs_manager, db_pool, products: List[Dict], stats: Dict, skip_shopify_creation: bool = False):
    """
    Create a batch of products.

    Args:
        session: aiohttp session
        gcs_manager: GCSManager instance
        db_pool: Database pool
        products: List of products with extracted data
        stats: Stats dict to update
        skip_shopify_creation: If True, only save to database without creating on Shopify
    """
    if skip_shopify_creation:
        logger.info(f"Saving {len(products)} products to database (Shopify creation skipped)...")
        # Use optimized batch insert for database-only saves
        successful, failed = await batch_insert_products_optimized(db_pool, products, stats)
        logger.info(f"Batch complete: {successful} successful, {failed} failed")
        return successful, failed
    else:
        logger.info(f"Creating {len(products)} products...")

    successful = 0
    failed = 0

    for product in products:
        success = await create_single_product(session, gcs_manager, db_pool, product, skip_shopify_creation=skip_shopify_creation)

        if success:
            successful += 1
        else:
            failed += 1

    logger.info(f"Batch complete: {successful} successful, {failed} failed")

    # Update stats
    stats['products_created_wheels_table'] += successful
    if not skip_shopify_creation:
        stats['products_created_shopify'] += successful
        stats['failed_shopify_creations'] += failed

    return successful, failed
