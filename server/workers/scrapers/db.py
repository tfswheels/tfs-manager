import mysql.connector
from mysql.connector import pooling
from typing import Set, Optional, Dict, List, Tuple
import asyncio
import os
from functools import partial
import logging
from dotenv import load_dotenv
import pathlib
from collections import defaultdict
import time
from datetime import datetime

# Load .env from environment or parent directories
# Will use Railway environment variables when deployed
load_dotenv()

logger = logging.getLogger(__name__)

class DatabaseClient:
    def __init__(self, no_db: bool = False):
        self.no_db = no_db
        self.mode = None  # 'wheels' or 'tires'
        print("Initializing DatabaseClient..." + (" (no-db mode)" if no_db else ""))
        
        # Optimized database configuration
        self.db_config = {
            'host': os.environ.get('DB_HOST'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD'),
            'database': os.environ.get('DB_NAME'),
            'pool_size': 20,  # Reduced pool size but optimized usage
            'pool_reset_session': True,
            'connection_timeout': 120,
            'autocommit': True,
            'buffered': True,  # Add buffered cursors for better performance
            'use_unicode': True,
            'charset': 'utf8mb4'
        }
        
        self.mode_to_table = {
            'wheels': 'shopify_products',
            'tires': 'shopify_products'
        }
        
        self.connection_pool = None
        self.db_lock = asyncio.Lock()
        
        # In-memory cache for URL parts - optimizes lookups
        self._url_parts_cache = {}  # brand -> set of url_parts (for backwards compatibility)
        self._all_url_parts = set()  # all url_parts across all brands (brand-agnostic)
        self._product_data_cache = {}  # url_part -> {quantity, price} for change detection
        self._cache_loaded = False
        
        # Statistics tracking
        self._stats = defaultdict(int)
        self._stats_lock = asyncio.Lock()
        
        if not self.no_db:
            try:
                self.connection_pool = mysql.connector.pooling.MySQLConnectionPool(**self.db_config)
                print("Connection pool created successfully")
            except Exception as e:
                print(f"Error creating connection pool: {e}")
                raise

    def _db_product_type(self) -> str:
        """Return the actual product_type value in the DB ('wheel' or 'tire') based on self.mode."""
        return 'wheel' if self.mode == 'wheels' else 'tire'

    async def init(self, mode: str) -> None:
        self.mode = mode
        print(f"Initializing database for mode: {mode}" + (" (no-db mode)" if self.no_db else ""))
        print("Database initialized successfully")

    async def _get_connection(self):
        if self.no_db:
            print("No-db mode: Skipping database connection")
            return None
        
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                loop = asyncio.get_event_loop()
                connection = await loop.run_in_executor(None, self.connection_pool.get_connection)
                connection.autocommit = True
                return connection
            except mysql.connector.errors.PoolError as e:
                logger.warning(f"Connection pool error (attempt {attempt+1}/{max_attempts}): {e}")
                if attempt < max_attempts - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))  # Shorter retry delay
                else:
                    raise
            except Exception as e:
                logger.error(f"Error getting connection from pool: {e}")
                raise

    async def prefetch_url_parts(self, brands: List[str]) -> None:
        """Prefetch and cache URL parts with current quantity and price for change detection."""
        if self.no_db:
            logger.info("No-db mode: Skipping prefetch_url_parts")
            return

        logger.info(f"Prefetching URL parts with quantity/price data for {len(brands)} brands...")
        start_time = time.time()

        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Get all URL parts WITH current quantity and price for change detection
            placeholders = ', '.join(['%s'] * len(brands))
            query = f"""
                SELECT brand, url_part_number, quantity, map_price
                FROM {self.mode_to_table[self.mode]}
                WHERE brand IN ({placeholders})
                  AND url_part_number IS NOT NULL
                  AND product_type = %s
            """

            params = list(brands) + [self._db_product_type()]
            cursor.execute(query, params)

            # Build cache
            self._url_parts_cache = {brand: set() for brand in brands}
            self._all_url_parts = set()  # Brand-agnostic cache
            self._product_data_cache = {}  # url_part -> {quantity, price}
            row_count = 0

            for row in cursor:
                brand, url_part, quantity, price = row
                if brand in self._url_parts_cache:
                    self._url_parts_cache[brand].add(url_part)
                self._all_url_parts.add(url_part)  # Add to brand-agnostic cache

                # Cache current quantity and price for change detection
                self._product_data_cache[url_part] = {
                    'quantity': int(quantity) if quantity is not None else 0,
                    'price': float(price) if price is not None else None
                }
                row_count += 1

            cursor.close()
            self._cache_loaded = True

            elapsed = time.time() - start_time
            logger.info(f"Prefetched {row_count} URL parts with data for {len(brands)} brands in {elapsed:.2f}s")

            # DIAGNOSTIC: Show cache statistics
            if row_count == 0:
                logger.error("⚠️  CACHE IS EMPTY! No URL parts found in database!")
                logger.error(f"   Brands requested: {brands[:10]}{'...' if len(brands) > 10 else ''}")
            else:
                brands_with_data = sum(1 for brand in brands if len(self._url_parts_cache.get(brand, set())) > 0)
                logger.info(f"   Cache stats: {brands_with_data}/{len(brands)} brands have data")
                logger.info(f"   Total unique URL parts (brand-agnostic): {len(self._all_url_parts)}")
                # Show top 5 brands by part count
                sorted_brands = sorted(self._url_parts_cache.items(), key=lambda x: len(x[1]), reverse=True)[:5]
                for brand, parts in sorted_brands:
                    logger.info(f"     - {brand}: {len(parts)} parts")
                if brands_with_data == 0:
                    logger.error("⚠️  NO BRANDS IN CACHE HAVE DATA!")
            
        except Exception as e:
            logger.error(f"Error prefetching URL parts: {e}")
            # Initialize empty cache as fallback
            self._url_parts_cache = {brand: set() for brand in brands}
            self._all_url_parts = set()
        finally:
            if connection:
                connection.close()

    def get_cached_url_parts(self, brand: str) -> Set[str]:
        """Get URL parts for a brand from cache."""
        return self._url_parts_cache.get(brand, set())

    async def batch_update_products_streaming(self, products: List[Dict]) -> Tuple[int, int]:
        """Optimized batch update for streaming product data. Returns (updated_count, stored_count)."""
        if self.no_db or not products:
            return 0, 0

        logger.debug(f"batch_update_products_streaming called with {len(products)} products")

        # Separate products into different update categories
        matched_full_update = []      # Existing products needing full update
        matched_quantity_only = []    # Existing products needing only quantity update
        unmatched_products = []       # New products to store
        skipped_unchanged = 0         # Track products skipped due to no changes

        for product in products:
            url_part = product.get('url_part_number')
            if url_part:
                # Use brand-agnostic cache for matching (fixes tire brand parsing issue)
                if url_part in self._all_url_parts:
                    # Product exists in database - check if it actually changed
                    cached_data = self._product_data_cache.get(url_part)

                    # Parse scraped quantity and price
                    qty_str = product.get('quantity', '').replace(',', '') if product.get('quantity') else '0'
                    scraped_quantity = int(qty_str) if qty_str.isdigit() else 0

                    price_str = product.get('price_map', '')
                    scraped_price = float(price_str) if price_str and price_str.replace('.', '').isdigit() else None

                    # Compare with cached data
                    if cached_data:
                        db_quantity = cached_data.get('quantity', 0)
                        db_price = cached_data.get('price')

                        # Check if anything actually changed
                        quantity_changed = (scraped_quantity != db_quantity)
                        price_changed = (scraped_price != db_price) if scraped_price is not None else False

                        # Only update if something changed
                        if quantity_changed or price_changed:
                            if product.get('quantity_only_update'):
                                matched_quantity_only.append(product)
                            else:
                                matched_full_update.append(product)
                        else:
                            # No changes detected - skip this product
                            skipped_unchanged += 1
                    else:
                        # No cached data - proceed with update (shouldn't happen but be safe)
                        if product.get('quantity_only_update'):
                            matched_quantity_only.append(product)
                        else:
                            matched_full_update.append(product)
                else:
                    # New product
                    unmatched_products.append(product)

        # DIAGNOSTIC: Log matching statistics (debug level for production)
        logger.debug(f"Batch categorization: {len(matched_full_update)} matched (update), "
                    f"{len(matched_quantity_only)} quantity-only, {len(unmatched_products)} unmatched (new), "
                    f"{skipped_unchanged} skipped (unchanged)")

        # Log efficiency improvement if significant
        if skipped_unchanged > 0:
            total_processed = len(matched_full_update) + len(matched_quantity_only) + skipped_unchanged
            if total_processed > 0:
                skip_pct = (skipped_unchanged / total_processed) * 100
                if skip_pct > 10:  # Only log if more than 10% were skipped
                    logger.info(f"Efficiency: Skipped {skipped_unchanged}/{total_processed} ({skip_pct:.1f}%) unchanged products")

        # DIAGNOSTIC: If cache seems empty, warn (but account for skipped unchanged products)
        total_known_products = len(matched_full_update) + len(matched_quantity_only) + skipped_unchanged
        if len(unmatched_products) > total_known_products * 2 and total_known_products < 10:
            logger.warning(f"⚠️  Cache may be empty! Most products unmatched: {len(unmatched_products)} unmatched vs {total_known_products} known")
            logger.warning(f"    Total URL parts in cache: {len(self._all_url_parts)}")
            logger.warning(f"    Cache brands loaded: {len(self._url_parts_cache)}")
        
        if not matched_full_update and not matched_quantity_only and not unmatched_products:
            logger.debug("No products to process")
            return 0, 0
        
        total_updates = 0
        total_stored = 0
        
        # Process full updates (existing logic)
        if matched_full_update:
            # Prepare data for batch update
            url_parts = []
            quantities = []
            prices = []
            costs = []
            compare_at_prices = []
            clear_flags = []  # NEW: Add clear_flags list
            
            for product in matched_full_update:
                url_part = product.get('url_part_number')
                if not url_part:
                    continue

                try:
                    # Parse quantity
                    qty_str = product.get('quantity', '').replace(',', '') if product.get('quantity') else '0'
                    quantity = int(qty_str) if qty_str.isdigit() else 0

                    # Parse price
                    price_str = product.get('price_map', '')
                    price = float(price_str) if price_str and price_str.replace('.', '').isdigit() else None

                    # Parse cost
                    cost_str = product.get('cost', '')
                    cost = float(cost_str) if cost_str and cost_str.replace('.', '').isdigit() else None

                    # Parse compare at price
                    compare_price = product.get('compare_at_price')
                    if compare_price is not None and not isinstance(compare_price, (int, float)):
                        compare_price = None

                    # Get clear flag
                    clear_compare = product.get('clear_compare_price', False)

                    url_parts.append(url_part)
                    quantities.append(quantity)
                    prices.append(price)
                    costs.append(cost)
                    compare_at_prices.append(compare_price)
                    clear_flags.append(clear_compare)  # NEW: Add clear flag

                except (ValueError, TypeError) as e:
                    logger.debug(f"Error parsing product data for {url_part}: {e}")
                    continue

            # Handle generic sales - compare scraped price with DB price
            if url_parts:
                # Find indices of products with generic sale type and no compare_at_price
                generic_sale_indices = []
                generic_sale_urls = []

                for idx, product in enumerate(matched_full_update[:len(url_parts)]):
                    sale_type = product.get('sale_type')
                    if (sale_type == 'generic' and
                        compare_at_prices[idx] is None and
                        prices[idx] is not None):
                        generic_sale_indices.append(idx)
                        generic_sale_urls.append(url_parts[idx])

                # Batch query current prices for generic sales
                if generic_sale_urls:
                    connection = None
                    try:
                        connection = await self._get_connection()
                        cursor = connection.cursor(buffered=True)

                        placeholders = ', '.join(['%s'] * len(generic_sale_urls))
                        query = f"""
                            SELECT url_part_number, map_price
                            FROM {self.mode_to_table[self.mode]}
                            WHERE url_part_number IN ({placeholders})
                            AND product_type = %s
                        """
                        cursor.execute(query, generic_sale_urls + [self._db_product_type()])

                        # Create map of url -> current DB price
                        db_prices = {row[0]: float(row[1]) for row in cursor.fetchall() if row[1] is not None}
                        cursor.close()

                        # Update compare_at_prices for generic sales
                        for idx in generic_sale_indices:
                            url_part = url_parts[idx]
                            scraped_price = prices[idx]
                            db_price = db_prices.get(url_part)

                            # If DB price exists and is greater than scraped price, it's a sale
                            if db_price and db_price > scraped_price:
                                compare_at_prices[idx] = db_price
                                logger.debug(f"Generic sale detected for {url_part}: DB ${db_price} -> Scraped ${scraped_price}")

                    except Exception as e:
                        logger.error(f"Error looking up prices for generic sales: {e}")
                    finally:
                        if connection:
                            connection.close()
            
            if url_parts:
                # Pass clear_flags to the update function
                full_updates = await self._optimized_batch_update(
                    url_parts, quantities, prices, costs, compare_at_prices, clear_flags
                )
                total_updates += full_updates
                logger.debug(f"Completed {full_updates} full product updates")

                # Update cache with new values to keep it in sync
                for idx, url_part in enumerate(url_parts):
                    if url_part in self._product_data_cache:
                        self._product_data_cache[url_part]['quantity'] = quantities[idx]
                        if prices[idx] is not None:
                            self._product_data_cache[url_part]['price'] = prices[idx]
        
        # Process quantity-only updates
        if matched_quantity_only:
            quantity_updates = await self._batch_update_quantity_only(matched_quantity_only)
            total_updates += quantity_updates
            logger.debug(f"Completed {quantity_updates} quantity-only updates for sale items")

            # Update cache with new quantity values
            for product in matched_quantity_only:
                url_part = product.get('url_part_number')
                if url_part and url_part in self._product_data_cache:
                    qty_str = product.get('quantity', '').replace(',', '') if product.get('quantity') else '0'
                    quantity = int(qty_str) if qty_str.isdigit() else 0
                    self._product_data_cache[url_part]['quantity'] = quantity

        # Note: unmatched_products are now handled by product discovery phase
        # No longer storing to not_scraped table - products are discovered and
        # stored directly to wheels/tires table with product_sync='pending'

        return total_updates, total_stored
    
    async def _batch_update_quantity_only(self, products: List[Dict]) -> int:
        """Update only quantities for products (used for sale items when not scraping pricing)."""
        if not products:
            return 0
        
        # Extract URL parts and quantities
        url_parts = []
        quantities = []
        
        for product in products:
            url_part = product.get('url_part_number')
            if not url_part:
                continue
                
            try:
                # Parse quantity
                qty_str = product.get('quantity', '').replace(',', '') if product.get('quantity') else '0'
                quantity = int(qty_str) if qty_str.isdigit() else 0
                
                url_parts.append(url_part)
                quantities.append(quantity)
                
            except (ValueError, TypeError) as e:
                logger.debug(f"Error parsing quantity for {url_part}: {e}")
                continue
        
        if not url_parts:
            return 0
        
        product_type = self._db_product_type()
        batch_size = 300
        total_updates = 0
        
        for i in range(0, len(url_parts), batch_size):
            batch_urls = url_parts[i:i+batch_size]
            batch_quantities = quantities[i:i+batch_size]
            
            connection = None
            try:
                connection = await self._get_connection()
                cursor = connection.cursor(buffered=True)
                
                # Build update query with CASE statement for quantities only
                qty_cases = []
                params = []
                
                for url, qty in zip(batch_urls, batch_quantities):
                    qty_cases.append("WHEN %s THEN %s")
                    params.extend([url, qty])
                
                query = f"""
                    UPDATE {self.mode_to_table[self.mode]}
                    SET quantity = CASE url_part_number {' '.join(qty_cases)} ELSE quantity END,
                        last_modified = NOW(),
                        last_sdw_sync = NOW()
                    WHERE url_part_number IN ({', '.join(['%s'] * len(batch_urls))})
                    AND product_type = %s
                """
                
                params.extend(batch_urls)
                params.append(product_type)
                
                cursor.execute(query, params)
                batch_updates = cursor.rowcount
                total_updates += batch_updates
                
                connection.commit()
                cursor.close()
                
                async with self._stats_lock:
                    self._stats['quantity_only_updates'] += batch_updates
                
                logger.debug(f"Quantity-only batch updated {batch_updates} products (batch {i//batch_size + 1})")
                
            except Exception as e:
                logger.error(f"Error in quantity-only batch update: {e}")
                if connection:
                    try:
                        connection.rollback()
                    except:
                        pass
            finally:
                if connection:
                    connection.close()
        
        return total_updates

    async def ensure_sync_after_updates(self) -> int:
        """Ensure all recent updates are queued for Shopify sync"""
        if self.no_db:
            return 0
        
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            
            # Queue all products updated in the last 2 hours
            query = """
                INSERT INTO shopify_sync_queue 
                (shopify_id, variant_id, part_number, change_type, new_price, new_quantity, new_compare_at_price)
                SELECT 
                    shopify_id, 
                    variant_id, 
                    part_number, 
                    'price' as change_type,
                    map_price,
                    quantity,
                    compare_at_price
                FROM shopify_products
                WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
                AND shopify_id IS NOT NULL
                AND variant_id IS NOT NULL
                ON DUPLICATE KEY UPDATE
                    new_price = VALUES(new_price),
                    new_quantity = VALUES(new_quantity),
                    new_compare_at_price = VALUES(new_compare_at_price),
                    status = 'pending',
                    retry_count = 0
            """
            
            cursor.execute(query)
            affected = cursor.rowcount
            connection.commit()
            cursor.close()
            
            logger.info(f"Ensured {affected} products are queued for Shopify sync")
            return affected
            
        except Exception as e:
            logger.error(f"Error ensuring sync queue: {e}")
            return 0
        finally:
            if connection:
                connection.close()

    # REMOVED: _store_new_products() function
    # New products are now handled by product discovery phase and stored directly
    # to wheels/tires table with product_sync='pending'

    async def _optimized_batch_update(self, url_parts: List[str], quantities: List[int], 
                                    prices: List[Optional[float]], costs: List[Optional[float]],
                                    compare_at_prices: List[Optional[float]] = None,
                                    clear_compare_prices: List[bool] = None) -> int:
        """Highly optimized batch update with single transaction, now includes compare_at_price clearing."""
        if not url_parts:
            return 0
        
        # If compare_at_prices not provided, create empty list
        if compare_at_prices is None:
            compare_at_prices = [None] * len(url_parts)
        
        # If clear_compare_prices not provided, create empty list
        if clear_compare_prices is None:
            clear_compare_prices = [False] * len(url_parts)
        
        product_type = self._db_product_type()
        batch_size = 300  # Optimized batch size
        total_updates = 0
        
        for i in range(0, len(url_parts), batch_size):
            batch_urls = url_parts[i:i+batch_size]
            batch_quantities = quantities[i:i+batch_size]
            batch_prices = prices[i:i+batch_size]
            batch_costs = costs[i:i+batch_size]
            batch_compare_prices = compare_at_prices[i:i+batch_size]
            batch_clear_compare = clear_compare_prices[i:i+batch_size]
            
            connection = None
            try:
                connection = await self._get_connection()
                cursor = connection.cursor(buffered=True)
                
                # Build comprehensive update query with CASE statements
                updates = []
                params = []
                
                # Quantity updates (always present)
                qty_cases = []
                for url, qty in zip(batch_urls, batch_quantities):
                    qty_cases.append("WHEN %s THEN %s")
                    params.extend([url, qty])
                updates.append(f"quantity = CASE url_part_number {' '.join(qty_cases)} ELSE quantity END")
                
                # Price updates (only for non-null values) 
                price_urls = [url for url, price in zip(batch_urls, batch_prices) if price is not None]
                if price_urls:
                    price_cases = []
                    for url, price in zip(batch_urls, batch_prices):
                        if price is not None:
                            price_cases.append("WHEN %s THEN %s")
                            params.extend([url, price])
                    updates.append(f"map_price = CASE url_part_number {' '.join(price_cases)} ELSE map_price END")
                
                # Cost updates (only for non-null values)
                cost_urls = [url for url, cost in zip(batch_urls, batch_costs) if cost is not None]
                if cost_urls:
                    cost_cases = []
                    for url, cost in zip(batch_urls, batch_costs):
                        if cost is not None:
                            cost_cases.append("WHEN %s THEN %s")
                            params.extend([url, cost])
                    updates.append(f"sdw_cost = CASE url_part_number {' '.join(cost_cases)} ELSE sdw_cost END")
                
                # Compare at price updates - handle both setting values and clearing
                compare_cases = []
                has_compare_updates = False
                
                for url, price, should_clear in zip(batch_urls, batch_compare_prices, batch_clear_compare):
                    if should_clear:
                        # Explicitly clear compare_at_price
                        compare_cases.append("WHEN %s THEN NULL")
                        params.append(url)
                        has_compare_updates = True
                    elif price is not None:
                        # Set compare_at_price
                        compare_cases.append("WHEN %s THEN %s")
                        params.extend([url, price])
                        has_compare_updates = True
                
                if has_compare_updates:
                    updates.append(f"compare_at_price = CASE url_part_number {' '.join(compare_cases)} ELSE compare_at_price END")
                
                # Timestamps
                updates.extend([
                    "last_modified = NOW()",
                    "last_sdw_sync = NOW()"
                ])
                
                # Build final query
                query = f"""
                    UPDATE {self.mode_to_table[self.mode]}
                    SET {', '.join(updates)}
                    WHERE url_part_number IN ({', '.join(['%s'] * len(batch_urls))})
                    AND product_type = %s
                """
                
                params.extend(batch_urls)
                params.append(product_type)
                
                cursor.execute(query, params)
                batch_updates = cursor.rowcount
                total_updates += batch_updates

                # If fewer rows updated than expected, find which ones failed and retry
                if batch_updates < len(batch_urls):
                    # Query to find which URL parts actually exist
                    verify_query = f"""
                        SELECT url_part_number
                        FROM {self.mode_to_table[self.mode]}
                        WHERE url_part_number IN ({', '.join(['%s'] * len(batch_urls))})
                        AND product_type = %s
                    """
                    cursor_verify = connection.cursor(buffered=True)
                    cursor_verify.execute(verify_query, batch_urls + [product_type])
                    existing_urls = set(row[0] for row in cursor_verify.fetchall())
                    cursor_verify.close()

                    missing_urls = set(batch_urls) - existing_urls
                    failed_count = len(batch_urls) - batch_updates

                    logger.warning(f"Batch {i//batch_size + 1}: {batch_updates}/{len(batch_urls)} updated - {failed_count} FAILED")
                    if missing_urls:
                        logger.warning(f"  {len(missing_urls)} URL parts not found in database: {list(missing_urls)[:5]}{'...' if len(missing_urls) > 5 else ''}")

                    # Retry products that exist but didn't update (lock/race condition)
                    if existing_urls and failed_count > len(missing_urls):
                        locked_count = failed_count - len(missing_urls)
                        logger.warning(f"  {locked_count} products exist but didn't update - RETRYING...")

                        # Prepare retry data for products that exist but failed
                        retry_data = []
                        for idx, url in enumerate(batch_urls):
                            if url in existing_urls and url not in missing_urls:
                                # This product exists, might have been locked - add to retry
                                retry_data.append({
                                    'url': url,
                                    'qty': batch_quantities[idx],
                                    'price': batch_prices[idx],
                                    'cost': batch_costs[idx],
                                    'compare': batch_compare_prices[idx],
                                    'clear': batch_clear_compare[idx]
                                })

                        # Retry up to 5 times with small delay
                        if retry_data:
                            import asyncio
                            retry_success = 0
                            for retry_attempt in range(1, 6):  # 5 retries
                                await asyncio.sleep(0.5)  # Small delay to let locks clear

                                retry_urls = [d['url'] for d in retry_data]
                                retry_qtys = [d['qty'] for d in retry_data]
                                retry_prices = [d['price'] for d in retry_data]
                                retry_costs = [d['cost'] for d in retry_data]
                                retry_compares = [d['compare'] for d in retry_data]
                                retry_clears = [d['clear'] for d in retry_data]

                                # Build retry query (same as main query)
                                retry_updates = []
                                retry_params = []

                                # Quantity
                                qty_cases = []
                                for url, qty in zip(retry_urls, retry_qtys):
                                    qty_cases.append("WHEN %s THEN %s")
                                    retry_params.extend([url, qty])
                                retry_updates.append(f"quantity = CASE url_part_number {' '.join(qty_cases)} ELSE quantity END")

                                # Prices (non-null)
                                if any(p is not None for p in retry_prices):
                                    price_cases = []
                                    for url, price in zip(retry_urls, retry_prices):
                                        if price is not None:
                                            price_cases.append("WHEN %s THEN %s")
                                            retry_params.extend([url, price])
                                    retry_updates.append(f"map_price = CASE url_part_number {' '.join(price_cases)} ELSE map_price END")

                                # Costs (non-null)
                                if any(c is not None for c in retry_costs):
                                    cost_cases = []
                                    for url, cost in zip(retry_urls, retry_costs):
                                        if cost is not None:
                                            cost_cases.append("WHEN %s THEN %s")
                                            retry_params.extend([url, cost])
                                    retry_updates.append(f"sdw_cost = CASE url_part_number {' '.join(cost_cases)} ELSE sdw_cost END")

                                # Compare prices
                                compare_cases = []
                                has_compare = False
                                for url, price, should_clear in zip(retry_urls, retry_compares, retry_clears):
                                    if should_clear:
                                        compare_cases.append("WHEN %s THEN NULL")
                                        retry_params.append(url)
                                        has_compare = True
                                    elif price is not None:
                                        compare_cases.append("WHEN %s THEN %s")
                                        retry_params.extend([url, price])
                                        has_compare = True
                                if has_compare:
                                    retry_updates.append(f"compare_at_price = CASE url_part_number {' '.join(compare_cases)} ELSE compare_at_price END")

                                retry_updates.extend(["last_modified = NOW()", "last_sdw_sync = NOW()"])

                                retry_query = f"""
                                    UPDATE {self.mode_to_table[self.mode]}
                                    SET {', '.join(retry_updates)}
                                    WHERE url_part_number IN ({', '.join(['%s'] * len(retry_urls))})
                                    AND product_type = %s
                                """
                                retry_params.extend(retry_urls)
                                retry_params.append(product_type)

                                cursor_retry = connection.cursor(buffered=True)
                                cursor_retry.execute(retry_query, retry_params)
                                retry_updated = cursor_retry.rowcount
                                cursor_retry.close()
                                connection.commit()

                                retry_success += retry_updated
                                logger.info(f"  Retry {retry_attempt}/5: {retry_updated}/{len(retry_data)} products updated")

                                if retry_updated == len(retry_data):
                                    # All retried successfully
                                    break
                                elif retry_updated > 0:
                                    # Some succeeded, remove them from retry list
                                    cursor_check = connection.cursor(buffered=True)
                                    check_query = f"""
                                        SELECT url_part_number
                                        FROM {self.mode_to_table[self.mode]}
                                        WHERE url_part_number IN ({', '.join(['%s'] * len(retry_urls))})
                                        AND product_type = %s
                                        AND last_sdw_sync >= NOW() - INTERVAL 2 SECOND
                                    """
                                    cursor_check.execute(check_query, retry_urls + [product_type])
                                    updated_urls = set(row[0] for row in cursor_check.fetchall())
                                    cursor_check.close()

                                    # Keep only failed ones for next retry
                                    retry_data = [d for d in retry_data if d['url'] not in updated_urls]
                                    if not retry_data:
                                        break

                            total_updates += retry_success
                            if retry_success < locked_count:
                                logger.error(f"  FINAL: {retry_success}/{locked_count} recovered after retries, {locked_count - retry_success} PERMANENTLY FAILED")
                            else:
                                logger.info(f"  SUCCESS: All {retry_success} products recovered after retries")

                connection.commit()
                cursor.close()

                async with self._stats_lock:
                    self._stats['batch_updates'] += 1
                    self._stats['products_updated'] += batch_updates

                if batch_updates == len(batch_urls):
                    logger.debug(f"Batch updated {batch_updates} products (batch {i//batch_size + 1})")
                
            except Exception as e:
                logger.error(f"Error in optimized batch update: {e}")
                if connection:
                    try:
                        connection.rollback()
                    except:
                        pass
            finally:
                if connection:
                    connection.close()
        
        return total_updates

    async def get_all_url_part_numbers(self, brand: str) -> Set[str]:
        """Get URL parts for a single brand (fallback for non-cached access)."""
        if self.no_db:
            return set()
        
        # Use cache if available
        if self._cache_loaded and brand in self._url_parts_cache:
            return self._url_parts_cache[brand].copy()
        
        # Fallback to database query
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            query = f"""
                SELECT url_part_number 
                FROM {self.mode_to_table[self.mode]} 
                WHERE brand = %s 
                  AND url_part_number IS NOT NULL 
                  AND product_type = %s
            """
            cursor.execute(query, (brand, self._db_product_type()))
            rows = cursor.fetchall()
            url_parts = set(row[0] for row in rows)
            cursor.close()
            return url_parts
        except Exception as e:
            logger.error(f"Error in get_all_url_part_numbers: {e}")
            return set()
        finally:
            if connection:
                connection.close()

    async def get_all_url_parts_for_brands(self, brands: List[str]) -> Dict[str, Set[str]]:
        """Get all URL part numbers for multiple brands."""
        if self.no_db or not brands:
            return {brand: set() for brand in brands}

        # Use cache if available
        if self._cache_loaded:
            return {brand: self._url_parts_cache.get(brand, set()).copy() for brand in brands}

        # Fallback to database query
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            placeholders = ', '.join(['%s'] * len(brands))
            query = f"""
                SELECT brand, url_part_number
                FROM {self.mode_to_table[self.mode]}
                WHERE brand IN ({placeholders})
                  AND url_part_number IS NOT NULL
                  AND product_type = %s
            """
            cursor.execute(query, brands + [self._db_product_type()])
            rows = cursor.fetchall()
            result = {brand: set() for brand in brands}
            for row in rows:
                brand, url_part = row
                if brand in result:
                    result[brand].add(url_part)
                # Also populate brand-agnostic cache
                self._all_url_parts.add(url_part)
            cursor.close()
            return result
        except Exception as e:
            logger.error(f"Error getting URL parts for multiple brands: {e}")
            return {brand: set() for brand in brands}
        finally:
            if connection:
                connection.close()

    async def batch_update_products(self, url_parts: List[str], quantities: List[int], 
                                  prices: List[Optional[float]], costs: List[Optional[float]]) -> int:
        """Legacy batch update function - kept for compatibility."""
        return await self._optimized_batch_update(url_parts, quantities, prices, costs)

    async def batch_set_zero_quantity(self, url_parts: List[str]) -> int:
        """Optimized batch zero quantity update.

        Triggers remain ENABLED - sync queue populated incrementally.
        Only updates products where quantity != 0 (avoids unnecessary updates).
        """
        if self.no_db or not url_parts:
            return 0

        import time

        product_type = self._db_product_type()
        batch_size = 500

        # IMPORTANT: Count how many actually need zeroing (WHERE quantity != 0)
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Count products that actually need zeroing
            placeholders = ','.join(['%s'] * len(url_parts))
            count_query = f"""
                SELECT COUNT(*)
                FROM {self.mode_to_table[self.mode]}
                WHERE url_part_number IN ({placeholders})
                AND product_type = %s
                AND quantity != 0
            """
            cursor.execute(count_query, url_parts + [product_type])
            result = cursor.fetchone()
            actual_to_zero = result[0] if result else 0
            cursor.close()
            connection.close()
            connection = None  # Prevent double-close in finally block

            already_zero = len(url_parts) - actual_to_zero
            if already_zero > 0:
                logger.info(f"Found {len(url_parts)} candidates: {actual_to_zero} need zeroing, {already_zero} already at zero")
            else:
                logger.info(f"Found {actual_to_zero} products that need zeroing")

        except Exception as e:
            logger.error(f"Error counting products to zero: {e}")
            actual_to_zero = len(url_parts)  # Fallback
            logger.info(f"Zeroing {len(url_parts)} products (count check failed)...")
        finally:
            if connection:
                connection.close()

        total_affected = 0
        total_batches = (len(url_parts) + batch_size - 1) // batch_size
        start_time = time.time()

        if actual_to_zero == 0:
            logger.info("No products need zeroing - all already at quantity=0")
            return 0

        logger.info(f"Zeroing {actual_to_zero} products in {total_batches} batches...")

        # Perform the zeroing updates
        for i in range(0, len(url_parts), batch_size):
            batch = url_parts[i:i+batch_size]
            batch_num = i // batch_size + 1
            batch_start = time.time()

            connection = None
            try:
                connection = await self._get_connection()
                cursor = connection.cursor(buffered=True)
                placeholders = ', '.join(['%s'] * len(batch))
                query = f"""
                    UPDATE {self.mode_to_table[self.mode]}
                    SET quantity = 0,
                        last_modified = NOW(),
                        last_sdw_sync = NOW()
                    WHERE url_part_number IN ({placeholders})
                    AND product_type = %s
                    AND quantity != 0
                """
                params = batch + [product_type]
                cursor.execute(query, params)
                affected = cursor.rowcount
                total_affected += affected
                connection.commit()
                cursor.close()

                batch_duration = time.time() - batch_start
                elapsed = time.time() - start_time
                progress_pct = (batch_num / total_batches) * 100

                # Calculate ETA
                if batch_num > 0:
                    avg_time_per_batch = elapsed / batch_num
                    remaining_batches = total_batches - batch_num
                    eta_seconds = remaining_batches * avg_time_per_batch
                    eta_str = f"ETA: {int(eta_seconds//60)}m {int(eta_seconds%60)}s" if eta_seconds > 60 else f"ETA: {int(eta_seconds)}s"
                else:
                    eta_str = "ETA: calculating..."

                # Log progress every 100 batches or if it's the last batch
                if batch_num % 100 == 0 or batch_num == total_batches:
                    logger.info(f"  Zeroing progress: {batch_num}/{total_batches} ({progress_pct:.1f}%) - {eta_str}")

            except Exception as e:
                logger.error(f"Error in batch_set_zero_quantity batch {batch_num}: {e}")
            finally:
                if connection:
                    connection.close()

        total_duration = time.time() - start_time

        if total_affected == 0:
            logger.info(f"Zeroing complete - no updates needed (all already at quantity=0)")
        else:
            logger.info(f"Zeroing complete - updated {total_affected} products in {total_duration:.1f}s")

        return total_affected

    async def bulk_insert_to_sync_queue(self, url_parts: List[str], quantity: int = 0) -> int:
        """Bulk insert products to sync queue (used after trigger disable)"""
        if self.no_db or not url_parts:
            return 0

        product_type = self._db_product_type()
        connection = None
        total_queued = 0

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Batch insert to avoid too many params
            batch_size = 1000
            for i in range(0, len(url_parts), batch_size):
                batch = url_parts[i:i+batch_size]
                placeholders = ','.join(['%s'] * len(batch))

                # Insert to sync queue - only products with shopify_id
                query = f"""
                    INSERT INTO shopify_sync_queue
                    (shopify_id, variant_id, part_number, change_type, new_quantity)
                    SELECT shopify_id, variant_id, part_number, 'quantity', %s
                    FROM {self.mode_to_table[self.mode]}
                    WHERE url_part_number IN ({placeholders})
                      AND shopify_id IS NOT NULL
                      AND variant_id IS NOT NULL
                      AND product_type = %s
                """

                params = [quantity] + batch + [product_type]
                cursor.execute(query, params)
                total_queued += cursor.rowcount

            connection.commit()
            cursor.close()
            logger.info(f"Bulk inserted {total_queued} products to sync queue")
            return total_queued

        except Exception as e:
            logger.error(f"Error bulk inserting to sync queue: {e}")
            if connection:
                try:
                    connection.rollback()
                except:
                    pass
            return 0
        finally:
            if connection:
                connection.close()

    async def adjust_ended_sale_prices(self, scraped_part_numbers: List[str]) -> int:
        """
        Adjust prices for products that are no longer on sale.

        For products NOT in scraped_part_numbers that have:
        - compare_at_price IS NOT NULL
        - compare_at_price > map_price

        Set:
        - map_price = compare_at_price (restore original price)
        - compare_at_price = NULL (remove sale indicator)

        Triggers will handle adding to shopify_sync_queue.

        Args:
            scraped_part_numbers: List of url_part_numbers for products currently on sale

        Returns:
            Number of products adjusted
        """
        if self.no_db:
            return 0

        product_type = self._db_product_type()
        connection = None
        total_adjusted = 0

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Strategy: Use a temp table for scraped parts, then LEFT JOIN to find products to adjust
            # This is MUCH faster than NOT IN with thousands of values

            # Create temporary table for scraped parts (if we have any)
            if scraped_part_numbers:
                logger.info(f"Creating temp table with {len(scraped_part_numbers)} scraped products...")

                # Create temp table
                cursor.execute("""
                    CREATE TEMPORARY TABLE temp_scraped_parts (
                        url_part_number VARCHAR(255) PRIMARY KEY
                    )
                """)

                # Batch insert scraped parts
                batch_size = 1000
                for i in range(0, len(scraped_part_numbers), batch_size):
                    batch = scraped_part_numbers[i:i+batch_size]
                    placeholders = ','.join(['(%s)'] * len(batch))
                    insert_query = f"INSERT IGNORE INTO temp_scraped_parts (url_part_number) VALUES {placeholders}"
                    cursor.execute(insert_query, batch)

                connection.commit()
                logger.info("Temp table created")

                # Count products needing adjustment using LEFT JOIN
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {self.mode_to_table[self.mode]} p
                    LEFT JOIN temp_scraped_parts t ON p.url_part_number = t.url_part_number
                    WHERE t.url_part_number IS NULL
                    AND p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """
                cursor.execute(count_query, [product_type])
            else:
                # No products scraped, count all valid sale items
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {self.mode_to_table[self.mode]}
                    WHERE product_type = %s
                    AND compare_at_price IS NOT NULL
                    AND map_price IS NOT NULL
                    AND compare_at_price > map_price
                """
                cursor.execute(count_query, [product_type])

            result = cursor.fetchone()
            products_to_adjust = result[0] if result else 0

            if products_to_adjust == 0:
                logger.info("No products need sale price adjustment")
                cursor.close()
                return 0

            logger.info(f"Found {products_to_adjust} products with ended sales")

            # Perform the adjustment using batches to avoid long-running transactions
            if scraped_part_numbers:
                # Use LEFT JOIN with temp table
                update_query = f"""
                    UPDATE {self.mode_to_table[self.mode]} p
                    LEFT JOIN temp_scraped_parts t ON p.url_part_number = t.url_part_number
                    SET
                        p.map_price = p.compare_at_price,
                        p.compare_at_price = NULL,
                        p.last_modified = NOW(),
                        p.last_sdw_sync = NOW()
                    WHERE t.url_part_number IS NULL
                    AND p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """
                cursor.execute(update_query, [product_type])

                # Clean up temp table
                cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_scraped_parts")
            else:
                # Simple update when no scraped parts
                update_query = f"""
                    UPDATE {self.mode_to_table[self.mode]}
                    SET
                        map_price = compare_at_price,
                        compare_at_price = NULL,
                        last_modified = NOW(),
                        last_sdw_sync = NOW()
                    WHERE product_type = %s
                    AND compare_at_price IS NOT NULL
                    AND map_price IS NOT NULL
                    AND compare_at_price > map_price
                """
                cursor.execute(update_query, [product_type])

            total_adjusted = cursor.rowcount
            connection.commit()
            cursor.close()

            logger.info(f"✓ Adjusted {total_adjusted} products (sale ended, price restored)")
            logger.info(f"  Triggers will queue these products for Shopify sync")

            return total_adjusted

        except Exception as e:
            logger.error(f"Error adjusting ended sale prices: {e}")
            import traceback
            traceback.print_exc()
            if connection:
                try:
                    connection.rollback()
                except:
                    pass
            return 0
        finally:
            if connection:
                connection.close()

    async def restore_ended_sale_prices(self, brands: List[str], scraped_parts: List[str]) -> int:
        """
        Restore original prices for products no longer on sale (brand-aware version).

        For products from specified brands that were NOT scraped in this run:
        - Only updates products where compare_at_price > map_price
        - Sets map_price = compare_at_price (restore original price)
        - Sets compare_at_price = NULL (remove sale indicator)

        Triggers will handle adding to shopify_sync_queue.

        Args:
            brands: List of brand names to process
            scraped_parts: List of url_part_numbers that were scraped (exclude these)

        Returns:
            Number of products with prices restored
        """
        if self.no_db or not brands:
            return 0

        product_type = self._db_product_type()
        connection = None
        total_restored = 0

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Create temp table for scraped parts (products to EXCLUDE)
            if scraped_parts:
                logger.debug(f"Creating temp table with {len(scraped_parts)} scraped products to exclude...")

                cursor.execute("""
                    CREATE TEMPORARY TABLE temp_scraped_exclude (
                        url_part_number VARCHAR(255) PRIMARY KEY
                    )
                """)

                # Batch insert scraped parts
                batch_size = 1000
                for i in range(0, len(scraped_parts), batch_size):
                    batch = scraped_parts[i:i+batch_size]
                    placeholders = ','.join(['(%s)'] * len(batch))
                    insert_query = f"INSERT IGNORE INTO temp_scraped_exclude (url_part_number) VALUES {placeholders}"
                    cursor.execute(insert_query, batch)

                connection.commit()

            # Create temp table for brands to process
            logger.debug(f"Creating temp table with {len(brands)} brands...")

            cursor.execute("""
                CREATE TEMPORARY TABLE temp_restore_brands (
                    brand VARCHAR(255) PRIMARY KEY
                )
            """)

            # Insert brands
            placeholders = ','.join(['(%s)'] * len(brands))
            insert_query = f"INSERT IGNORE INTO temp_restore_brands (brand) VALUES {placeholders}"
            cursor.execute(insert_query, brands)
            connection.commit()

            # Count candidates for price restoration
            if scraped_parts:
                # Exclude scraped parts using LEFT JOIN
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    LEFT JOIN temp_scraped_exclude e ON p.url_part_number = e.url_part_number
                    WHERE e.url_part_number IS NULL
                    AND p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """
            else:
                # No exclusions needed
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    WHERE p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """

            cursor.execute(count_query, [product_type])
            result = cursor.fetchone()
            candidates = result[0] if result else 0

            if candidates == 0:
                logger.debug("No products need price restoration")
                # Clean up temp tables
                cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_restore_brands")
                if scraped_parts:
                    cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_scraped_exclude")
                cursor.close()
                return 0

            logger.info(f"Found {candidates} products with ended sales (compare_at_price > map_price)")

            # Perform the restoration in efficient batches
            if scraped_parts:
                # Use LEFT JOIN to exclude scraped parts
                update_query = f"""
                    UPDATE {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    LEFT JOIN temp_scraped_exclude e ON p.url_part_number = e.url_part_number
                    SET
                        p.map_price = p.compare_at_price,
                        p.compare_at_price = NULL,
                        p.last_modified = NOW(),
                        p.last_sdw_sync = NOW()
                    WHERE e.url_part_number IS NULL
                    AND p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """
            else:
                # Simple update with just brand filter
                update_query = f"""
                    UPDATE {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    SET
                        p.map_price = p.compare_at_price,
                        p.compare_at_price = NULL,
                        p.last_modified = NOW(),
                        p.last_sdw_sync = NOW()
                    WHERE p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """

            cursor.execute(update_query, [product_type])
            total_restored = cursor.rowcount
            connection.commit()

            # Clean up temp tables
            cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_restore_brands")
            if scraped_parts:
                cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_scraped_exclude")

            cursor.close()

            if total_restored > 0:
                logger.info(f"✓ Restored prices for {total_restored} products (sale ended)")
                logger.info(f"  Triggers will queue these products for Shopify sync")

            return total_restored

        except Exception as e:
            logger.error(f"Error restoring ended sale prices: {e}")
            import traceback
            traceback.print_exc()
            if connection:
                try:
                    connection.rollback()
                except:
                    pass
            return 0
        finally:
            if connection:
                connection.close()

    async def disable_triggers(self) -> List[Dict]:
        """Disable all triggers on shopify_products table and return DDL for restoration.

        IMPORTANT: Saves triggers to backup file for crash recovery.
        """
        if self.no_db:
            return []

        saved_triggers = []
        connection = None

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Get trigger definitions
            cursor.execute(f"""
                SELECT TRIGGER_NAME
                FROM information_schema.TRIGGERS
                WHERE EVENT_OBJECT_TABLE = '{self.mode_to_table[self.mode]}'
                AND EVENT_OBJECT_SCHEMA = DATABASE()
            """)
            triggers_info = cursor.fetchall()

            if triggers_info:
                logger.info(f"Disabling {len(triggers_info)} trigger(s) for performance...")

                for (trigger_name,) in triggers_info:
                    try:
                        # Get full CREATE TRIGGER statement
                        cursor.execute(f"SHOW CREATE TRIGGER {trigger_name}")
                        result = cursor.fetchone()
                        if result:
                            create_statement = result[2] if len(result) > 2 else None
                            if create_statement:
                                saved_triggers.append({
                                    'name': trigger_name,
                                    'create_sql': create_statement
                                })
                                # Drop the trigger
                                cursor.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
                                connection.commit()
                    except Exception as e:
                        logger.warning(f"Could not disable trigger {trigger_name}: {e}")

                if saved_triggers:
                    # CRITICAL: Save to file for crash recovery
                    import json
                    backup_file = 'triggers_backup.json'
                    try:
                        with open(backup_file, 'w') as f:
                            json.dump({
                                'timestamp': datetime.now().isoformat(),
                                'mode': self.mode,
                                'triggers': saved_triggers
                            }, f, indent=2)
                        logger.info(f"✓ Disabled {len(saved_triggers)} trigger(s) (backup saved to {backup_file})")
                    except Exception as e:
                        logger.error(f"⚠️  Failed to save trigger backup: {e}")
                        # Still return triggers for in-memory restoration
                        logger.info(f"✓ Disabled {len(saved_triggers)} trigger(s)")

            cursor.close()
            return saved_triggers

        except Exception as e:
            logger.warning(f"Could not disable triggers: {e}")
            return []
        finally:
            if connection:
                connection.close()

    async def restore_triggers(self, saved_triggers: List[Dict]) -> None:
        """Restore triggers that were disabled."""
        if self.no_db or not saved_triggers:
            return

        connection = None

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            logger.info(f"Re-enabling {len(saved_triggers)} trigger(s)...")

            for trigger_info in saved_triggers:
                try:
                    cursor.execute(trigger_info['create_sql'])
                    connection.commit()
                except Exception as e:
                    logger.error(f"Error restoring trigger {trigger_info['name']}: {e}")

            logger.info(f"✓ Re-enabled all {len(saved_triggers)} trigger(s)")
            cursor.close()

            # Clean up backup file after successful restoration
            import os
            backup_file = 'triggers_backup.json'
            if os.path.exists(backup_file):
                try:
                    os.remove(backup_file)
                    logger.info(f"Cleaned up trigger backup file")
                except Exception as e:
                    logger.warning(f"Could not remove trigger backup: {e}")

        except Exception as e:
            logger.error(f"Error restoring triggers: {e}")
        finally:
            if connection:
                connection.close()

    async def populate_sync_queue_from_flagged(self) -> int:
        """
        Populate shopify_sync_queue from all products with needs_sync = 1.
        This mimics trigger behavior for updates that occurred while triggers were disabled.
        Uses BATCHED operations for performance (processes 25k products in seconds instead of hours).
        Returns count of products queued.
        """
        if self.no_db:
            return 0

        connection = None
        synced_count = 0

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(dictionary=True, buffered=True)

            # Find all products that need syncing
            cursor.execute(f"""
                SELECT id, shopify_id, variant_id, part_number,
                       map_price, quantity, compare_at_price, sdw_cost
                FROM {self.mode_to_table[self.mode]}
                AND shopify_id IS NOT NULL
                AND variant_id IS NOT NULL
                ORDER BY id
            """)

            products_to_sync = cursor.fetchall()
            total_products = len(products_to_sync)

            if total_products == 0:
                logger.info("No products need syncing (needs_sync = 0 for all)")
                cursor.close()
                return 0

            logger.info(f"Populating sync queue for {total_products:,} flagged products using BATCHED operations...")
            logger.info("Processing in batches: Insert sync entries + Reset needs_sync atomically")

            # Process in batches to avoid lock contention with sync queue processor
            batch_size = 1000
            total_batches = (total_products + batch_size - 1) // batch_size
            total_queue_entries = 0
            reset_count = 0

            for batch_num in range(total_batches):
                start_idx = batch_num * batch_size
                end_idx = min(start_idx + batch_size, total_products)
                batch_products = products_to_sync[start_idx:end_idx]

                # STEP 1: Delete pending entries for this batch
                batch_shopify_ids = [p['shopify_id'] for p in batch_products]
                if batch_shopify_ids:
                    placeholders = ','.join(['%s'] * len(batch_shopify_ids))
                    cursor.execute(f"""
                        DELETE FROM shopify_sync_queue
                        WHERE shopify_id IN ({placeholders})
                        AND status = 'pending'
                    """, batch_shopify_ids)

                # STEP 2-4: Build and insert sync queue entries for this batch
                quantity_rows = []
                price_rows = []
                compare_price_rows = []
                cost_rows = []

                for p in batch_products:
                    if p['quantity'] is not None:
                        quantity_rows.append((p['shopify_id'], p['variant_id'], p['part_number'], p['quantity']))
                    if p['map_price'] and p['map_price'] > 0:
                        price_rows.append((p['shopify_id'], p['variant_id'], p['part_number'], p['map_price']))
                    if p['compare_at_price'] is not None:
                        compare_price_rows.append((p['shopify_id'], p['variant_id'], p['part_number'], p['compare_at_price']))
                    if p['sdw_cost'] and p['sdw_cost'] > 0:
                        cost_rows.append((p['shopify_id'], p['variant_id'], p['part_number'], p['sdw_cost']))

                # Insert all change types for this batch
                if quantity_rows:
                    cursor.executemany("""
                        INSERT INTO shopify_sync_queue
                        (shopify_id, variant_id, part_number, change_type, new_quantity)
                        VALUES (%s, %s, %s, 'quantity', %s)
                    """, quantity_rows)
                    total_queue_entries += len(quantity_rows)

                if price_rows:
                    cursor.executemany("""
                        INSERT INTO shopify_sync_queue
                        (shopify_id, variant_id, part_number, change_type, new_price)
                        VALUES (%s, %s, %s, 'price', %s)
                    """, price_rows)
                    total_queue_entries += len(price_rows)

                if compare_price_rows:
                    cursor.executemany("""
                        INSERT INTO shopify_sync_queue
                        (shopify_id, variant_id, part_number, change_type, new_compare_at_price)
                        VALUES (%s, %s, %s, 'compare_price', %s)
                    """, compare_price_rows)
                    total_queue_entries += len(compare_price_rows)

                if cost_rows:
                    cursor.executemany("""
                        INSERT INTO shopify_sync_queue
                        (shopify_id, variant_id, part_number, change_type, new_cost)
                        VALUES (%s, %s, %s, 'cost', %s)
                    """, cost_rows)
                    total_queue_entries += len(cost_rows)

                # STEP 5: IMMEDIATELY reset needs_sync for this batch (ATOMIC!)
                batch_product_ids = [p['id'] for p in batch_products]
                if batch_product_ids:
                    placeholders = ','.join(['%s'] * len(batch_product_ids))
                    cursor.execute(f"""
                        UPDATE {self.mode_to_table[self.mode]}
                        SET needs_sync = 0
                        WHERE id IN ({placeholders})
                    """, batch_product_ids)
                    reset_count += cursor.rowcount

                # COMMIT after each batch (release locks immediately!)
                connection.commit()

                # Log progress every 10 batches or last batch
                if (batch_num + 1) % 10 == 0 or (batch_num + 1) == total_batches:
                    progress = ((batch_num + 1) / total_batches) * 100
                    products_done = end_idx
                    logger.info(f"  Progress: Batch {batch_num + 1}/{total_batches} ({progress:.1f}%) - {products_done:,}/{total_products:,} products - {total_queue_entries:,} queue entries")

            logger.info(f"  ✓ Inserted {total_queue_entries:,} sync queue entries")
            logger.info(f"  ✓ Reset {reset_count:,} needs_sync flags")

            # Commit all changes
            connection.commit()
            cursor.close()

            synced_count = total_products
            total_entries = len(quantity_rows) + len(price_rows) + len(compare_price_rows) + len(cost_rows)
            logger.info(f"✓ Successfully queued {synced_count:,} products ({total_entries:,} sync queue entries) for Shopify sync")

            return synced_count

        except Exception as e:
            logger.error(f"Error populating sync queue from flagged products: {e}")
            import traceback
            traceback.print_exc()
            if connection:
                try:
                    connection.rollback()
                except:
                    pass
            return synced_count
        finally:
            if connection:
                connection.close()

    async def get_statistics(self) -> Dict:
        """Get processing statistics."""
        async with self._stats_lock:
            return dict(self._stats)

    # Keep existing functions for compatibility
    async def verify_updates(self, url_part: str, product_type: str) -> Dict:
        """Verify if the product exists and return its current data."""
        if self.no_db:
            return {"exists": False}
        
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(dictionary=True, buffered=True)
            query = f"""
                SELECT url_part_number, product_type, quantity, map_price, sdw_cost, last_modified
                FROM {self.mode_to_table[self.mode]}
                WHERE url_part_number = %s
                  AND product_type = %s
            """
            cursor.execute(query, (url_part, product_type))
            result = cursor.fetchone()
            cursor.close()
            return result or {"exists": False}
        except Exception as e:
            logger.error(f"Error in verify_updates: {e}")
            return {"error": str(e)}
        finally:
            if connection:
                connection.close()

    async def update_map_price_by_url(self, url_part: str, price: float, product_type: str) -> None:
        """Update MAP price for one product by url_part_number."""
        if self.no_db:
            return

        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            query = f"""
                UPDATE {self.mode_to_table[self.mode]}
                SET map_price = %s,
                    last_modified = NOW(),
                    last_sdw_sync = NOW()
                WHERE url_part_number = %s
                AND product_type = %s
            """
            cursor.execute(query, (price, url_part, product_type))
            rows_affected = cursor.rowcount
            connection.commit()
            cursor.close()
            logger.debug(f"Updated map_price for {url_part} to {price}, affected {rows_affected} rows")
        except Exception as e:
            logger.error(f"Error in update_map_price_by_url: {e}")
            raise e
        finally:
            if connection:
                connection.close()

    async def update_cost_by_url(self, url_part: str, cost: float, product_type: str) -> None:
        """Update cost for one product by url_part_number."""
        if self.no_db:
            return

        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            query = f"""
                UPDATE {self.mode_to_table[self.mode]}
                SET sdw_cost = %s,
                    last_modified = NOW(),
                    last_sdw_sync = NOW()
                WHERE url_part_number = %s
                AND product_type = %s
            """
            cursor.execute(query, (cost, url_part, product_type))
            rows_affected = cursor.rowcount
            connection.commit()
            cursor.close()
            logger.debug(f"Updated cost for {url_part} to {cost}, affected {rows_affected} rows")
        except Exception as e:
            logger.error(f"Error in update_cost_by_url: {e}")
            raise e
        finally:
            if connection:
                connection.close()

    async def update_quantity_by_url(self, url_part: str, quantity: int, product_type: str) -> None:
        """Update quantity for one product by url_part_number."""
        if self.no_db:
            return

        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            query = f"""
                UPDATE {self.mode_to_table[self.mode]}
                SET quantity = %s,
                    last_modified = NOW(),
                    last_sdw_sync = NOW()
                WHERE url_part_number = %s
                AND product_type = %s
            """
            cursor.execute(query, (quantity, url_part, product_type))
            rows_affected = cursor.rowcount
            connection.commit()
            cursor.close()
            logger.debug(f"Updated quantity for {url_part} to {quantity}")
        except Exception as e:
            logger.error(f"Error in update_quantity_by_url: {e}")
        finally:
            if connection:
                connection.close()

    async def bulk_update_quantity_zero(self, product_type: str, brand: str) -> None:
        """Set quantity=0 for all products of a given brand and product_type."""
        if self.no_db:
            return

        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            query = f"""
                UPDATE {self.mode_to_table[self.mode]}
                SET quantity = 0,
                    last_modified = NOW(),
                    last_sdw_sync = NOW()
                WHERE product_type = %s
                AND brand = %s
            """
            cursor.execute(query, (product_type, brand))
            rows_affected = cursor.rowcount
            connection.commit()
            cursor.close()
            logger.info(f"Bulk updated quantity=0 for brand {brand}, product_type={product_type}, rows={rows_affected}")
        except Exception as e:
            logger.error(f"Error in bulk_update_quantity_zero: {e}")
            raise e
        finally:
            if connection:
                connection.close()


    async def get_shopify_brands(self) -> List[str]:
        """Get distinct brands from shopify_products filtered by current product_type."""
        if self.no_db:
            logger.info("No-db mode: Returning empty brand list")
            return []
        
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            
            query = f"""
                SELECT DISTINCT brand
                FROM {self.mode_to_table[self.mode]}
                WHERE product_type = %s
                  AND brand IS NOT NULL
                  AND brand != ''
                ORDER BY brand
            """
            
            cursor.execute(query, (self._db_product_type(),))
            rows = cursor.fetchall()
            brands = [row[0] for row in rows if row[0]]
            cursor.close()
            
            logger.info(f"Found {len(brands)} brands in Shopify for product_type '{self._db_product_type()}'")
            return brands
            
        except Exception as e:
            logger.error(f"Error getting Shopify brands: {e}")
            return []
        finally:
            if connection:
                connection.close()

    async def set_brand_quantity_to_zero(self, brand: str) -> int:
        """Set quantity to 0 for all products of a specific brand and current product_type."""
        if self.no_db:
            logger.info(f"No-db mode: Would set quantity to 0 for brand '{brand}'")
            return 0

        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            query = f"""
                UPDATE {self.mode_to_table[self.mode]}
                SET quantity = 0,
                    last_modified = NOW(),
                    last_sdw_sync = NOW()
                WHERE brand = %s
                  AND product_type = %s
                  AND quantity > 0
            """

            cursor.execute(query, (brand, self._db_product_type()))
            affected_rows = cursor.rowcount
            connection.commit()
            cursor.close()

            if affected_rows > 0:
                logger.info(f"Set quantity to 0 for {affected_rows} products in brand '{brand}'")
            else:
                logger.debug(f"No products updated for brand '{brand}' (already at 0 or no products found)")

            async with self._stats_lock:
                self._stats['brand_zero_updates'] += affected_rows

            return affected_rows

        except Exception as e:
            logger.error(f"Error setting brand '{brand}' to zero quantity: {e}")
            return 0
        finally:
            if connection:
                connection.close()

                
    async def close(self) -> None:
        if self.no_db:
            return

        logger.info("Closing database connections...")

        # Print final statistics
        stats = await self.get_statistics()
        if stats:
            logger.info(f"Final DB statistics: {dict(stats)}")

        try:
            if hasattr(self.connection_pool, 'close'):
                self.connection_pool.close()
                logger.info("Connection pool closed")
        except Exception as e:
            logger.error(f"Error closing connection pool: {e}")

    async def restore_ended_sale_prices(self, brands: List[str], scraped_parts: List[str]) -> int:
        """
        Restore original prices for products no longer on sale (brand-aware version).

        For products from specified brands that were NOT scraped in this run:
        - Only updates products where compare_at_price > map_price
        - Sets map_price = compare_at_price (restore original price)
        - Sets compare_at_price = NULL (remove sale indicator)

        Triggers will handle adding to shopify_sync_queue.

        Args:
            brands: List of brand names to process
            scraped_parts: List of url_part_numbers that were scraped (exclude these)

        Returns:
            Number of products with prices restored
        """
        if self.no_db or not brands:
            return 0

        product_type = self._db_product_type()
        connection = None
        total_restored = 0

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Create temp table for scraped parts (products to EXCLUDE)
            if scraped_parts:
                logger.debug(f"Creating temp table with {len(scraped_parts)} scraped products to exclude...")

                cursor.execute("""
                    CREATE TEMPORARY TABLE temp_scraped_exclude (
                        url_part_number VARCHAR(255) PRIMARY KEY
                    )
                """)

                # Batch insert scraped parts
                batch_size = 1000
                for i in range(0, len(scraped_parts), batch_size):
                    batch = scraped_parts[i:i+batch_size]
                    placeholders = ','.join(['(%s)'] * len(batch))
                    insert_query = f"INSERT IGNORE INTO temp_scraped_exclude (url_part_number) VALUES {placeholders}"
                    cursor.execute(insert_query, batch)

                connection.commit()

            # Create temp table for brands to process
            logger.debug(f"Creating temp table with {len(brands)} brands...")

            cursor.execute("""
                CREATE TEMPORARY TABLE temp_restore_brands (
                    brand VARCHAR(255) PRIMARY KEY
                )
            """)

            # Insert brands
            placeholders = ','.join(['(%s)'] * len(brands))
            insert_query = f"INSERT IGNORE INTO temp_restore_brands (brand) VALUES {placeholders}"
            cursor.execute(insert_query, brands)
            connection.commit()

            # Count candidates for price restoration
            if scraped_parts:
                # Exclude scraped parts using LEFT JOIN
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    LEFT JOIN temp_scraped_exclude e ON p.url_part_number = e.url_part_number
                    WHERE e.url_part_number IS NULL
                    AND p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """
            else:
                # No exclusions needed
                count_query = f"""
                    SELECT COUNT(*)
                    FROM {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    WHERE p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """

            cursor.execute(count_query, [product_type])
            result = cursor.fetchone()
            candidates = result[0] if result else 0

            if candidates == 0:
                logger.debug("No products need price restoration")
                # Clean up temp tables
                cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_restore_brands")
                if scraped_parts:
                    cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_scraped_exclude")
                cursor.close()
                return 0

            logger.info(f"Found {candidates} products with ended sales (compare_at_price > map_price)")

            # Perform the restoration in efficient batches
            if scraped_parts:
                # Use LEFT JOIN to exclude scraped parts
                update_query = f"""
                    UPDATE {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    LEFT JOIN temp_scraped_exclude e ON p.url_part_number = e.url_part_number
                    SET
                        p.map_price = p.compare_at_price,
                        p.compare_at_price = NULL,
                        p.last_modified = NOW(),
                        p.last_sdw_sync = NOW()
                    WHERE e.url_part_number IS NULL
                    AND p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """
            else:
                # Simple update with just brand filter
                update_query = f"""
                    UPDATE {self.mode_to_table[self.mode]} p
                    INNER JOIN temp_restore_brands b ON p.brand = b.brand
                    SET
                        p.map_price = p.compare_at_price,
                        p.compare_at_price = NULL,
                        p.last_modified = NOW(),
                        p.last_sdw_sync = NOW()
                    WHERE p.product_type = %s
                    AND p.compare_at_price IS NOT NULL
                    AND p.map_price IS NOT NULL
                    AND p.compare_at_price > p.map_price
                """

            cursor.execute(update_query, [product_type])
            total_restored = cursor.rowcount
            connection.commit()

            # Clean up temp tables
            cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_restore_brands")
            if scraped_parts:
                cursor.execute("DROP TEMPORARY TABLE IF EXISTS temp_scraped_exclude")

            cursor.close()

            if total_restored > 0:
                logger.info(f"✓ Restored prices for {total_restored} products (sale ended)")
                logger.info(f"  Triggers will queue these products for Shopify sync")

            return total_restored

        except Exception as e:
            logger.error(f"Error restoring ended sale prices: {e}")
            import traceback
            traceback.print_exc()
            if connection:
                try:
                    connection.rollback()
                except:
                    pass
            return 0
        finally:
            if connection:
                connection.close()

    async def disable_triggers(self) -> List[Dict]:
        """Disable all triggers on shopify_products table and return DDL for restoration.

        IMPORTANT: Saves triggers to backup file for crash recovery.
        """
        if self.no_db:
            return []

        saved_triggers = []
        connection = None

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            # Get trigger definitions
            cursor.execute(f"""
                SELECT TRIGGER_NAME
                FROM information_schema.TRIGGERS
                WHERE EVENT_OBJECT_TABLE = '{self.mode_to_table[self.mode]}'
                AND EVENT_OBJECT_SCHEMA = DATABASE()
            """)
            triggers_info = cursor.fetchall()

            if triggers_info:
                logger.info(f"Disabling {len(triggers_info)} trigger(s) for performance...")

                for (trigger_name,) in triggers_info:
                    try:
                        # Get full CREATE TRIGGER statement
                        cursor.execute(f"SHOW CREATE TRIGGER {trigger_name}")
                        result = cursor.fetchone()
                        if result:
                            create_statement = result[2] if len(result) > 2 else None
                            if create_statement:
                                saved_triggers.append({
                                    'name': trigger_name,
                                    'create_sql': create_statement
                                })
                                # Drop the trigger
                                cursor.execute(f"DROP TRIGGER IF EXISTS {trigger_name}")
                                connection.commit()
                    except Exception as e:
                        logger.warning(f"Could not disable trigger {trigger_name}: {e}")

                if saved_triggers:
                    # CRITICAL: Save to file for crash recovery
                    import json
                    from datetime import datetime
                    backup_file = 'triggers_backup.json'
                    try:
                        with open(backup_file, 'w') as f:
                            json.dump({
                                'timestamp': datetime.now().isoformat(),
                                'mode': self.mode,
                                'triggers': saved_triggers
                            }, f, indent=2)
                        logger.info(f"✓ Disabled {len(saved_triggers)} trigger(s) (backup saved to {backup_file})")
                    except Exception as e:
                        logger.error(f"⚠️  Failed to save trigger backup: {e}")
                        # Still return triggers for in-memory restoration
                        logger.info(f"✓ Disabled {len(saved_triggers)} trigger(s)")

            cursor.close()
            return saved_triggers

        except Exception as e:
            logger.warning(f"Could not disable triggers: {e}")
            return []
        finally:
            if connection:
                connection.close()

    async def restore_triggers(self, saved_triggers: List[Dict]) -> None:
        """Restore triggers that were disabled."""
        if self.no_db or not saved_triggers:
            return

        connection = None

        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)

            logger.info(f"Re-enabling {len(saved_triggers)} trigger(s)...")

            for trigger_info in saved_triggers:
                try:
                    cursor.execute(trigger_info['create_sql'])
                    connection.commit()
                except Exception as e:
                    logger.error(f"Error restoring trigger {trigger_info['name']}: {e}")

            logger.info(f"✓ Re-enabled all {len(saved_triggers)} trigger(s)")
            cursor.close()

            # Clean up backup file after successful restoration
            import os
            backup_file = 'triggers_backup.json'
            if os.path.exists(backup_file):
                try:
                    os.remove(backup_file)
                    logger.debug(f"Deleted trigger backup file: {backup_file}")
                except:
                    pass

        except Exception as e:
            logger.error(f"Error restoring triggers: {e}")
        finally:
            if connection:
                connection.close()

print("Creating optimized database client instance...")
db_client = DatabaseClient()
print("Database client instance created")