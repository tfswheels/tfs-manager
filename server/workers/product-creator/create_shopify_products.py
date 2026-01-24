#!/usr/bin/env python3
"""
Shopify Product Creation Worker

Creates products on Shopify from the wheels/tires database tables.
Enforces shared 1000/day limit with 70/30 wheels/tires split, oldest first.

Usage:
    python create_shopify_products.py --job-id=123 [--max-products=1000]
"""

import asyncio
import sys
import os
import argparse
import aiomysql
import aiohttp
from datetime import datetime, date

# Import from local directory
from shopify_create_product import create_product_on_shopify
from config import logger, SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, PLACEHOLDER_IMAGE, DB_CONFIG

# =============================================================================
# CONFIGURATION
# =============================================================================

DEFAULT_MAX_PRODUCTS = 1000
WHEELS_RATIO = 0.70  # 70% wheels
TIRES_RATIO = 0.30   # 30% tires

# TESTING: Limit to 1 product for testing
TESTING_MODE = True
TESTING_LIMIT = 1

# =============================================================================
# DATABASE HELPERS
# =============================================================================

async def get_daily_limit_info(db_pool):
    """Get current daily limit status."""
    try:
        query = """
        SELECT total_created, wheels_created, tires_created, limit_per_day
        FROM daily_shopify_creation_limit
        WHERE date = CURDATE()
        """

        async with db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(query)
                result = await cur.fetchone()

                if not result:
                    # Create today's entry
                    insert_query = """
                    INSERT INTO daily_shopify_creation_limit
                    (date, total_created, wheels_created, tires_created)
                    VALUES (CURDATE(), 0, 0, 0)
                    """
                    await cur.execute(insert_query)
                    await conn.commit()
                    return {
                        'total_created': 0,
                        'wheels_created': 0,
                        'tires_created': 0,
                        'limit_per_day': 1000
                    }

                return result

    except Exception as e:
        logger.error(f"Error getting daily limit info: {e}")
        return None


async def increment_daily_limit(db_pool, product_type):
    """Increment the shared daily limit counter."""
    try:
        type_field = f"{product_type}s_created"  # 'wheel' -> 'wheels_created'

        query = f"""
        INSERT INTO daily_shopify_creation_limit
        (date, total_created, {type_field})
        VALUES (CURDATE(), 1, 1)
        ON DUPLICATE KEY UPDATE
            total_created = total_created + 1,
            {type_field} = {type_field} + 1
        """

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query)
                await conn.commit()

    except Exception as e:
        logger.error(f"Error incrementing daily limit: {e}")


async def query_products_needing_creation(db_pool_inventory, table_name, limit):
    """
    Query products that need to be created on Shopify.
    Returns newest modified products first (most recently updated).
    Uses db_pool_inventory which connects to tfs-db database.

    Queries from 'wheels' and 'tires' tables (not all_shopify_wheels/shopify_tires).
    """
    try:
        # Query products where product_sync = 'pending' or 'error' (need Shopify creation)
        # Order by last_modified DESC (newest first - as per original script)
        query = f"""
        SELECT *
        FROM {table_name}
        WHERE product_sync IN ('pending', 'error')
          AND url_part_number IS NOT NULL
          AND url_part_number != ''
        ORDER BY last_modified DESC
        LIMIT %s
        """

        async with db_pool_inventory.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(query, (limit,))
                results = await cur.fetchall()
                return results

    except Exception as e:
        logger.error(f"Error querying products from {table_name}: {e}")
        return []


