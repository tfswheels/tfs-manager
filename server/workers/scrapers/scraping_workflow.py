"""
Scraping Workflow Module

Full page scraping workflow from original cwo_scraper.py,
adapted for the enhanced modular structure.
"""

import asyncio
import aiohttp
import time
import json
import traceback
from typing import List, Dict, Set, Optional
from seleniumbase import Driver

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import (
        MODE,
        BASE_URL,
        HEADLESS,
        CONCURRENT_PAGE_WORKERS,
        BATCH_SIZE,
        CHECKPOINT_FILE,
        CHECKPOINT_INTERVAL,
        SALE_ONLY,
        MAX_CONSECUTIVE_NON_IN_STOCK,
        STOP_ON_BACKORDER_ONLY,
        PAGES_PER_REFRESH_BATCH,
        REFRESH_COOLOFF_MINUTES,
        RETRY_COOLOFF_MINUTES,
        logger
    )
    from .scraper_core import (
        Product,
        parse_product_card,
        handle_initial_captcha,
        fetch_page_with_zenrows
    )
except ImportError:
    from config import (
        MODE,
        BASE_URL,
        HEADLESS,
        CONCURRENT_PAGE_WORKERS,
        BATCH_SIZE,
        CHECKPOINT_FILE,
        CHECKPOINT_INTERVAL,
        SALE_ONLY,
        MAX_CONSECUTIVE_NON_IN_STOCK,
        STOP_ON_BACKORDER_ONLY,
        PAGES_PER_REFRESH_BATCH,
        REFRESH_COOLOFF_MINUTES,
        RETRY_COOLOFF_MINUTES,
        logger
    )
    from scraper_core import (
        Product,
        parse_product_card,
        handle_initial_captcha,
        fetch_page_with_zenrows
    )


# Global tracking
stop_page_detected: Optional[int] = None
stop_page_lock = asyncio.Lock()

# Track updated products for zeroing phase
updated_part_numbers: Set[str] = set()
updated_lock = asyncio.Lock()

# Checkpoint data
checkpoint_data = {
    'last_page': 0,
    'timestamp': None,
    'cookies': None
}


def save_checkpoint(page: int, cookies: List[Dict]) -> None:
    """Save checkpoint to file."""
    try:
        from datetime import datetime
        checkpoint = {
            'last_page': page,
            'timestamp': datetime.now().isoformat(),
            'cookies': cookies
        }
        with open(CHECKPOINT_FILE, 'w') as f:
            json.dump(checkpoint, f)
        logger.debug(f"Checkpoint saved at page {page}")
    except Exception as e:
        logger.error(f"Error saving checkpoint: {e}")


def load_checkpoint() -> Optional[Dict]:
    """Load checkpoint from file."""
    import os
    if not os.path.exists(CHECKPOINT_FILE):
        return None
    try:
        with open(CHECKPOINT_FILE, 'r') as f:
            checkpoint = json.load(f)
        logger.info(f"Loaded checkpoint from page {checkpoint.get('last_page', 0)}")
        return checkpoint
    except Exception as e:
        logger.error(f"Error loading checkpoint: {e}")
        return None


