#!/usr/bin/env python3
"""
Enhanced CWO Scraper - Main Orchestrator

Entry point for running the enhanced CWO scraper with product discovery and creation.

Usage:
    # From parent directory (recommended):
    python -m enhanced_cwo.main --wheels

    # From this directory:
    python main.py --wheels
"""

import asyncio
import sys
import os
import time
import aiohttp
import aiomysql

# Add parent directory to path to import db_client
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import db_client

# Try relative imports first (when run as module), fall back to absolute
try:
    from . import config
    from .config import (
        MODE,
        ENABLE_PRODUCT_DISCOVERY,
        ENABLE_SHOPIFY_SYNC,
        RETRY_FAILED_PRODUCTS,
        MAX_PRODUCTS_PER_DAY,
        DB_CONFIG,
        SCRAPE_SPECIFIC_BRANDS,
        logger
    )
    from .gcs_manager import GCSManager
    from .shopify_ops_new import sync_shopify_products_table
    from .product_discovery import (
        discover_new_products,
        extract_product_data_batch,
        get_failed_products_for_retry
    )
    from .product_creation import (
        check_daily_creation_limit,
        create_products_batch
    )
except ImportError:
    # Running directly, use absolute imports
    import config
    from config import (
        MODE,
        ENABLE_PRODUCT_DISCOVERY,
        ENABLE_SHOPIFY_SYNC,
        RETRY_FAILED_PRODUCTS,
        MAX_PRODUCTS_PER_DAY,
        DB_CONFIG,
        SCRAPE_SPECIFIC_BRANDS,
        logger
    )
    from gcs_manager import GCSManager
    from shopify_ops_new import sync_shopify_products_table
    from product_discovery import (
        discover_new_products,
        extract_product_data_batch,
        get_failed_products_for_retry
    )
    from product_creation import (
        check_daily_creation_limit,
        create_products_batch
    )

# Import original scraper functions (we'd need to adapt these or keep original scraper)
# For now, we'll create a simplified version


# =============================================================================
# STATISTICS
# =============================================================================

stats = {
    'pages_scraped': 0,
    'products_found': 0,
    'products_skipped_brand': 0,
    'products_updated': 0,
    'products_new': 0,
    'errors': 0,
    # New stats
    'shopify_products_synced': 0,
    'new_products_discovered': 0,
    'products_skipped_discontinued': 0,
    'products_created_wheels_table': 0,
    'products_created_shopify': 0,
    'failed_shopify_creations': 0,
    'retried_products': 0,
    'images_processed': 0,
}


# =============================================================================
# MAIN WORKFLOW
# =============================================================================