async def update_product_sync_status(db_pool_inventory, table_name, url_part_number, status, error_message=None):
    """
    Update product_sync status in wheels/tires table.
    Uses db_pool_inventory which connects to tfs-db database.

    Args:
        table_name: 'wheels' or 'tires'
        url_part_number: Product URL part number
        status: 'synced', 'pending', or 'error'
        error_message: Error message (if status = 'error')
    """
    try:
        if error_message:
            # Error - mark as error with message
            query = f"""
            UPDATE {table_name}
            SET product_sync = %s,
                sync_error = %s
            WHERE url_part_number = %s
            """
            params = (status, error_message, url_part_number)
        else:
            # Success or pending - update status
            query = f"""
            UPDATE {table_name}
            SET product_sync = %s,
                sync_error = NULL
            WHERE url_part_number = %s
            """
            params = (status, url_part_number)

        async with db_pool_inventory.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                await conn.commit()

    except Exception as e:
        logger.error(f"Error updating product_sync status: {e}")


async def insert_into_shopify_products(db_pool_inventory, product_data, shopify_result, product_type):
    """
    Insert product into shopify_products table (tracking table).
    Uses db_pool_inventory which connects to tfs-db database.

    Args:
        product_data: Formatted wheel/tire data dict
        shopify_result: Result from create_product_on_shopify()
        product_type: 'wheel' or 'tire'
    """
    try:
        query = """
        INSERT INTO shopify_products
        (brand, part_number, url_part_number, product_type, shopify_id, variant_id, handle,
         map_price, quantity, sdw_cost, needs_sync, sync_status, source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """

        # Extract numeric Shopify ID from gid://shopify/Product/123456
        shopify_id = shopify_result.get('shopify_id')
        if isinstance(shopify_id, str) and shopify_id.startswith('gid://shopify/Product/'):
            shopify_id = int(shopify_id.split('/')[-1])

        values = (
            product_data.get('brand'),
            product_data.get('part_number'),
            product_data.get('url_part_number'),
            product_type,  # 'wheel' or 'tire'
            shopify_id,
            shopify_result.get('variant_id'),
            shopify_result.get('handle'),
            float(product_data.get('map_price', 0)),
            int(product_data.get('quantity', 0)),
            None,  # sdw_cost (we don't have supplier_cost in our data)
            0,  # needs_sync
            'active',  # sync_status
            'CWO'  # source
        )

        async with db_pool_inventory.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, values)
                await conn.commit()

        logger.info(f"✅ Inserted into shopify_products: {product_data.get('part_number')}")

    except Exception as e:
        logger.error(f"Error inserting into shopify_products: {e}")
        import traceback
        logger.error(traceback.format_exc())


async def update_job_status(db_pool, job_id, status, products_created=None, wheels_created=None, tires_created=None, error_message=None, products_skipped=None, products_failed=None):
    """Update the product_creation_jobs status."""
    try:
        if status == 'running':
            query = """
            UPDATE product_creation_jobs
            SET status = %s,
                started_at = NOW(),
                updated_at = NOW()
            WHERE id = %s
            """
            params = (status, job_id)
        elif status == 'in_progress':
            # Update in-progress stats without marking as completed
            query = """
            UPDATE product_creation_jobs
            SET products_created = %s,
                wheels_created = %s,
                tires_created = %s,
                products_skipped = COALESCE(%s, products_skipped),
                products_failed = COALESCE(%s, products_failed),
                updated_at = NOW()
            WHERE id = %s
            """
            params = (products_created, wheels_created, tires_created, products_skipped, products_failed, job_id)
        elif status == 'completed':
            query = """
            UPDATE product_creation_jobs
            SET status = %s,
                completed_at = NOW(),
                products_created = %s,
                wheels_created = %s,
                tires_created = %s,
                products_skipped = %s,
                products_failed = %s,
                updated_at = NOW()
            WHERE id = %s
            """
            params = (status, products_created, wheels_created, tires_created, products_skipped, products_failed, job_id)
        elif status == 'failed':
            query = """
            UPDATE product_creation_jobs
            SET status = %s,
                completed_at = NOW(),
                error_message = %s,
                updated_at = NOW()
            WHERE id = %s
            """
            params = (status, error_message, job_id)
        else:
            return

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, params)
                await conn.commit()

    except Exception as e:
        logger.error(f"Error updating job status: {e}")


