-- Migration: Add detailed stats columns to product_creation_jobs table
-- This adds columns to track skipped and failed products separately

-- Add products_skipped column
ALTER TABLE product_creation_jobs
ADD COLUMN products_skipped INT DEFAULT 0 COMMENT 'Number of products skipped (already exist on Shopify)';

-- Add products_failed column
ALTER TABLE product_creation_jobs
ADD COLUMN products_failed INT DEFAULT 0 COMMENT 'Number of products that failed to create';

-- Add wheels_skipped column
ALTER TABLE product_creation_jobs
ADD COLUMN wheels_skipped INT DEFAULT 0 COMMENT 'Number of wheels skipped';

-- Add tires_skipped column
ALTER TABLE product_creation_jobs
ADD COLUMN tires_skipped INT DEFAULT 0 COMMENT 'Number of tires skipped';

-- Add wheels_failed column
ALTER TABLE product_creation_jobs
ADD COLUMN wheels_failed INT DEFAULT 0 COMMENT 'Number of wheels that failed';

-- Add tires_failed column
ALTER TABLE product_creation_jobs
ADD COLUMN tires_failed INT DEFAULT 0 COMMENT 'Number of tires that failed';