async def run_enhanced_scraper():
    """Main workflow orchestrator."""
    start_time = time.time()

    logger.info("")
    logger.info("=" * 80)
    logger.info("ENHANCED CWO SCRAPER - STARTING")
    logger.info("=" * 80)
    logger.info(f"Mode: {MODE}")
    logger.info(f"Product Discovery: {ENABLE_PRODUCT_DISCOVERY}")
    logger.info(f"Shopify Sync: {ENABLE_SHOPIFY_SYNC}")
    logger.info("=" * 80)

    # CRITICAL: Check for orphaned trigger backup (from previous crash)
    if os.path.exists('triggers_backup.json'):
        logger.error("=" * 80)
        logger.error("⚠️  ORPHANED TRIGGER BACKUP DETECTED!")
        logger.error("=" * 80)
        logger.error("Found 'triggers_backup.json' from a previous run that crashed.")
        logger.error("Your database triggers may be DISABLED!")
        logger.error("")
        logger.error("To restore triggers manually, run:")
        logger.error("  python restore_triggers.py")
        logger.error("")
        logger.error("Or delete the file if you've already restored them:")
        logger.error("  rm triggers_backup.json")
        logger.error("=" * 80)

        response = input("\nType 'continue' to proceed anyway, or Ctrl+C to exit: ")
        if response.lower() != 'continue':
            logger.info("Exiting. Please restore triggers first.")
            sys.exit(1)

    # Create aiomysql connection pool for enhanced modules
    db_pool = None

    try:
        # Initialize database (legacy db_client for scraping workflow)
        logger.info("Initializing database connection...")
        await db_client.init(MODE)

        # Create aiomysql pool for enhanced modules
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

        # Initialize GCS manager (for image uploads)
        gcs_manager = None
        if ENABLE_PRODUCT_DISCOVERY:
            logger.info("Initializing GCS manager...")
            gcs_manager = await GCSManager.create()
            logger.info("✅ GCS manager initialized")

        async with aiohttp.ClientSession() as session:

            # ================================================================
            # STEP 0: Retry Failed Products
            # ================================================================
            # Skip retry when scraping specific brands (quick targeted scrape)
            if ENABLE_PRODUCT_DISCOVERY and RETRY_FAILED_PRODUCTS and not SCRAPE_SPECIFIC_BRANDS:
                logger.info("")
                logger.info("=" * 80)
                logger.info("STEP 0: RETRYING FAILED PRODUCTS FROM PREVIOUS RUNS")
                logger.info("=" * 80)

                failed_products = await get_failed_products_for_retry(db_pool)

                if len(failed_products) > 0:
                    # Check daily limit
                    remaining_limit = await check_daily_creation_limit(db_pool)
                    logger.info(f"Daily limit: {remaining_limit} products can be created today")

                    if remaining_limit > 0:
                        retry_count = min(len(failed_products), remaining_limit)
                        logger.info(f"Retrying {retry_count} failed products...")

                        # Failed products already have full data in database - no need to re-scrape
                        failed_batch = failed_products[:retry_count]

                        logger.info(f"✅ Loaded {len(failed_batch)} products from database (skipping re-scrape)")

                        # Create products on Shopify directly (table data already exists)
                        if len(failed_batch) > 0:
                            await create_products_batch(
                                session,
                                gcs_manager,
                                db_pool,
                                failed_batch,  # Already has extracted_data from DB
                                stats
                            )
                            stats['retried_products'] = len(failed_batch)
                    else:
                        logger.warning("Daily limit reached - cannot retry products")
                else:
                    logger.info("No failed products to retry")

            # ================================================================
            # STEP 1: Sync Shopify Product Tables
            # ================================================================
            # Skip Shopify sync when scraping specific brands (quick targeted scrape)
            if ENABLE_SHOPIFY_SYNC and not SCRAPE_SPECIFIC_BRANDS:
                synced_count = await sync_shopify_products_table(session, db_pool)
                stats['shopify_products_synced'] = synced_count
            elif SCRAPE_SPECIFIC_BRANDS:
                logger.info("")
                logger.info("=" * 80)
                logger.info(f"SKIPPING SHOPIFY SYNC (scraping specific brands: {', '.join(SCRAPE_SPECIFIC_BRANDS)})")
                logger.info("=" * 80)

            # ================================================================
            # STEP 2: Scrape CWO Inventory
            # ================================================================
            try:
                from .scraping_workflow import initialize_browser_and_cookies, scrape_all_pages, load_checkpoint
                from .config import BASE_URL, SKIP_BRANDS_NORMALIZED, RESUME_FROM_CHECKPOINT, HEADLESS
            except ImportError:
                from scraping_workflow import initialize_browser_and_cookies, scrape_all_pages, load_checkpoint
                from config import BASE_URL, SKIP_BRANDS_NORMALIZED, RESUME_FROM_CHECKPOINT, HEADLESS

            # Prefetch URL parts to cache (critical for change detection)
            logger.info("")
            logger.info("=" * 80)
            logger.info("PREFETCHING EXISTING PRODUCTS")
            logger.info("=" * 80)

            try:
                if SCRAPE_SPECIFIC_BRANDS:
                    # Use the brands we're actually scraping
                    db_brands = SCRAPE_SPECIFIC_BRANDS
                    logger.info(f"Using {len(db_brands)} specific brands for prefetch: {', '.join(db_brands)}")
                else:
                    # Get all brands from Shopify, excluding SKIP_BRANDS
                    all_brands = await db_client.get_shopify_brands()
                    db_brands = [brand for brand in all_brands if brand.lower() not in SKIP_BRANDS_NORMALIZED]
                    logger.info(f"Prefetching {len(db_brands)} brands (excluding {len(SKIP_BRANDS_NORMALIZED)} SKIP_BRANDS)")

                await db_client.prefetch_url_parts(db_brands)
                logger.info(f"✅ Prefetched URL parts for {len(db_brands)} brands")
            except Exception as e:
                logger.warning(f"Could not prefetch URL parts: {e}")

            logger.info("=" * 80)

            # Load checkpoint if resuming
            checkpoint = None
            if RESUME_FROM_CHECKPOINT:
                checkpoint = load_checkpoint()

            # Initialize browser and get cookies
            if checkpoint and checkpoint.get('cookies'):
                cookies = checkpoint['cookies']
                logger.info("Using cookies from checkpoint (skipping CAPTCHA)")
                # Still create driver for potential refresh cycles
                from seleniumbase import Driver
                driver = Driver(uc=True, headless=HEADLESS)
            else:
                driver, cookies = await initialize_browser_and_cookies(BASE_URL)

            try:
                # Scrape all pages and get products (WITH checkpoint support)
                scraped_products = await scrape_all_pages(session, cookies, checkpoint)

                logger.info(f"✅ Scraped {len(scraped_products)} products from CWO")

            finally:
                # Clean up browser
                try:
                    driver.quit()
                    logger.info("Browser closed")
                except:
                    pass

            # ================================================================
            # STEP 3: Discover New Products
            # ================================================================
            if ENABLE_PRODUCT_DISCOVERY and len(scraped_products) > 0:
                discovery_queue, _ = await discover_new_products(
                    session,
                    db_pool,
                    scraped_products,
                    []  # cookies from scraper
                )

                stats['new_products_discovered'] = len(discovery_queue)

                # ================================================================
                # STEP 4: Extract Product Data
                # ================================================================
                if len(discovery_queue) > 0:
                    logger.info("")
                    logger.info("=" * 80)
                    logger.info("STEP 4: EXTRACTING PRODUCT DATA")
                    logger.info("=" * 80)

                    # Check daily limit
                    remaining_limit = await check_daily_creation_limit(db_pool)
                    logger.info(f"Daily limit: {remaining_limit} products can be created today")

                    if remaining_limit > 0:
                        # Limit to daily max
                        products_to_process = discovery_queue[:remaining_limit]

                        logger.info(f"Processing {len(products_to_process)} products (limit: {remaining_limit})")

                        # Extract product data
                        extracted_products = await extract_product_data_batch(
                            session,
                            products_to_process,
                            [],  # cookies from scraper
                            stats  # Pass stats to track discontinued products
                        )

                        # ================================================================
                        # STEP 5: Create Products
                        # ================================================================
                        if len(extracted_products) > 0:
                            logger.info("")
                            logger.info("=" * 80)
                            logger.info("STEP 5: CREATING PRODUCTS")
                            logger.info("=" * 80)

                            await create_products_batch(
                                session,
                                gcs_manager,
                                db_pool,
                                extracted_products,
                                stats
                            )
                    else:
                        logger.warning("Daily limit reached - cannot create new products")

            # ================================================================
            # STEP 5.5: Restore Prices for Ended Sales
            # ================================================================
            logger.info("")
            logger.info("=" * 80)
            logger.info("STEP 5.5: RESTORING PRICES FOR ENDED SALES")
            logger.info("=" * 80)

            try:
                # Import tracking from scraping workflow
                try:
                    from .scraping_workflow import updated_part_numbers, updated_lock
                    from .config import SKIP_BRANDS_NORMALIZED
                except ImportError:
                    from scraping_workflow import updated_part_numbers, updated_lock
                    from config import SKIP_BRANDS_NORMALIZED

                # Determine which brands to process based on scraping mode
                if SCRAPE_SPECIFIC_BRANDS:
                    restore_brands = SCRAPE_SPECIFIC_BRANDS
                    logger.info(f"Restoring prices for {len(restore_brands)} specific brands: {', '.join(restore_brands)}")
                else:
                    # Get all brands from Shopify, but exclude SKIP_BRANDS
                    all_brands = await db_client.get_shopify_brands()
                    restore_brands = [brand for brand in all_brands if brand.lower() not in SKIP_BRANDS_NORMALIZED]
                    logger.info(f"Restoring prices for {len(restore_brands)} brands (excluding {len(SKIP_BRANDS_NORMALIZED)} SKIP_BRANDS)")

                # Get parts that were updated in this run
                async with updated_lock:
                    scraped_parts = list(updated_part_numbers)

                logger.info(f"Products scraped this run: {len(scraped_parts)}")

                # Restore prices for products where compare_at_price > price_map
                # This handles products that were on sale but are no longer on sale
                price_restore_count = await db_client.restore_ended_sale_prices(
                    brands=restore_brands,
                    scraped_parts=scraped_parts
                )

                logger.info(f"✅ Restored prices for {price_restore_count} products no longer on sale")
                logger.info("=" * 80)

            except Exception as e:
                logger.error(f"Error in price restoration phase: {e}")
                import traceback
                logger.error(traceback.format_exc())

            # ================================================================
            # STEP 6: Zero Unupdated Products
            # ================================================================
            logger.info("")
            logger.info("=" * 80)
            logger.info("STEP 6: ZEROING UNUPDATED PRODUCTS")
            logger.info("=" * 80)

            try:
                # Import tracking from scraping workflow
                try:
                    from .scraping_workflow import updated_part_numbers, updated_lock
                except ImportError:
                    from scraping_workflow import updated_part_numbers, updated_lock

                # Get all URL parts for the brands that were scraped
                if SCRAPE_SPECIFIC_BRANDS:
                    db_brands = SCRAPE_SPECIFIC_BRANDS
                else:
                    all_brands = await db_client.get_shopify_brands()
                    db_brands = [brand for brand in all_brands if brand.lower() not in SKIP_BRANDS_NORMALIZED]

                all_url_parts = await db_client.get_all_url_parts_for_brands(db_brands)
                all_parts = set()
                for brand_parts in all_url_parts.values():
                    all_parts.update(brand_parts)

                # Find parts that were NOT updated in this run
                async with updated_lock:
                    unupdated_parts = list(all_parts - updated_part_numbers)

                if not unupdated_parts:
                    logger.info("No unupdated products found - all products in database were seen during scrape")
                else:
                    logger.info(f"Found {len(unupdated_parts)} products that need to be zeroed")
                    logger.info("Pausing 30 seconds to let in-flight updates complete...")
                    await asyncio.sleep(30)

                    # Disable triggers for fast zeroing
                    logger.info("Disabling triggers for fast zeroing...")
                    saved_triggers = await db_client.disable_triggers()

                    try:
                        # Zero the products
                        logger.info("Zeroing products in database...")
                        zero_count = await db_client.batch_set_zero_quantity(unupdated_parts)
                        logger.info(f"✅ Zeroed {zero_count} products")

                        # Bulk insert to sync queue
                        logger.info("Queuing zeroed products for Shopify sync...")
                        queued_count = await db_client.bulk_insert_to_sync_queue(unupdated_parts, quantity=0)
                        logger.info(f"✅ Queued {queued_count} products for sync")

                    finally:
                        # ALWAYS restore triggers
                        logger.info("Re-enabling triggers...")
                        await db_client.restore_triggers(saved_triggers)
                        logger.info("✅ Triggers restored")

            except Exception as e:
                logger.error(f"Error in zeroing phase: {e}")
                import traceback
                logger.error(traceback.format_exc())

            logger.info("=" * 80)

        # ================================================================
        # FINAL SUMMARY
        # ================================================================
        duration = time.time() - start_time

        logger.info("")
        logger.info("=" * 80)
        logger.info("ENHANCED CWO SCRAPER - COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Total Runtime: {duration:.1f}s ({duration/60:.1f} minutes)")
        logger.info("")
        logger.info("STATISTICS:")
        logger.info(f"  Shopify Products Synced: {stats['shopify_products_synced']}")
        logger.info(f"  New Products Discovered: {stats['new_products_discovered']}")
        if stats['products_skipped_discontinued'] > 0:
            logger.info(f"  Products Skipped (Discontinued): {stats['products_skipped_discontinued']}")
        logger.info(f"  Products Created (Table): {stats['products_created_wheels_table']}")
        logger.info(f"  Products Created (Shopify): {stats['products_created_shopify']}")
        logger.info(f"  Failed Creations: {stats['failed_shopify_creations']}")
        logger.info(f"  Products Retried: {stats['retried_products']}")
        logger.info(f"  Images Processed: {stats['images_processed']}")
        logger.info("")
        logger.info(f"  Pages Scraped: {stats['pages_scraped']}")
        logger.info(f"  Products Found: {stats['products_found']}")
        logger.info(f"  Products Updated: {stats['products_updated']}")
        logger.info(f"  Products New: {stats['products_new']}")
        logger.info(f"  Errors: {stats['errors']}")
        logger.info("=" * 80)

    except KeyboardInterrupt:
        logger.info("Scraper interrupted by user")
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


def main():
    """Entry point."""
    try:
        asyncio.run(run_enhanced_scraper())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