async def scrape_page(page_number: int, session: aiohttp.ClientSession, cookies: List[Dict]) -> tuple:
    """
    Scrape a single page and return products.

    Returns:
        Tuple[List[Product], bool, bool]: (products, should_continue, is_error)
    """
    global stop_page_detected

    try:
        # Construct page URL
        if '?' in BASE_URL:
            url = f"{BASE_URL}&page={page_number}"
        else:
            sale_toggle = 1 if SALE_ONLY else 0
            url = f"{BASE_URL}?store={MODE}&page={page_number}&qdToggle=0&saleToggle={sale_toggle}&sort=instock"

        logger.debug(f"Scraping page {page_number}: {url}")

        # Fetch page via ZenRows
        html = await fetch_page_with_zenrows(session, url, cookies)

        if not html:
            logger.error(f"Failed to get HTML for page {page_number}")
            return [], False, True  # is_error=True

        # Debug: Save first page HTML
        if page_number == 1:
            try:
                with open(f'page_1_debug.html', 'w', encoding='utf-8') as f:
                    f.write(html)
                logger.info(f"Saved page 1 HTML to page_1_debug.html ({len(html)} bytes)")
            except:
                pass

        # Parse HTML
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')

        # Check for "no results"
        no_results = soup.find('div', class_='no-results-container')
        if no_results:
            logger.info(f"Page {page_number}: No more results")
            return [], False, False  # End of pages

        # Find product cards
        product_cards = soup.find_all('a', class_='product-card-a')

        if not product_cards:
            logger.info(f"Page {page_number}: No product cards found")
            return [], False, False

        logger.info(f"Page {page_number}: Found {len(product_cards)} product cards")

        # Parse products
        products = []
        parsed_count = 0
        skipped_brand_count = 0
        parse_error_count = 0
        consecutive_non_in_stock = 0

        for card in product_cards:
            try:
                card_html = str(card)
                product = parse_product_card(card_html)

                if product is None:
                    parse_error_count += 1
                    continue

                # Check if this is a SKIP_BRANDS product (brand=None marker)
                if product.brand is None:
                    skipped_brand_count += 1

                    # IMPORTANT: Still count inventory_status for stop detection!
                    if STOP_ON_BACKORDER_ONLY:
                        # Only count backordered items
                        if product.inventory_status == 'backordered':
                            consecutive_non_in_stock += 1
                        else:
                            consecutive_non_in_stock = 0
                    else:
                        # Count both made-to-order and backordered
                        if product.inventory_status in ['made_to_order', 'backordered']:
                            consecutive_non_in_stock += 1
                        else:
                            consecutive_non_in_stock = 0

                    # Check if we should stop (even for skipped brands!)
                    if consecutive_non_in_stock >= MAX_CONSECUTIVE_NON_IN_STOCK:
                        stop_reason = 'backordered' if STOP_ON_BACKORDER_ONLY else 'made-to-order/backordered'
                        logger.info(f"Page {page_number}: Found {consecutive_non_in_stock} consecutive {stop_reason} items (STOP CONDITION)")

                        # Set global stop page
                        async with stop_page_lock:
                            if stop_page_detected is None or page_number < stop_page_detected:
                                stop_page_detected = page_number
                                logger.info(f"Setting stop_page_detected to {page_number}")

                        return products, False, False  # should_continue=False, is_error=False

                    continue  # Don't add to products list

                # Valid product (not skipped)
                products.append(product)
                parsed_count += 1

                # Track consecutive non-in-stock items based on mode
                if STOP_ON_BACKORDER_ONLY:
                    # Only count backordered items
                    if product.inventory_status == 'backordered':
                        consecutive_non_in_stock += 1
                    else:
                        consecutive_non_in_stock = 0
                else:
                    # Count both made-to-order and backordered
                    if product.inventory_status in ['made_to_order', 'backordered']:
                        consecutive_non_in_stock += 1
                    else:
                        consecutive_non_in_stock = 0

                # Check if we should stop (LEGITIMATE stop condition)
                if consecutive_non_in_stock >= MAX_CONSECUTIVE_NON_IN_STOCK:
                    stop_reason = 'backordered' if STOP_ON_BACKORDER_ONLY else 'made-to-order/backordered'
                    logger.info(f"Page {page_number}: Found {consecutive_non_in_stock} consecutive {stop_reason} items (STOP CONDITION)")

                    # Set global stop page
                    async with stop_page_lock:
                        if stop_page_detected is None or page_number < stop_page_detected:
                            stop_page_detected = page_number
                            logger.info(f"Setting stop_page_detected to {page_number}")

                    return products, False, False  # should_continue=False, is_error=False

            except Exception as e:
                logger.warning(f"Exception parsing product card: {e}")
                parse_error_count += 1
                continue

        logger.info(f"Page {page_number}: Parsed {parsed_count} products, {skipped_brand_count} skipped (brand), {parse_error_count} failed")

        return products, True, False  # should_continue=True, is_error=False

    except Exception as e:
        logger.error(f"Error scraping page {page_number}: {e}")
        logger.error(traceback.format_exc())
        return [], False, True  # is_error=True