# =============================================================================
# PRODUCT CREATION LOGIC
# =============================================================================

# =============================================================================
# DATA FORMATTING FUNCTIONS
# =============================================================================

def format_offset(offset):
    """Format offset with + sign if positive and append 'mm', e.g. +35mm."""
    if not offset:
        return ""
    try:
        val = float(offset)
        if val >= 0:
            return f"+{int(val)}mm"
        else:
            return f"{int(val)}mm"
    except (ValueError, TypeError):
        return str(offset)


def format_wheel_data(product_row):
    """
    Format wheel database row into structure expected by create_product_on_shopify().

    Args:
        product_row: Dict from wheels table

    Returns:
        Dict with formatted wheel data for Shopify creation
    """
    # Generate title
    title = f"{product_row.get('brand', '')} {product_row.get('model', '')}"
    if product_row.get('model_other'):
        title += f" {product_row['model_other']}"
    title += f" {product_row.get('size', '')}"
    if product_row.get('offset'):
        title += f" {format_offset(product_row['offset'])}"
    title += f" {product_row.get('finish', '')}"
    title = title.strip()

    # Generate handle (URL-friendly)
    handle = f"{product_row.get('brand', '')}-{product_row.get('model', '')}-{product_row.get('size', '')}-{product_row.get('offset', '')}-{product_row.get('short_color', '')}-{product_row.get('part_number', '')}"
    handle = handle.replace(' ', '-').replace('/', '-').lower()

    # Get image URL (use placeholder if none)
    image_url = product_row.get('image') or PLACEHOLDER_IMAGE

    # Format wheel data with all metafields
    wheel_data = {
        'part_number': product_row.get('part_number', product_row.get('url_part_number')),
        'url_part_number': product_row.get('url_part_number'),
        'brand': product_row.get('brand', ''),
        'model': product_row.get('model', ''),
        'model_other': product_row.get('model_other', ''),
        'size': product_row.get('size', ''),
        'title': title,
        'handle': handle,
        'map_price': float(product_row.get('map_price')) if product_row.get('map_price') else 0,
        'quantity': int(product_row.get('quantity', 0)),
        # Convert numeric values to strings for Shopify metafields
        'diameter': str(product_row.get('diameter', '')) if product_row.get('diameter') else '',
        'width': str(product_row.get('width', '')) if product_row.get('width') else '',
        'bolt_pattern': product_row.get('bolt_pattern', ''),
        'bolt_pattern2': product_row.get('bolt_pattern2', ''),
        'offset': product_row.get('offset', ''),
        'backspace': product_row.get('backspace'),
        'finish': product_row.get('finish', ''),
        'short_color': product_row.get('short_color', ''),
        'primary_color': product_row.get('primary_color', ''),
        'hub_bore': product_row.get('hub_bore', ''),
        'load_rating': product_row.get('load_rating'),
        'weight': product_row.get('weight'),
        'available_finishes': product_row.get('available_finishes') or '',
        'available_bolt_patterns': product_row.get('available_bolt_patterns') or '',
        'image': image_url,
        'custom_build': product_row.get('custom_build'),
    }

    return wheel_data


