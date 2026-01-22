-- Migration 005: Scheduled Jobs System
-- Separates scraping from product creation with scheduled job support

-- ====================
-- SCHEDULED SCRAPE JOBS
-- ====================
-- Named scraping jobs that run on a schedule
CREATE TABLE IF NOT EXISTS scheduled_scrape_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,

  -- Job configuration
  name VARCHAR(255) NOT NULL COMMENT 'Human-readable job name (e.g., "All Brands Daily", "Premium Brands 4hr")',
  scraper_type VARCHAR(100) NOT NULL COMMENT 'wheels or tires',
  schedule_interval INT NOT NULL COMMENT 'Interval in hours (2, 4, 12, 24, etc.)',

  -- Scraping configuration (JSON blob with all settings)
  config JSON NOT NULL COMMENT 'Scraping configuration including brands, filters, etc.',

  -- Status
  enabled BOOLEAN DEFAULT TRUE COMMENT 'Whether this scheduled job is active',
  last_run_at TIMESTAMP NULL COMMENT 'Last time this job was executed',
  next_run_at TIMESTAMP NULL COMMENT 'Next scheduled run time',
  last_run_job_id INT NULL COMMENT 'Reference to the last scraping_jobs entry',

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_shop_id (shop_id),
  INDEX idx_enabled (enabled),
  INDEX idx_next_run_at (next_run_at),
  INDEX idx_scraper_type (scraper_type),

  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Scheduled scraping jobs that run at specified intervals';

-- ====================
-- PRODUCT CREATION JOBS
-- ====================
-- Tracks automated product creation from scraped data
CREATE TABLE IF NOT EXISTS product_creation_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,

  -- Job configuration
  max_products_per_run INT DEFAULT 1000 COMMENT 'Max products to create per execution',
  schedule_interval INT DEFAULT 24 COMMENT 'Interval in hours (defaults to 24)',

  -- Product type breakdown
  max_wheels_per_run INT DEFAULT NULL COMMENT 'Max wheels to create (NULL = no limit, controlled by max_products_per_run)',
  max_tires_per_run INT DEFAULT NULL COMMENT 'Max tires to create (NULL = no limit, controlled by max_products_per_run)',

  -- Execution tracking
  status VARCHAR(50) DEFAULT 'pending' COMMENT 'pending, running, completed, failed',
  products_created INT DEFAULT 0 COMMENT 'Total products created this run',
  wheels_created INT DEFAULT 0 COMMENT 'Wheels created this run',
  tires_created INT DEFAULT 0 COMMENT 'Tires created this run',

  -- Timing
  last_run_at TIMESTAMP NULL COMMENT 'Last execution time',
  next_run_at TIMESTAMP NULL COMMENT 'Next scheduled execution',
  started_at TIMESTAMP NULL COMMENT 'When current run started',
  completed_at TIMESTAMP NULL COMMENT 'When current run completed',

  -- Status
  enabled BOOLEAN DEFAULT TRUE COMMENT 'Whether automatic creation is enabled',
  error_message TEXT NULL COMMENT 'Error details if job failed',

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_shop_id (shop_id),
  INDEX idx_status (status),
  INDEX idx_enabled (enabled),
  INDEX idx_next_run_at (next_run_at),
  INDEX idx_created_at (created_at),

  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Tracks scheduled product creation jobs that push scraped data to Shopify';

-- ====================
-- UPDATE EXISTING TABLE
-- ====================
-- Add columns to scraping_jobs to differentiate scrape-only vs scrape-and-create
ALTER TABLE scraping_jobs
ADD COLUMN IF NOT EXISTS scheduled_job_id INT NULL COMMENT 'Reference to scheduled_scrape_jobs if this was a scheduled run',
ADD COLUMN IF NOT EXISTS products_scraped INT DEFAULT 0 COMMENT 'Products found during scraping (before creation)',
ADD INDEX idx_scheduled_job_id (scheduled_job_id);

-- ====================
-- DEFAULT PRODUCT CREATION JOB
-- ====================
-- Insert default product creation schedule (1000 products per 24 hours)
INSERT INTO product_creation_jobs (
  shop_id,
  max_products_per_run,
  schedule_interval,
  enabled,
  next_run_at,
  created_at
)
SELECT
  id,
  1000,
  24,
  TRUE,
  DATE_ADD(NOW(), INTERVAL 24 HOUR),
  NOW()
FROM shops
WHERE shop_name = '2f3d7a-2.myshopify.com'
ON DUPLICATE KEY UPDATE updated_at = NOW();

SELECT 'Migration 005: Scheduled Jobs System - Completed!' as Status;