async def page_worker(worker_id: int, page_queue: asyncio.Queue, session, cookies: List[Dict],
                     results_queue: asyncio.Queue, stop_event: asyncio.Event):
    """Worker that processes pages from the queue."""
    logger.debug(f"Worker {worker_id} started")

    while not stop_event.is_set():
        try:
            page_number = await asyncio.wait_for(page_queue.get(), timeout=2.0)

            async with stop_page_lock:
                if stop_page_detected is not None and page_number >= stop_page_detected:
                    logger.debug(f"Worker {worker_id} skipping page {page_number}")
                    page_queue.task_done()
                    continue

            logger.debug(f"Worker {worker_id} processing page {page_number}")

            products, should_continue, is_error = await scrape_page(page_number, session, cookies)

            await results_queue.put((page_number, products, should_continue, is_error))
            page_queue.task_done()

            # Save checkpoint periodically
            if page_number % CHECKPOINT_INTERVAL == 0 and len(products) > 0:
                save_checkpoint(page_number, cookies)

        except asyncio.TimeoutError:
            continue
        except Exception as e:
            logger.error(f"Worker {worker_id} error: {e}")

    logger.debug(f"Worker {worker_id} stopped")


async def scrape_all_pages(session, cookies: List[Dict], checkpoint: Optional[Dict] = None) -> List[Dict]:
    """
    Main scraping function with concurrent workers, checkpointing, and retry.

    Returns:
        List of all scraped products (as dicts for discovery)
    """
    logger.info("")
    logger.info("=" * 80)
    logger.info("SCRAPING CWO PAGES")
    logger.info("=" * 80)

    start_time = time.time()
    all_products = []

    # Reset global stop detection
    global stop_page_detected
    stop_page_detected = None

    # Create queues
    page_queue = asyncio.Queue()
    results_queue = asyncio.Queue()
    stop_event = asyncio.Event()

    # Start workers
    workers = [
        asyncio.create_task(
            page_worker(i, page_queue, session, cookies, results_queue, stop_event)
        )
        for i in range(CONCURRENT_PAGE_WORKERS)
    ]

    # Determine starting page from checkpoint
    start_page = checkpoint.get('last_page', 0) + 1 if checkpoint else 1
    if start_page > 1:
        logger.info(f"Resuming from checkpoint at page {start_page}")

    # Queue initial pages
    current_page = start_page
    for _ in range(CONCURRENT_PAGE_WORKERS * 2):
        await page_queue.put(current_page)
        current_page += 1

    logger.info(f"Starting scrape from page {start_page} with {CONCURRENT_PAGE_WORKERS} workers")

    # Process results
    product_batch = []
    processed_pages = 0
    pages_scraped = 0
    failed_pages = set()  # Track pages that failed
    last_successful_page = start_page - 1
    pages_since_refresh = 0
    last_progress_report = start_page - 1
    scrape_completed_successfully = False

    while True:
        try:
            page_num, products, should_continue, is_error = await asyncio.wait_for(
                results_queue.get(),
                timeout=60.0
            )

            processed_pages += 1
            pages_scraped += 1
            pages_since_refresh += 1

            # Collect products
            for product in products:
                product_dict = {
                    'brand': product.brand,
                    'model_color': product.model_color,
                    'size_info': product.size_info,
                    'price': product.price,
                    'quantity': product.quantity,
                    'url': product.url,
                    'url_part_number': product.url_part_number,
                    'inventory_status': product.inventory_status,
                }
                all_products.append(product_dict)
                product_batch.append(product)

            # Update existing products in database (batch)
            if len(product_batch) >= BATCH_SIZE:
                await process_product_batch(product_batch)
                product_batch = []

            # Handle errors separately from legitimate stops
            if is_error:
                logger.warning(f"Page {page_num} failed - will retry after cool-off")
                failed_pages.add(page_num)
                # Queue next page
                await page_queue.put(current_page)
                current_page += 1

            elif not should_continue:
                # LEGITIMATE stop signal (30+ consecutive non-in-stock OR no results)
                logger.info(f"Page {page_num}: Stop condition detected")
                logger.info("Draining remaining results from workers...")
                stop_event.set()

                # Drain remaining results
                drain_timeout = 30
                drain_start = time.time()
                drained_count = 0

                while time.time() - drain_start < drain_timeout:
                    try:
                        page_num_drain, products_drain, _, is_error_drain = await asyncio.wait_for(
                            results_queue.get(),
                            timeout=5.0
                        )

                        drained_count += 1
                        processed_pages += 1
                        pages_scraped += 1

                        # Collect products from drained pages
                        for product in products_drain:
                            product_dict = {
                                'brand': product.brand,
                                'model_color': product.model_color,
                                'size_info': product.size_info,
                                'price': product.price,
                                'quantity': product.quantity,
                                'url': product.url,
                                'url_part_number': product.url_part_number,
                                'inventory_status': product.inventory_status,
                            }
                            all_products.append(product_dict)
                            product_batch.append(product)

                        if len(product_batch) >= BATCH_SIZE:
                            await process_product_batch(product_batch)
                            product_batch = []

                        if not is_error_drain:
                            last_successful_page = max(last_successful_page, page_num_drain)

                        results_queue.task_done()

                    except asyncio.TimeoutError:
                        break

                logger.info(f"Drained {drained_count} additional results from queue")
                logger.info(f"Main scrape complete. Last successful page: {last_successful_page}")
                if len(failed_pages) > 0:
                    logger.info(f"Will retry {len(failed_pages)} failed pages after cool-off")
                scrape_completed_successfully = True
                break

            else:
                # Success - track and queue next page
                last_successful_page = max(last_successful_page, page_num)

                # Report progress every 100 pages
                if last_successful_page - last_progress_report >= 100:
                    logger.info(f"Progress: Page {last_successful_page} | {len(all_products)} products found")
                    last_progress_report = last_successful_page

                # Check if we need to refresh browser (every 600 pages)
                if pages_since_refresh >= PAGES_PER_REFRESH_BATCH:
                    logger.info(f"Processed {pages_since_refresh} pages - initiating browser refresh...")

                    # Save checkpoint before refresh
                    save_checkpoint(last_successful_page, cookies)

                    # Process remaining products
                    if product_batch:
                        await process_product_batch(product_batch)
                        product_batch = []

                    # Stop workers temporarily
                    stop_event.set()
                    await asyncio.gather(*workers, return_exceptions=True)

                    # Clear queues
                    while not page_queue.empty():
                        try:
                            page_queue.get_nowait()
                            page_queue.task_done()
                        except:
                            break
                    while not results_queue.empty():
                        try:
                            results_queue.get_nowait()
                            results_queue.task_done()
                        except:
                            break

                    # Cooloff period
                    logger.info("=" * 80)
                    logger.info(f"BROWSER REFRESH CYCLE (page {last_successful_page})")
                    logger.info("=" * 80)
                    logger.info(f"Cooling off for {REFRESH_COOLOFF_MINUTES} minutes...")
                    await asyncio.sleep(REFRESH_COOLOFF_MINUTES * 60)

                    logger.info("Cool-off complete - resuming scraping")
                    logger.info("=" * 80)

                    # Restart workers
                    stop_event.clear()
                    workers = [
                        asyncio.create_task(
                            page_worker(i, page_queue, session, cookies, results_queue, stop_event)
                        )
                        for i in range(CONCURRENT_PAGE_WORKERS)
                    ]

                    # Reset counter
                    pages_since_refresh = 0

                    # Re-queue initial pages
                    for _ in range(CONCURRENT_PAGE_WORKERS * 2):
                        await page_queue.put(current_page)
                        current_page += 1

                else:
                    # Normal flow - queue next page
                    await page_queue.put(current_page)
                    current_page += 1

            results_queue.task_done()

        except asyncio.TimeoutError:
            if page_queue.empty() and results_queue.empty():
                logger.info("No more pages to process")
                break

    # Process remaining products
    if product_batch:
        await process_product_batch(product_batch)

    # Stop workers
    stop_event.set()
    await asyncio.gather(*workers, return_exceptions=True)

    # RETRY PHASE: If scrape completed successfully and there are failed pages
    initial_failed_count = len(failed_pages)
    retry_succeeded_count = 0
    final_failed_count = 0

    if scrape_completed_successfully and len(failed_pages) > 0:
        retry_start_time = time.time()

        logger.info("=" * 80)
        logger.info(f"RETRY PHASE: {len(failed_pages)} failed pages")
        logger.info("=" * 80)
        logger.info(f"Cooling off for {RETRY_COOLOFF_MINUTES} minutes before retry...")
        await asyncio.sleep(RETRY_COOLOFF_MINUTES * 60)

        logger.info("Retrying failed pages...")

        # Restart workers for retry
        stop_event.clear()
        retry_queue = asyncio.Queue()
        retry_results_queue = asyncio.Queue()

        retry_workers = [
            asyncio.create_task(
                page_worker(i, retry_queue, session, cookies, retry_results_queue, stop_event)
            )
            for i in range(CONCURRENT_PAGE_WORKERS)
        ]

        # Queue failed pages
        for page_num in sorted(failed_pages):
            await retry_queue.put(page_num)

        # Process retry results
        retry_product_batch = []
        retry_processed = 0
        retry_still_failed = set()

        while retry_processed < len(failed_pages):
            try:
                page_num, products, should_continue, is_error = await asyncio.wait_for(
                    retry_results_queue.get(),
                    timeout=120.0
                )

                retry_processed += 1

                if is_error:
                    logger.warning(f"Page {page_num} failed on retry")
                    retry_still_failed.add(page_num)
                else:
                    # Collect products
                    for product in products:
                        product_dict = {
                            'brand': product.brand,
                            'model_color': product.model_color,
                            'size_info': product.size_info,
                            'price': product.price,
                            'quantity': product.quantity,
                            'url': product.url,
                            'url_part_number': product.url_part_number,
                            'inventory_status': product.inventory_status,
                        }
                        all_products.append(product_dict)
                        retry_product_batch.append(product)

                    if len(retry_product_batch) >= BATCH_SIZE:
                        await process_product_batch(retry_product_batch)
                        retry_product_batch = []

                retry_results_queue.task_done()

            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for retry results")
                break

        # Process remaining
        if retry_product_batch:
            await process_product_batch(retry_product_batch)

        # Stop retry workers
        stop_event.set()
        await asyncio.gather(*retry_workers, return_exceptions=True)

        retry_succeeded_count = len(failed_pages) - len(retry_still_failed)
        final_failed_count = len(retry_still_failed)
        retry_duration = time.time() - retry_start_time

        logger.info("=" * 80)
        logger.info("RETRY PHASE COMPLETE")
        logger.info("=" * 80)
        logger.info(f"Successfully retried: {retry_succeeded_count}")
        logger.info(f"Still failed: {final_failed_count}")
        if retry_still_failed:
            logger.warning(f"Pages that still failed: {sorted(retry_still_failed)}")
        logger.info(f"Retry duration: {retry_duration/60:.1f} minutes")

    duration = time.time() - start_time
    logger.info(f"Scraping complete: {pages_scraped} pages, {len(all_products)} products in {duration:.1f}s")

    # Clean up checkpoint if successful
    import os
    if scrape_completed_successfully and os.path.exists(CHECKPOINT_FILE):
        try:
            os.remove(CHECKPOINT_FILE)
            logger.info("Removed checkpoint file")
        except:
            pass

    logger.info("=" * 80)

    return all_products


