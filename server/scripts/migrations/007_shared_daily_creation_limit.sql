-- Migration 007: Create shared daily Shopify product creation limit
-- Replaces per-product-type limits with a single shared 1000/day limit

-- Create new table for shared daily limit tracking
CREATE TABLE IF NOT EXISTS daily_shopify_creation_limit (
  date DATE PRIMARY KEY,
  total_created INT DEFAULT 0,
  wheels_created INT DEFAULT 0,
  tires_created INT DEFAULT 0,
  limit_per_day INT DEFAULT 1000,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert today's row if it doesn't exist
INSERT IGNORE INTO daily_shopify_creation_limit (date, total_created, wheels_created, tires_created)
VALUES (CURDATE(), 0, 0, 0);

-- Note: Keep product_creation_tracker table for now (used by scraping for per-type tracking)
-- but it will no longer be used for Shopify creation limits

SELECT 'Shared daily creation limit system created' AS Status;