def format_tire_data(product_row):
    """
    Format tire database row into structure expected by create_product_on_shopify().

    Args:
        product_row: Dict from tires table

    Returns:
        Dict with formatted tire data for Shopify creation
    """
    # Generate title
    title = f"{product_row.get('brand', '')} {product_row.get('model', '')} {product_row.get('size', '')}"
    title = title.strip()

    # Generate handle (URL-friendly)
    handle = f"{product_row.get('brand', '')}-{product_row.get('model', '')}-{product_row.get('size', '')}-{product_row.get('part_number', '')}"
    handle = handle.replace(' ', '-').replace('/', '-').lower()

    # Get first image URL (tires have image1, image2, image3)
    image_url = product_row.get('image1') or product_row.get('image2') or product_row.get('image3') or PLACEHOLDER_IMAGE

    # Format tire data (tires have fewer metafields than wheels)
    tire_data = {
        'part_number': product_row.get('part_number', product_row.get('url_part_number')),
        'url_part_number': product_row.get('url_part_number'),
        'brand': product_row.get('brand', ''),
        'model': product_row.get('model', ''),
        'size': product_row.get('size', ''),
        'title': title,
        'handle': handle,
        'map_price': float(product_row.get('map_price')) if product_row.get('map_price') else 0,
        'quantity': int(product_row.get('quantity', 0)),
        'weight': product_row.get('weight'),
        'image': image_url,
    }

    return tire_data


# =============================================================================
# MAIN PRODUCT CREATION FUNCTION
# =============================================================================

async def sync_shopify_data():
    """
    Run the Shopify data sync scripts to update all_shopify_wheels and shopify_tires tables.

    This ensures we have the latest Shopify data before checking for duplicates.
    Streams logs in real-time to show chunk progress.
    """
    import subprocess
    import os

    logger.info("=" * 80)
    logger.info("SYNCING SHOPIFY DATA")
    logger.info("=" * 80)

    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sync_scripts_dir = os.path.join(script_dir, 'sync_scripts')

    scripts = [
        {
            'name': 'Wheels',
            'path': os.path.join(sync_scripts_dir, 'get_non_sdw_wheels.py')
        },
        {
            'name': 'Tires',
            'path': os.path.join(sync_scripts_dir, 'get_shopify_tires.py')
        }
    ]

    for script in scripts:
        logger.info(f"\n🔄 Starting {script['name']} sync...")

        try:
            # Use Popen to stream output in real-time
            process = subprocess.Popen(
                ['python3', script['path']],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,  # Merge stderr into stdout
                text=True,
                bufsize=1,  # Line buffered
                cwd=sync_scripts_dir
            )

            # Stream output line by line
            for line in process.stdout:
                line = line.rstrip()
                if line:  # Only log non-empty lines
                    logger.info(f"[{script['name']}] {line}")

            # Wait for process to complete
            process.wait(timeout=600)  # 10 minute timeout

            if process.returncode == 0:
                logger.info(f"✅ {script['name']} sync completed successfully")
            else:
                logger.error(f"❌ {script['name']} sync failed with exit code {process.returncode}")
                raise Exception(f"{script['name']} sync failed")

        except subprocess.TimeoutExpired:
            logger.error(f"❌ {script['name']} sync timed out after 10 minutes")
            process.kill()
            raise Exception(f"{script['name']} sync timed out")
        except Exception as e:
            logger.error(f"❌ Error running {script['name']} sync: {e}")
            raise

    logger.info("✅ All Shopify data synced")
    logger.info("=" * 80)


async def check_product_exists_on_shopify(db_pool_inventory, product_type, part_number):
    """
    Check if a product already exists on Shopify by checking the synced Shopify tables.

    Args:
        db_pool_inventory: Connection pool to tfs-db database
        product_type: 'wheel' or 'tire'
        part_number: Product part number to check

    Returns:
        tuple: (exists: bool, table_name: str or None)
    """
    try:
        if product_type == 'wheel':
            table_name = 'all_shopify_wheels'
        else:  # tire
            table_name = 'shopify_tires'

        query = f"""
        SELECT shopify_id
        FROM {table_name}
        WHERE part_number = %s
        LIMIT 1
        """

        async with db_pool_inventory.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, (part_number,))
                result = await cur.fetchone()

                if result:
                    return True, table_name
                return False, None

    except Exception as e:
        logger.error(f"Error checking if product exists on Shopify: {e}")
        return False, None


