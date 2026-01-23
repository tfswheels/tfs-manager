-- Migration 006: Drop orphaned products table
-- Reason: Product webhooks were saving to a redundant table in tfs-manager database
-- while actual inventory lives in tfs-db.shopify_products (220K+ rows with comprehensive data)
-- This table was orphaned (unused by any code) and created data inconsistency risk.

-- Drop the products table
DROP TABLE IF EXISTS products;

-- Verify completion
SELECT 'Products table dropped successfully - product webhook system removed' AS Status;
