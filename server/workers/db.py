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
        self._url_parts_cache = {}  # brand -> set of url_parts
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
        """Prefetch and cache URL parts for all brands to avoid repeated DB queries."""
        if self.no_db:
            logger.info("No-db mode: Skipping prefetch_url_parts")
            return
            
        logger.info(f"Prefetching URL parts for {len(brands)} brands...")
        start_time = time.time()
        
        connection = None
        try:
            connection = await self._get_connection()
            cursor = connection.cursor(buffered=True)
            
            # Get all URL parts for all brands in a single query
            placeholders = ', '.join(['%s'] * len(brands))
            query = f"""
                SELECT brand, url_part_number
                FROM {self.mode_to_table[self.mode]}
                WHERE brand IN ({placeholders})
                  AND url_part_number IS NOT NULL
                  AND product_type = %s
            """
            
            params = list(brands) + [self._db_product_type()]
            cursor.execute(query, params)
            
            # Build cache
            self._url_parts_cache = {brand: set() for brand in brands}
            row_count = 0
            
            for row in cursor:
                brand, url_part = row
                if brand in self._url_parts_cache:
                    self._url_parts_cache[brand].add(url_part)
                    row_count += 1
            
            cursor.close()
            self._cache_loaded = True
            
            elapsed = time.time() - start_time
            logger.info(f"Prefetched {row_count} URL parts for {len(brands)} brands in {elapsed:.2f}s")
            
        except Exception as e:
            logger.error(f"Error prefetching URL parts: {e}")
            # Initialize empty cache as fallback
            self._url_parts_cache = {brand: set() for brand in brands}
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
        
        # Filter products that exist in our database vs new products
        matched_products = []
        unmatched_products = []
        
        for product in products:
            brand = product.get('brand')
            url_part = product.get('url_part_number')
            if brand and url_part:
                if url_part in self.get_cached_url_parts(brand):
                    matched_products.append(product)
                else:
                    unmatched_products.append(product)
        
        if not matched_products and not unmatched_products:
            logger.debug("No products to process")
            return 0, 0
        
        total_updates = 0
        total_stored = 0
        
        # Process matched products (existing logic)
        if matched_products:
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
        
        # Process unmatched products (new products to store)
        if unmatched_products:
            stored_count = await self._store_new_products(unmatched_products)
            total_stored += stored_count
            logger.info(f"Stored {stored_count} new products in not_scraped table")
        
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