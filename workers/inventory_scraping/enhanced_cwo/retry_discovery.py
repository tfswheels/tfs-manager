#!/usr/bin/env python3
"""
Retry Discovery and Creation Script

Standalone script to retry product discovery and creation without re-scraping.
Useful for retrying products that failed during previous runs.

Usage:
    python retry_discovery.py
"""

import asyncio
import sys
import os
import time
import aiohttp
import aiomysql

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import db_client

# Try relative imports first (when run as module), fall back to absolute
try:
    from . import config
    from .config import MODE, DB_CONFIG, logger
    from .gcs_manager import GCSManager
    from .product_discovery import extract_product_data_batch, get_failed_products_for_retry
    from .product_creation import check_daily_creation_limit, create_products_batch
except ImportError:
    import config
    from config import MODE, DB_CONFIG, logger
    from gcs_manager import GCSManager
    from product_discovery import extract_product_data_batch, get_failed_products_for_retry
    from product_creation import check_daily_creation_limit, create_products_batch


async def main():
    """Main retry workflow."""
    start_time = time.time()

    logger.info("")
    logger.info("=" * 80)
    logger.info("PRODUCT DISCOVERY & CREATION RETRY")
    logger.info("=" * 80)
    logger.info(f"Mode: {MODE}")
    logger.info("=" * 80)

    stats = {
        'products_extracted': 0,
        'products_created_wheels_table': 0,
        'products_created_shopify': 0,
        'failed_shopify_creations': 0,
        'images_processed': 0,
    }

    db_pool = None

    try:
        # Initialize database
        logger.info("Initializing database connection...")
        await db_client.init(MODE)

        # Create aiomysql pool
        db_pool = await aiomysql.create_pool(
            host=DB_CONFIG['host'],
            port=DB_CONFIG['port'],
            user=DB_CONFIG['user'],
            password=DB_CONFIG['password'],
            db=DB_CONFIG['db'],
            minsize=5,
            maxsize=20,
            autocommit=True
        )
        logger.info("✅ Database connected")

        # Initialize GCS manager
        logger.info("Initializing GCS manager...")
        gcs_manager = await GCSManager.create()
        logger.info("✅ GCS manager initialized")

        async with aiohttp.ClientSession() as session:

            # Get failed products from database
            logger.info("")
            logger.info("=" * 80)
            logger.info("FETCHING FAILED PRODUCTS")
            logger.info("=" * 80)

            failed_products = await get_failed_products_for_retry(db_pool)
            logger.info(f"Found {len(failed_products)} products to retry")

            if len(failed_products) == 0:
                logger.info("No failed products found - nothing to retry")
                return

            # Check daily limit
            remaining_limit = await check_daily_creation_limit(db_pool)
            logger.info(f"Daily limit: {remaining_limit} products can be created today")

            if remaining_limit <= 0:
                logger.warning("Daily limit reached - cannot create products")
                return

            # Limit to daily max
            products_to_process = failed_products[:remaining_limit]
            logger.info(f"Processing {len(products_to_process)} products")

            # Extract product data
            logger.info("")
            logger.info("=" * 80)
            logger.info("EXTRACTING PRODUCT DATA")
            logger.info("=" * 80)

            # Note: No cookies needed since we're using ZenRows API directly
            extracted_products = await extract_product_data_batch(
                session,
                products_to_process,
                []  # Empty cookies list - ZenRows handles authentication
            )

            stats['products_extracted'] = len(extracted_products)
            logger.info(f"Successfully extracted {len(extracted_products)} / {len(products_to_process)} products")

            # Create products
            if len(extracted_products) > 0:
                logger.info("")
                logger.info("=" * 80)
                logger.info("CREATING PRODUCTS")
                logger.info("=" * 80)

                await create_products_batch(
                    session,
                    gcs_manager,
                    db_pool,
                    extracted_products,
                    stats
                )

        # Summary
        duration = time.time() - start_time

        logger.info("")
        logger.info("=" * 80)
        logger.info("RETRY COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Total Runtime: {duration:.1f}s ({duration/60:.1f} minutes)")
        logger.info("")
        logger.info("STATISTICS:")
        logger.info(f"  Products Extracted: {stats['products_extracted']}")
        logger.info(f"  Products Created (Table): {stats['products_created_wheels_table']}")
        logger.info(f"  Products Created (Shopify): {stats['products_created_shopify']}")
        logger.info(f"  Failed Creations: {stats['failed_shopify_creations']}")
        logger.info(f"  Images Processed: {stats['images_processed']}")
        logger.info("=" * 80)

    except KeyboardInterrupt:
        logger.info("Retry interrupted by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        logger.error(traceback.format_exc())
    finally:
        # Cleanup
        try:
            if db_pool:
                db_pool.close()
                await db_pool.wait_closed()
            await db_client.close()
            logger.info("Database connection closed")
        except:
            pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
