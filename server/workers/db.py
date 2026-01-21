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

# Load environment variables from multiple possible locations
# 1. Try project root (for Railway/production)
project_root = pathlib.Path(__file__).parent.parent.parent
project_env = project_root / ".env"
if project_env.exists():
    load_dotenv(project_env)
else:
    # 2. Try hardcoded path (for local development)
    dotenv_path = "/Users/jeremiah/Desktop/TFS Wheels/Scripts/.env"
    if os.path.exists(dotenv_path):
        load_dotenv(dotenv_path)
    # 3. Railway will provide env vars directly, so load_dotenv can fail gracefully

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
        unmatched_products = []       # New products to store
        skipped_unchanged = 0         # Track products skipped due to no changes

        for product in products:
            url_part = product.get('url_part_number')
            if url_part:
                # Use brand-agnostic cache for matching (fixes brand name variations)
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
                            matched_full_update.append(product)
                        else:
                            # No changes detected - skip this product
                            skipped_unchanged += 1
                    else:
                        # No cached data - proceed with update (shouldn't happen but be safe)
                        matched_full_update.append(product)
                else:
                    # New product
                    unmatched_products.append(product)

        # DIAGNOSTIC: Log matching statistics
        logger.debug(f"Batch categorization: {len(matched_full_update)} matched (update), "
                    f"{len(unmatched_products)} unmatched (new), "
                    f"{skipped_unchanged} skipped (unchanged)")

        # Log efficiency improvement if significant
        if skipped_unchanged > 0:
            total_processed = len(matched_full_update) + skipped_unchanged
            if total_processed > 0:
                skip_pct = (skipped_unchanged / total_processed) * 100
                if skip_pct > 10:  # Only log if more than 10% were skipped
                    logger.info(f"Efficiency: Skipped {skipped_unchanged}/{total_processed} ({skip_pct:.1f}%) unchanged products")

        if not matched_full_update and not unmatched_products:
            logger.debug("No products to process")
            return 0, 0

        total_updates = 0
        total_stored = 0

        # Process matched products
        if matched_full_update:
            # Prepare data for batch update
            url_parts = []
            quantities = []
            prices = []
            costs = []
            
            for product in matched_products:
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
                    
                    url_parts.append(url_part)
                    quantities.append(quantity)
                    prices.append(price)
                    costs.append(cost)
                    
                except (ValueError, TypeError) as e:
                    logger.debug(f"Error parsing product data for {url_part}: {e}")
                    continue
            
            if url_parts:
                matched_updates = await self._optimized_batch_update(url_parts, quantities, prices, costs)
                total_updates += matched_updates
                logger.info(f"💾 Batch: {len(products)} products -> {matched_updates} updated, {skipped_unchanged} skipped")

                # Update cache with new values to keep it in sync
                for idx, url_part in enumerate(url_parts):
                    if url_part in self._product_data_cache:
                        self._product_data_cache[url_part]['quantity'] = quantities[idx]
                        if prices[idx] is not None:
                            self._product_data_cache[url_part]['price'] = prices[idx]

        # Process unmatched products (new products to store)
        if unmatched_products:
            stored_count = await self._store_new_products(unmatched_products)
            total_stored += stored_count
            logger.debug(f"Stored {stored_count} new products in not_scraped table")

        return total_updates, total_stored

    async def _store_new_products(self, products: List[Dict]) -> int:
        """Store new products (not in main database) to not_scraped table."""
        if self.no_db or not products:
            return 0
        
        # Filter products with valid data (non-zero quantity and has pricing)
        valid_products = []
        for product in products:
            try:
                # Parse quantity - only store if quantity > 0 (not backordered)
                qty_str = product.get('quantity', '').replace(',', '') if product.get('quantity') else '0'
                quantity = int(qty_str) if qty_str.isdigit() else 0
                
                # Parse prices
                price_str = product.get('price_map', '')
                price = float(price_str) if price_str and price_str.replace('.', '').isdigit() else None
                
                cost_str = product.get('cost', '')
                cost = float(cost_str) if cost_str and cost_str.replace('.', '').isdigit() else None
                
                # Only store if quantity > 0 and has at least one price
                if quantity > 0 and (price is not None or cost is not None):
                    valid_products.append({
                        'brand': product.get('brand', ''),
                        'part_number': product.get('url_part_number', ''),
                        'url_part_number': product.get('url_part_number', ''),
                        'quantity': quantity,
                        'map_price': price,
                        'sdw_cost': cost,
                        'url': product.get('url', ''),
                        'product_type': self._db_product_type()  # ADD THIS LINE
                    })
                    
            except (ValueError, TypeError) as e:
                logger.debug(f"Error parsing new product data: {e}")
                continue
        
        if not valid_products:
            logger.debug("No valid new products to store")
            return 0
        
        # Batch insert/update to not_scraped table
        batch_size = 100
        total_stored = 0
        
        for i in range(0, len(valid_products), batch_size):
            batch = valid_products[i:i+batch_size]
            
            connection = None
            try:
                connection = await self._get_connection()
                cursor = connection.cursor(buffered=True)
                
                # UPDATE THE QUERY TO INCLUDE product_type
                placeholders = "(%s, %s, %s, %s, %s, %s, %s, %s)"  # Added one more %s
                values_clause = ", ".join([placeholders] * len(batch))
                
                query = f"""
                    INSERT INTO not_scraped 
                    (brand, part_number, url_part_number, quantity, map_price, sdw_cost, url, product_type)
                    VALUES {values_clause}
                    ON DUPLICATE KEY UPDATE
                        quantity = VALUES(quantity),
                        map_price = VALUES(map_price),
                        sdw_cost = VALUES(sdw_cost),
                        url = VALUES(url),
                        product_type = VALUES(product_type)
                """
                
                # Flatten product data for query
                params = []
                for product in batch:
                    params.extend([
                        product['brand'],
                        product['part_number'],
                        product['url_part_number'],
                        product['quantity'],
                        product['map_price'],
                        product['sdw_cost'],
                        product['url'],
                        product['product_type']  # ADD THIS LINE
                    ])
                
                cursor.execute(query, params)
                affected = cursor.rowcount
                total_stored += affected
                connection.commit()
                cursor.close()
                
                logger.debug(f"Stored/updated {affected} new products (batch {i//batch_size + 1})")
                
            except Exception as e:
                logger.error(f"Error storing new products batch: {e}")
            finally:
                if connection:
                    connection.close()
        
        return total_stored

    async def _optimized_batch_update(self, url_parts: List[str], quantities: List[int], 
                                    prices: List[Optional[float]], costs: List[Optional[float]]) -> int:
        """Highly optimized batch update with single transaction."""
        if not url_parts:
            return 0
        
        product_type = self._db_product_type()
        batch_size = 300  # Optimized batch size
        total_updates = 0
        
        for i in range(0, len(url_parts), batch_size):
            batch_urls = url_parts[i:i+batch_size]
            batch_quantities = quantities[i:i+batch_size]
            batch_prices = prices[i:i+batch_size]
            batch_costs = costs[i:i+batch_size]
            
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
                
                connection.commit()
                cursor.close()
                
                async with self._stats_lock:
                    self._stats['batch_updates'] += 1
                    self._stats['products_updated'] += batch_updates
                
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
        """Optimized batch zero quantity update."""
        if self.no_db or not url_parts:
            return 0
        
        product_type = self._db_product_type()
        batch_size = 500
        total_affected = 0
        
        for i in range(0, len(url_parts), batch_size):
            batch = url_parts[i:i+batch_size]
            
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
                """
                params = batch + [product_type]
                cursor.execute(query, params)
                affected = cursor.rowcount
                total_affected += affected
                connection.commit()
                cursor.close()
                
                logger.debug(f"Set {affected} products to quantity 0 (batch {i//batch_size + 1})")

            except Exception as e:
                logger.error(f"Error in batch_set_zero_quantity: {e}")
            finally:
                if connection:
                    connection.close()

        return total_affected

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

    async def restore_ended_sale_prices(self, brands: List[str], scraped_parts: List[str]) -> int:
        """
        Restore original prices for products no longer on sale (brand-aware version).

        For products from specified brands that were NOT scraped in this run:
        - Only updates products where compare_at_price > map_price
        - Sets map_price = compare_at_price (restore original price)
        - Sets compare_at_price = NULL (remove sale indicator)

        Triggers will handle adding to shopify_sync_queue.
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
                    logger.info(f"Cleaned up trigger backup file")
                except Exception as e:
                    logger.warning(f"Could not remove trigger backup: {e}")

        except Exception as e:
            logger.error(f"Error restoring triggers: {e}")
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

print("Creating optimized database client instance...")
db_client = DatabaseClient()
print("Database client instance created")