async def process_product_batch(products: List[Product]):
    """Process a batch of products and update database."""
    if not products:
        return

    try:
        # Convert to dict format
        product_dicts = [p.to_dict() for p in products]

        # Extract part numbers for tracking
        part_numbers = [p.url_part_number for p in products if p.url_part_number]

        # Update database using existing db_client method
        from db import db_client
        updated_count, stored_count = await db_client.batch_update_products_streaming(product_dicts)

        # Track which products were updated (for zeroing phase)
        async with updated_lock:
            updated_part_numbers.update(part_numbers)

        logger.debug(f"Batch: {len(products)} products -> {updated_count} updated, {stored_count} stored")

    except Exception as e:
        logger.error(f"Error processing product batch: {e}")
        logger.error(traceback.format_exc())


async def initialize_browser_and_cookies(base_url: str) -> tuple:
    """Initialize browser, solve CAPTCHA, and get cookies."""
    logger.info("Initializing browser...")
    driver = Driver(uc=True, headless=HEADLESS)

    try:
        logger.info("Navigating to base URL and handling CAPTCHA...")
        driver.get(base_url)

        if not await handle_initial_captcha(driver):
            logger.error("Failed to handle initial CAPTCHA")

        cookies = driver.get_cookies()
        logger.info(f"Extracted {len(cookies)} cookies from authenticated session")

        return driver, cookies

    except Exception as e:
        logger.error(f"Error initializing browser: {e}")
        raise
