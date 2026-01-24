-- Migration: Add detailed stats columns to product_creation_jobs table
-- This adds columns to track skipped and failed products separately

USE `tfs-manager`;

-- Add products_skipped column
ALTER TABLE product_creation_jobs
ADD COLUMN IF NOT EXISTS products_skipped INT DEFAULT 0 COMMENT 'Number of products skipped (already exist on Shopify)';

-- Add products_failed column
ALTER TABLE product_creation_jobs
ADD COLUMN IF NOT EXISTS products_failed INT DEFAULT 0 COMMENT 'Number of products that failed to create';

-- Add wheels_skipped column
ALTER TABLE product_creation_jobs
ADD COLUMN IF NOT EXISTS wheels_skipped INT DEFAULT 0 COMMENT 'Number of wheels skipped';

-- Add tires_skipped column
ALTER TABLE product_creation_jobs
ADD COLUMN IF NOT EXISTS tires_skipped INT DEFAULT 0 COMMENT 'Number of tires skipped';

-- Add wheels_failed column
ALTER TABLE product_creation_jobs
ADD COLUMN IF NOT EXISTS wheels_failed INT DEFAULT 0 COMMENT 'Number of wheels that failed';

-- Add tires_failed column
ALTER TABLE product_creation_jobs
ADD COLUMN IF NOT EXISTS tires_failed INT DEFAULT 0 COMMENT 'Number of tires that failed';

-- Update existing rows to have 0 for new columns (if not already set)
UPDATE product_creation_jobs
SET products_skipped = COALESCE(products_skipped, 0),
    products_failed = COALESCE(products_failed, 0),
    wheels_skipped = COALESCE(wheels_skipped, 0),
    tires_skipped = COALESCE(tires_skipped, 0),
    wheels_failed = COALESCE(wheels_failed, 0),
    tires_failed = COALESCE(tires_failed, 0)
WHERE products_skipped IS NULL
   OR products_failed IS NULL
   OR wheels_skipped IS NULL
   OR tires_skipped IS NULL
   OR wheels_failed IS NULL
   OR tires_failed IS NULL;
