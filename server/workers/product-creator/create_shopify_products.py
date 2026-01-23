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
from datetime import datetime, date

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import from scrapers directory
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../scrapers'))

from scrapers.shopify_create_product import create_product_on_shopify
from scrapers.config import logger, SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, DB_CONFIG

# =============================================================================
# CONFIGURATION
# =============================================================================

DEFAULT_MAX_PRODUCTS = 1000
WHEELS_RATIO = 0.70  # 70% wheels
TIRES_RATIO = 0.30   # 30% tires

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
    Returns oldest products first (by id - since no created_at column).
    Uses db_pool_inventory which connects to tfs-db database.
    """
    try:
        # Query products where shopify_id IS NULL (not created on Shopify yet)
        # Order by id ASC (oldest first - id is auto-increment)
        query = f"""
        SELECT *
        FROM {table_name}
        WHERE shopify_id IS NULL
        ORDER BY id ASC
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


async def update_shopify_product_id(db_pool_inventory, table_name, product_id, shopify_product_id):
    """
    Update the product with its Shopify product ID.
    Uses db_pool_inventory which connects to tfs-db database.
    """
    try:
        # Update shopify_id column (not shopify_product_id)
        query = f"""
        UPDATE {table_name}
        SET shopify_id = %s,
            last_modified = NOW()
        WHERE id = %s
        """

        async with db_pool_inventory.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query, (shopify_product_id, product_id))
                await conn.commit()

    except Exception as e:
        logger.error(f"Error updating shopify_id: {e}")


async def update_job_status(db_pool, job_id, status, products_created=None, wheels_created=None, tires_created=None, error_message=None):
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
        elif status == 'completed':
            query = """
            UPDATE product_creation_jobs
            SET status = %s,
                completed_at = NOW(),
                products_created = %s,
                wheels_created = %s,
                tires_created = %s,
                updated_at = NOW()
            WHERE id = %s
            """
            params = (status, products_created, wheels_created, tires_created, job_id)
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

async def create_products_on_shopify(db_pool_manager, db_pool_inventory, job_id, max_products):
    """
    Main product creation workflow.

    1. Check daily limit (from tfs-manager)
    2. Query products from wheels and tires tables (from tfs-db)
    3. Apply 70/30 split
    4. Create on Shopify (oldest first)
    5. Update database (both databases)

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

    stats = {
        'wheels_created': 0,
        'tires_created': 0,
        'total_created': 0,
        'wheels_failed': 0,
        'tires_failed': 0,
        'total_failed': 0
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
        logger.info(f"  Will create: {to_create} products")

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
        wheels_products = await query_products_needing_creation(
            db_pool_inventory, 'all_shopify_wheels', wheels_target + 50
        )
        tires_products = await query_products_needing_creation(
            db_pool_inventory, 'shopify_tires', tires_target + 50
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

        # Create wheels
        if wheels_target > 0:
            logger.info(f"Creating {wheels_target} wheels...")
            for i, product in enumerate(wheels_products[:wheels_target], 1):
                try:
                    logger.info(f"  [{i}/{wheels_target}] Creating wheel: {product.get('title', 'Unknown')}")

                    # Create on Shopify
                    shopify_product_id = await create_product_on_shopify(product, 'wheel')

                    if shopify_product_id:
                        # Update database (tfs-db)
                        await update_shopify_product_id(
                            db_pool_inventory, 'all_shopify_wheels', product['id'], shopify_product_id
                        )

                        # Increment daily limit (tfs-manager)
                        await increment_daily_limit(db_pool_manager, 'wheel')

                        stats['wheels_created'] += 1
                        stats['total_created'] += 1

                        logger.info(f"  ✅ Created wheel with Shopify ID: {shopify_product_id}")
                    else:
                        stats['wheels_failed'] += 1
                        stats['total_failed'] += 1
                        logger.warning(f"  ❌ Failed to create wheel")

                except Exception as e:
                    stats['wheels_failed'] += 1
                    stats['total_failed'] += 1
                    logger.error(f"  ❌ Error creating wheel: {e}")

        # Create tires
        if tires_target > 0:
            logger.info("")
            logger.info(f"Creating {tires_target} tires...")
            for i, product in enumerate(tires_products[:tires_target], 1):
                try:
                    logger.info(f"  [{i}/{tires_target}] Creating tire: {product.get('title', 'Unknown')}")

                    # Create on Shopify
                    shopify_product_id = await create_product_on_shopify(product, 'tire')

                    if shopify_product_id:
                        # Update database (tfs-db)
                        await update_shopify_product_id(
                            db_pool_inventory, 'shopify_tires', product['id'], shopify_product_id
                        )

                        # Increment daily limit (tfs-manager)
                        await increment_daily_limit(db_pool_manager, 'tire')

                        stats['tires_created'] += 1
                        stats['total_created'] += 1

                        logger.info(f"  ✅ Created tire with Shopify ID: {shopify_product_id}")
                    else:
                        stats['tires_failed'] += 1
                        stats['total_failed'] += 1
                        logger.warning(f"  ❌ Failed to create tire")

                except Exception as e:
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
        logger.info(f"Total Failed: {stats['total_failed']}")
        logger.info(f"  Wheels: {stats['wheels_failed']}")
        logger.info(f"  Tires: {stats['tires_failed']}")
        logger.info("=" * 80)

        # Update job status to completed
        await update_job_status(
            db_pool_manager, job_id, 'completed',
            stats['total_created'],
            stats['wheels_created'],
            stats['tires_created']
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

    # Create TWO database connection pools
    db_pool_manager = None
    db_pool_inventory = None

    try:
        # Pool 1: tfs-manager database (for job status, daily limits)
        manager_config = DB_CONFIG.copy()
        manager_config['db'] = os.getenv('DB_NAME', 'tfs-manager')

        logger.info(f"Connecting to manager database: {manager_config['host']}/{manager_config['db']}")

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

        logger.info("✅ Manager database connected")

        # Pool 2: tfs-db database (for product tables)
        inventory_config = DB_CONFIG.copy()
        inventory_config['db'] = 'tfs-db'

        logger.info(f"Connecting to inventory database: {inventory_config['host']}/{inventory_config['db']}")

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

        logger.info("✅ Inventory database connected")

        # Run product creation with both pools
        await create_products_on_shopify(db_pool_manager, db_pool_inventory, args.job_id, args.max_products)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        sys.exit(1)
    finally:
        if db_pool_manager:
            db_pool_manager.close()
            await db_pool_manager.wait_closed()
            logger.info("Manager database connection closed")
        if db_pool_inventory:
            db_pool_inventory.close()
            await db_pool_inventory.wait_closed()
            logger.info("Inventory database connection closed")


if __name__ == "__main__":
    asyncio.run(main())
