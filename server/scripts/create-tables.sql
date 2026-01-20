-- TFS Manager Database Schema
-- Run this SQL script on the NEW tfs-manager database instance
-- This keeps the existing tfs-db database separate for TFS Wheels App

-- Shops table (for storing Shopify shop configuration)
CREATE TABLE IF NOT EXISTS shops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL UNIQUE,
  access_token VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shop_name (shop_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders table (synced from Shopify)
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  shopify_order_id BIGINT NOT NULL UNIQUE,
  order_number VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  total_price DECIMAL(10, 2),
  financial_status VARCHAR(50),
  fulfillment_status VARCHAR(50),
  tags TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shopify_order_id (shopify_order_id),
  INDEX idx_customer_email (customer_email),
  INDEX idx_financial_status (financial_status),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Order items table (line items from orders)
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  order_id INT,
  shopify_order_id BIGINT NOT NULL,
  product_id BIGINT,
  variant_id BIGINT,
  title VARCHAR(500),
  quantity INT,
  price DECIMAL(10, 2),
  vendor VARCHAR(255),
  product_type VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_id (order_id),
  INDEX idx_shopify_order_id (shopify_order_id),
  INDEX idx_product_id (product_id),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Products table (synced from Shopify)
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  shopify_product_id BIGINT NOT NULL UNIQUE,
  title VARCHAR(500),
  vendor VARCHAR(255),
  product_type VARCHAR(255),
  tags TEXT,
  image_url VARCHAR(1000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shopify_product_id (shopify_product_id),
  INDEX idx_vendor (vendor),
  INDEX idx_product_type (product_type),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email templates table
CREATE TABLE IF NOT EXISTS email_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  body TEXT,
  template_type VARCHAR(100),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shop_id (shop_id),
  INDEX idx_template_type (template_type),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email logs table (track all sent emails)
CREATE TABLE IF NOT EXISTS email_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  order_id INT,
  recipient_email VARCHAR(255),
  recipient_name VARCHAR(255),
  subject VARCHAR(500),
  body TEXT,
  status VARCHAR(50) DEFAULT 'sent',
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_shop_id (shop_id),
  INDEX idx_order_id (order_id),
  INDEX idx_recipient_email (recipient_email),
  INDEX idx_sent_at (sent_at),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Processing logs table (SDW automation, selective processing)
CREATE TABLE IF NOT EXISTS processing_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  order_id INT,
  processing_type VARCHAR(100),
  status VARCHAR(50),
  invoice_number VARCHAR(100),
  details TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_shop_id (shop_id),
  INDEX idx_order_id (order_id),
  INDEX idx_processing_type (processing_type),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scraping jobs table (inventory scraping tracking)
CREATE TABLE IF NOT EXISTS scraping_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  scraper_type VARCHAR(100),
  config TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  products_found INT DEFAULT 0,
  products_created INT DEFAULT 0,
  products_updated INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_shop_id (shop_id),
  INDEX idx_scraper_type (scraper_type),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shop settings table
CREATE TABLE IF NOT EXISTS shop_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT NOT NULL UNIQUE,
  email_from_name VARCHAR(255) DEFAULT 'TFS Wheels',
  email_reply_to VARCHAR(255) DEFAULT 'support@tfswheels.com',
  notification_email VARCHAR(255) DEFAULT 'support@tfswheels.com',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GDPR requests table (compliance tracking)
CREATE TABLE IF NOT EXISTS gdpr_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_domain VARCHAR(255) NOT NULL,
  request_type VARCHAR(50) NOT NULL,
  customer_email VARCHAR(255),
  customer_id BIGINT,
  orders_requested TEXT,
  request_data TEXT,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_shop_domain (shop_domain),
  INDEX idx_request_type (request_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default shop (TFS Wheels)
INSERT INTO shops (shop_name, created_at, updated_at)
VALUES ('2f3d7a-2.myshopify.com', NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();

-- Get the shop ID for default values
SET @shop_id = (SELECT id FROM shops WHERE shop_name = '2f3d7a-2.myshopify.com');

-- Insert default shop settings
INSERT INTO shop_settings (shop_id, email_from_name, email_reply_to, notification_email)
VALUES (@shop_id, 'TFS Wheels', 'support@tfswheels.com', 'support@tfswheels.com')
ON DUPLICATE KEY UPDATE updated_at = NOW();

-- Insert default email templates
INSERT INTO email_templates (shop_id, name, subject, body, template_type, is_default)
VALUES
  (@shop_id, 'Incorrect Fitment', 'Update Required: Vehicle Information',
   'Hello {{customer_name}},\n\nWe need to verify the vehicle information for your order {{order_number}}.\n\nPlease reply with your vehicle details.\n\nThank you,\nTFS Wheels Team',
   'incorrect_fitment', TRUE),
  (@shop_id, 'Order Ready', 'Your Order is Ready!',
   'Hello {{customer_name}},\n\nGreat news! Your order {{order_number}} is ready for pickup/shipping.\n\nThank you for your business!\n\nTFS Wheels Team',
   'order_ready', TRUE),
  (@shop_id, 'Vehicle Request', 'Vehicle Information Needed',
   'Hello {{customer_name}},\n\nTo process your order {{order_number}}, we need your vehicle information.\n\nPlease provide:\n- Year\n- Make\n- Model\n- Trim\n\nThank you,\nTFS Wheels Team',
   'vehicle_request', TRUE)
ON DUPLICATE KEY UPDATE updated_at = NOW();

SELECT 'Database tables created successfully!' as Status;