async def create_products_on_shopify(db_pool_manager, db_pool_inventory, job_id, max_products):
    """
    Main product creation workflow.

    1. Sync Shopify data (update all_shopify_wheels and shopify_tires tables)
    2. Check daily limit (from tfs-manager)
    3. Query products from wheels and tires tables (from tfs-db)
    4. Apply 70/30 split
    5. Check for duplicates against Shopify tables
    6. Create on Shopify (oldest first)
    7. Update database (both databases)

    Args:
        db_pool_manager: Connection pool to tfs-manager database (for job status, daily limits)
        db_pool_inventory: Connection pool to tfs-db database (for product tables)
    """

    logger.info("=" * 80)
    logger.info("SHOPIFY PRODUCT CREATION WORKER")
    logger.info("=" * 80)
    logger.info(f"Job ID: {job_id}")
    logger.info(f"Max Products: {max_products}")
    logger.info(f"Split Ratio: {int(WHEELS_RATIO * 100)}% wheels, {int(TIRES_RATIO * 100)}% tires")
    logger.info("Priority: Oldest first")
    logger.info("=" * 80)

    # Update job status to running
    await update_job_status(db_pool_manager, job_id, 'running')

    # ================================================================
    # STEP 0: Sync Shopify Data
    # ================================================================
    logger.info("")
    logger.info("STEP 0: Syncing Shopify data...")

    try:
        await sync_shopify_data()
    except Exception as e:
        logger.error(f"Failed to sync Shopify data: {e}")
        await update_job_status(db_pool_manager, job_id, 'failed', error_message=f"Shopify data sync failed: {str(e)}")
        return

    stats = {
        'wheels_created': 0,
        'tires_created': 0,
        'total_created': 0,
        'wheels_failed': 0,
        'tires_failed': 0,
        'total_failed': 0,
        'wheels_skipped': 0,
        'tires_skipped': 0,
        'total_skipped': 0
    }

    try:
        # ================================================================
        # STEP 1: Check Daily Limit
        # ================================================================
        logger.info("")
        logger.info("STEP 1: Checking daily limit...")

        limit_info = await get_daily_limit_info(db_pool_manager)
        if not limit_info:
            raise Exception("Failed to get daily limit info")

        remaining = limit_info['limit_per_day'] - limit_info['total_created']

        logger.info(f"  Daily Limit: {limit_info['limit_per_day']}")
        logger.info(f"  Already Created Today: {limit_info['total_created']} " +
                   f"({limit_info['wheels_created']} wheels, {limit_info['tires_created']} tires)")
        logger.info(f"  Remaining: {remaining}")

        if remaining <= 0:
            logger.warning("Daily limit reached! No products will be created.")
            await update_job_status(db_pool_manager, job_id, 'completed', 0, 0, 0)
            return

        # Limit to remaining daily capacity
        to_create = min(max_products, remaining)

        # TESTING MODE: Override to create only N successful products
        testing_limit = TESTING_LIMIT if TESTING_MODE else to_create
        if TESTING_MODE:
            logger.warning(f"🧪 TESTING MODE: Will create until {TESTING_LIMIT} successful product(s)")

        logger.info(f"  Target: {to_create} products (testing: {testing_limit} successes)" if TESTING_MODE else f"  Will create: {to_create} products")

        # ================================================================
        # STEP 2: Calculate Split
        # ================================================================
        logger.info("")
        logger.info("STEP 2: Calculating 70/30 split...")

        wheels_target = int(to_create * WHEELS_RATIO)
        tires_target = int(to_create * TIRES_RATIO)

        # Handle rounding (ensure we hit exactly to_create)
        if wheels_target + tires_target < to_create:
            wheels_target += 1

        logger.info(f"  Wheels target: {wheels_target}")
        logger.info(f"  Tires target: {tires_target}")

        # ================================================================
        # STEP 3: Query Products
        # ================================================================
        logger.info("")
        logger.info("STEP 3: Querying products needing creation...")

        # Query more than we need in case some fail
        # Use db_pool_inventory for tfs-db database
        # Query from 'wheels' and 'tires' tables (not all_shopify_wheels/shopify_tires)
        wheels_products = await query_products_needing_creation(
            db_pool_inventory, 'wheels', wheels_target + 50
        )
        tires_products = await query_products_needing_creation(
            db_pool_inventory, 'tires', tires_target + 50
        )

        logger.info(f"  Found {len(wheels_products)} wheels needing creation")
        logger.info(f"  Found {len(tires_products)} tires needing creation")

        # Adjust targets if we don't have enough products
        wheels_target = min(wheels_target, len(wheels_products))
        tires_target = min(tires_target, len(tires_products))

        logger.info(f"  Adjusted targets: {wheels_target} wheels, {tires_target} tires")

        # ================================================================
        # STEP 4: Create Products on Shopify
        # ================================================================
        logger.info("")
        logger.info("STEP 4: Creating products on Shopify...")
        logger.info("")

        # Create aiohttp session for Shopify API calls
        async with aiohttp.ClientSession() as session:
            # Create wheels
            if wheels_target > 0:
                logger.info(f"Creating wheels (target: {wheels_target})...")

                # In testing mode, keep trying until we get enough successes
                wheels_to_try = wheels_products[:wheels_target + 50] if TESTING_MODE else wheels_products[:wheels_target]
                product_index = 0

                for i, product in enumerate(wheels_to_try, 1):
                    # Stop if we've reached our success target in testing mode
                    if TESTING_MODE and stats['wheels_created'] >= testing_limit:
                        logger.info(f"✅ Reached testing limit of {testing_limit} successful creations")
                        break

                    # Stop if we've reached our target in normal mode
                    if not TESTING_MODE and product_index >= wheels_target:
                        break

                    product_index += 1
                    try:
                        # Format wheel data
                        wheel_data = format_wheel_data(product)

                        logger.info(f"  [{i}/{wheels_target}] Creating wheel: {wheel_data.get('title', 'Unknown')}")

                        # Check if product already exists on Shopify
                        exists, table_name = await check_product_exists_on_shopify(
                            db_pool_inventory, 'wheel', wheel_data.get('part_number')
                        )

                        if exists:
                            # Product already exists on Shopify - skip and mark as skipped
                            await update_product_sync_status(
                                db_pool_inventory, 'wheels', product['url_part_number'],
                                status='skipped', error_message=f'Product already exists in {table_name}'
                            )
                            stats['wheels_skipped'] += 1
                            stats['total_skipped'] += 1
                            logger.info(f"  ⏭️  Skipped: Product already exists in {table_name}")
                            continue

                        # Create on Shopify
                        shopify_result, shopify_error = await create_product_on_shopify(session, wheel_data, wheel_data.get('image'))

                        if shopify_result and shopify_result.get('shopify_id'):
                            shopify_product_id = shopify_result['shopify_id']

                            # Update wheels table - mark as synced (no shopify_id in wheels table)
                            await update_product_sync_status(
                                db_pool_inventory, 'wheels', product['url_part_number'],
                                status='synced'
                            )

                            # Insert into shopify_products tracking table (this has the shopify_id)
                            await insert_into_shopify_products(
                                db_pool_inventory, wheel_data, shopify_result, 'wheel'
                            )

                            # Increment daily limit (tfs-manager)
                            await increment_daily_limit(db_pool_manager, 'wheel')

                            stats['wheels_created'] += 1
                            stats['total_created'] += 1

                            logger.info(f"  ✅ Created wheel with Shopify ID: {shopify_product_id}")

                            # Update in-progress stats every 10 products
                            if (stats['total_created'] + stats['total_failed'] + stats['total_skipped']) % 10 == 0:
                                await update_job_status(
                                    db_pool_manager, job_id, 'in_progress',
                                    stats['total_created'],
                                    stats['wheels_created'],
                                    stats['tires_created'],
                                    products_skipped=stats['total_skipped'],
                                    products_failed=stats['total_failed']
                                )
                        else:
                            # Mark as error with exact Shopify error message
                            error_msg = shopify_error if shopify_error else 'Failed to create on Shopify (no error details)'
                            await update_product_sync_status(
                                db_pool_inventory, 'wheels', product['url_part_number'],
                                status='error', error_message=error_msg
                            )

                            stats['wheels_failed'] += 1
                            stats['total_failed'] += 1
                            logger.warning(f"  ❌ Failed to create wheel: {error_msg}")

                    except Exception as e:
                        # Use exact exception message
                        await update_product_sync_status(
                            db_pool_inventory, 'wheels', product['url_part_number'],
                            status='error', error_message=str(e)
                        )
                        stats['wheels_failed'] += 1
                        stats['total_failed'] += 1
                        logger.error(f"  ❌ Error creating wheel: {e}")

            # Create tires
            if tires_target > 0:
                logger.info("")
                logger.info(f"Creating tires (target: {tires_target})...")

                # In testing mode, keep trying until we get enough successes
                tires_to_try = tires_products[:tires_target + 50] if TESTING_MODE else tires_products[:tires_target]
                product_index = 0

                for i, product in enumerate(tires_to_try, 1):
                    # Stop if we've reached our success target in testing mode
                    if TESTING_MODE and stats['tires_created'] >= testing_limit:
                        logger.info(f"✅ Reached testing limit successful creations")
                        break

                    # Stop if we've reached our target in normal mode
                    if not TESTING_MODE and product_index >= tires_target:
                        break

                    product_index += 1
                    try:
                        # Format tire data
                        tire_data = format_tire_data(product)

                        logger.info(f"  [{i}/{tires_target}] Creating tire: {tire_data.get('title', 'Unknown')}")

                        # Check if product already exists on Shopify
                        exists, table_name = await check_product_exists_on_shopify(
                            db_pool_inventory, 'tire', tire_data.get('part_number')
                        )

                        if exists:
                            # Product already exists on Shopify - skip and mark as skipped
                            await update_product_sync_status(
                                db_pool_inventory, 'tires', product['url_part_number'],
                                status='skipped', error_message=f'Product already exists in {table_name}'
                            )
                            stats['tires_skipped'] += 1
                            stats['total_skipped'] += 1
                            logger.info(f"  ⏭️  Skipped: Product already exists in {table_name}")
                            continue

                        # Create on Shopify
                        shopify_result, shopify_error = await create_product_on_shopify(session, tire_data, tire_data.get('image'))

                        if shopify_result and shopify_result.get('shopify_id'):
                            shopify_product_id = shopify_result['shopify_id']

                            # Update tires table - mark as synced (no shopify_id in tires table)
                            await update_product_sync_status(
                                db_pool_inventory, 'tires', product['url_part_number'],
                                status='synced'
                            )

                            # Insert into shopify_products tracking table (this has the shopify_id)
                            await insert_into_shopify_products(
                                db_pool_inventory, tire_data, shopify_result, 'tire'
                            )

                            # Increment daily limit (tfs-manager)
                            await increment_daily_limit(db_pool_manager, 'tire')

                            stats['tires_created'] += 1
                            stats['total_created'] += 1

                            logger.info(f"  ✅ Created tire with Shopify ID: {shopify_product_id}")

                            # Update in-progress stats every 10 products
                            if (stats['total_created'] + stats['total_failed'] + stats['total_skipped']) % 10 == 0:
                                await update_job_status(
                                    db_pool_manager, job_id, 'in_progress',
                                    stats['total_created'],
                                    stats['wheels_created'],
                                    stats['tires_created'],
                                    products_skipped=stats['total_skipped'],
                                    products_failed=stats['total_failed']
                                )
                        else:
                            # Mark as error with exact Shopify error message
                            error_msg = shopify_error if shopify_error else 'Failed to create on Shopify (no error details)'
                            await update_product_sync_status(
                                db_pool_inventory, 'tires', product['url_part_number'],
                                status='error', error_message=error_msg
                            )

                            stats['tires_failed'] += 1
                            stats['total_failed'] += 1
                            logger.warning(f"  ❌ Failed to create tire: {error_msg}")

                    except Exception as e:
                        # Use exact exception message
                        await update_product_sync_status(
                            db_pool_inventory, 'tires', product['url_part_number'],
                            status='error', error_message=str(e)
                        )
                        stats['tires_failed'] += 1
                        stats['total_failed'] += 1
                        logger.error(f"  ❌ Error creating tire: {e}")

        # ================================================================
        # FINAL SUMMARY
        # ================================================================
        logger.info("")
        logger.info("=" * 80)
        logger.info("PRODUCT CREATION COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Total Created: {stats['total_created']}")
        logger.info(f"  Wheels: {stats['wheels_created']}")
        logger.info(f"  Tires: {stats['tires_created']}")
        logger.info(f"Total Skipped: {stats['total_skipped']}")
        logger.info(f"  Wheels: {stats['wheels_skipped']}")
        logger.info(f"  Tires: {stats['tires_skipped']}")
        logger.info(f"Total Failed: {stats['total_failed']}")
        logger.info(f"  Wheels: {stats['wheels_failed']}")
        logger.info(f"  Tires: {stats['tires_failed']}")
        logger.info("=" * 80)

        # Update job status to completed
        await update_job_status(
            db_pool_manager, job_id, 'completed',
            stats['total_created'],
            stats['wheels_created'],
            stats['tires_created'],
            products_skipped=stats['total_skipped'],
            products_failed=stats['total_failed']
        )

    except Exception as e:
        logger.error(f"Fatal error in product creation: {e}")
        import traceback
        logger.error(traceback.format_exc())

        await update_job_status(db_pool_manager, job_id, 'failed', error_message=str(e))
        raise


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

async def main():
    """Main entry point."""

    parser = argparse.ArgumentParser(description='Create products on Shopify from database')
    parser.add_argument('--job-id', type=int, required=True, help='Product creation job ID')
    parser.add_argument('--max-products', type=int, default=DEFAULT_MAX_PRODUCTS, help='Max products to create')

    args = parser.parse_args()

    logger.info(f"Starting job #{args.job_id}, max_products={args.max_products}")

    # Create TWO database connection pools
    db_pool_manager = None
    db_pool_inventory = None

    try:
        # Pool 1: tfs-manager database (for job status, daily limits)
        manager_config = DB_CONFIG.copy()
        manager_config['db'] = os.getenv('DB_NAME', 'tfs-manager')

        db_pool_manager = await aiomysql.create_pool(
            host=manager_config['host'],
            port=manager_config['port'],
            user=manager_config['user'],
            password=manager_config['password'],
            db=manager_config['db'],
            minsize=2,
            maxsize=10,
            autocommit=True
        )

        # Pool 2: tfs-db database (for product tables)
        inventory_config = DB_CONFIG.copy()
        inventory_config['db'] = 'tfs-db'

        db_pool_inventory = await aiomysql.create_pool(
            host=inventory_config['host'],
            port=inventory_config['port'],
            user=inventory_config['user'],
            password=inventory_config['password'],
            db=inventory_config['db'],
            minsize=2,
            maxsize=10,
            autocommit=True
        )

        logger.info("Database connections established")

        # Run product creation with both pools
        await create_products_on_shopify(db_pool_manager, db_pool_inventory, args.job_id, args.max_products)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        sys.exit(1)
    finally:
        if db_pool_manager:
            db_pool_manager.close()
            await db_pool_manager.wait_closed()
        if db_pool_inventory:
            db_pool_inventory.close()
            await db_pool_inventory.wait_closed()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        logger.error(f"Asyncio error: {e}")
        sys.exit(1)
