# Enhanced CWO Scraper - User Guide

## Overview

The Enhanced CWO Scraper combines inventory scraping with automated product discovery and creation. It automatically finds new products on CustomWheelOffset.com and creates them in your database and on Shopify.

## Quick Start

```bash
# Navigate to the directory
cd "/Users/jeremiah/Desktop/TFS Wheels/Scripts/Inventory Scraping/Wheels Inventory"

# Run wheels mode
python -m enhanced_cwo.main --wheels

# Run tires mode
python -m enhanced_cwo.main --tires
```

## Command Line Options

```bash
# Basic Usage
python -m enhanced_cwo.main --wheels              # Scrape wheels
python -m enhanced_cwo.main --tires               # Scrape tires

# Additional Options
python -m enhanced_cwo.main --wheels --sale-only          # Only sale items
python -m enhanced_cwo.main --wheels --no-discovery       # Disable product creation
python -m enhanced_cwo.main --wheels --no-shopify-sync    # Skip Shopify table sync
python -m enhanced_cwo.main --wheels --headed             # Show browser
python -m enhanced_cwo.main --wheels --resume             # Resume from checkpoint
```

## Workflow Steps

The scraper runs through these steps automatically:

### Step 0: Retry Failed Products (if enabled)
- Finds products from previous runs with `product_sync='error'` or `'pending'`
- Attempts to create them on Shopify again
- Respects daily limit (1000 products/24 hours)

### Step 1: Sync Shopify Product Tables (if enabled)
- Fetches ALL products from Shopify (GraphQL)
- Updates `all_shopify_wheels` or `shopify_tires` table
- Ensures tables perfectly match current Shopify state
- **Time**: ~1-2 minutes for 5,000 products

### Step 2: Scrape CWO Inventory
- Scrapes product listing pages on CustomWheelOffset.com
- Updates quantities and prices for existing products
- Identifies new products not in our system
- **Time**: Depends on number of pages (20 concurrent workers)

### Step 3: Discover New Products
- For each scraped product, checks:
  1. Exists in `all_shopify_wheels` / `shopify_tires`? → Skip
  2. Exists in `shopify_products`? → Skip
  3. Exists in `wheels` / `tires` table?
     - If `product_sync='synced'` → Skip
     - If `product_sync='error'` or `'pending'` → Retry
     - If doesn't exist → Discover

### Step 4: Extract Product Data
- Opens product pages for new products
- Extracts Klaviyo JSON data (comprehensive product info)
- Extracts images from DOM
- **Concurrent**: 10 products at a time
- **Time**: ~5-10 seconds per product

### Step 5: Create Products
- Processes images:
  - Changes URL from `wheels-compressed` to `wheels`
  - Downloads image
  - Checks for "coming soon" text (OCR)
  - Uploads to GCS bucket
- Creates in `wheels` / `tires` table (all fields populated)
- Creates on Shopify (GraphQL)
- Inserts into `shopify_products` table
- **Daily Limit**: Max 1000 products per 24 hours

### Step 6: Update Inventory
- Zeros out products not found during scraping
- Updates `shopify_sync_queue` for price/quantity changes

## Daily Limit System

The scraper enforces a **1000 products per 24 hours** limit:

**How it works:**
- First product created → 24-hour window starts
- Each creation → counter increments
- After 24 hours → counter resets automatically
- If limit reached → new products wait for next cycle

**Example:**
```
Monday 10:00 AM:  Create 500 products (counter: 500, window starts)
Monday  2:00 PM:  Create 500 products (counter: 1000, limit reached)
Monday  6:00 PM:  Try to create → BLOCKED (limit reached)
Tuesday 10:01 AM: Try to create → ALLOWED (24h passed, counter reset)
```

**Check limit:**
```sql
SELECT products_created_count, first_creation_timestamp
FROM product_creation_tracker
WHERE product_type = 'wheel';  -- or 'tire'
```

## Database Tables

### `product_creation_tracker`
Tracks daily limits:
- `products_created_count`: Current count in 24h window
- `first_creation_timestamp`: When current window started
- `cycle_reset_at`: When counter was last reset

### `wheels` / `tires`
Product data with sync tracking:
- `product_sync`: `'pending'`, `'synced'`, `'error'`, or `'skipped'`
- `sync_error`: Error message if failed
- `supplier`: **Wheels**: Actual manufacturer from Klaviyo (e.g., "Fuel Off-Road", "Niche Road Wheels"). **Tires**: 'SDW' (default since Klaviyo doesn't have supplier for tires)
- `url_part_number`: Unique identifier from CWO URL (used to track and update CWO products)

### `shopify_products`
Tracks all Shopify products:
- `shopify_id`: Shopify product ID
- `variant_id`: Shopify variant ID
- `source`: `'CWO'` or `'SDW'`

### `all_shopify_wheels` / `shopify_tires`
Complete Shopify listings (synced each run):
- Used to check if products already exist
- UPSERT logic keeps it accurate

## Configuration

### Environment Variables
```bash
export ZENROWS_API_KEY="your-key-here"
export CAPSOLVER_API_KEY="your-key-here"  # Optional for CAPTCHA solving
```

### Config File
Edit `enhanced_cwo/config.py` to change:

```python
# Discovery settings
ENABLE_PRODUCT_DISCOVERY = True   # Enable/disable new product creation
ENABLE_SHOPIFY_SYNC = True         # Enable/disable Shopify table sync
MAX_PRODUCTS_PER_DAY = 1000        # Daily creation limit
RETRY_FAILED_PRODUCTS = True       # Retry failed products

# Performance
CONCURRENT_PAGE_WORKERS = 20       # Concurrent page scraping
MAX_CONCURRENT_PRODUCT_EXTRACTIONS = 10  # Concurrent product page fetches
DISCOVERY_BATCH_SIZE = 50          # Process new products in batches

# Image processing
MAX_CONCURRENT_UPLOADS = 5         # Concurrent GCS uploads
MAX_CONCURRENT_DOWNLOADS = 10      # Concurrent image downloads
```

## Modes

### Standard Mode (Default)
- Scrapes all pages
- Updates existing products
- Discovers and creates new products
- Respects daily limit

### Sale-Only Mode
```bash
python -m enhanced_cwo.main --wheels --sale-only
```
- Only scrapes products on sale
- Creates only sale products
- Useful for targeted scraping

### Inventory-Only Mode
```bash
python -m enhanced_cwo.main --wheels --no-discovery
```
- Disables product creation
- Only updates quantities/prices for existing products
- No daily limit enforcement

### No-Sync Mode
```bash
python -m enhanced_cwo.main --wheels --no-shopify-sync
```
- Skips Shopify table synchronization
- Faster startup
- Use only if tables are already synced

## Monitoring Progress

### Real-time Logs
The scraper provides detailed logging:
```
[STEP 1] Syncing Shopify products table...
  ✅ Synced 5,234 products

[STEP 3] Discovering new products...
  - New products to create: 127
  - Products to retry: 5

[STEP 4] Extracting product data...
  Successfully extracted 122 / 127 products

[STEP 5] Creating products...
  ✅ Created: Brand Model Size (ID: 123456)
  Batch complete: 120 successful, 2 failed
```

### Database Queries

**Check failed products:**
```sql
SELECT url_part_number, brand, sync_error
FROM wheels
WHERE product_sync = 'error' AND supplier = 'CWO'
LIMIT 10;
```

**Check pending products:**
```sql
SELECT url_part_number, brand
FROM wheels
WHERE product_sync = 'pending' AND supplier = 'CWO'
LIMIT 10;
```

**Check daily limit status:**
```sql
SELECT
    product_type,
    products_created_count,
    first_creation_timestamp,
    TIMESTAMPADD(HOUR, 24, first_creation_timestamp) as reset_time,
    (1000 - products_created_count) as remaining
FROM product_creation_tracker;
```

**Recent creations:**
```sql
SELECT brand, part_number, created_at
FROM wheels
WHERE supplier = 'CWO' AND product_sync = 'synced'
ORDER BY created_at DESC
LIMIT 20;
```

## Troubleshooting

### "Daily limit reached"
- Check `product_creation_tracker` table
- Wait for 24-hour window to reset
- Or manually reset: `UPDATE product_creation_tracker SET products_created_count = 0, first_creation_timestamp = NULL WHERE product_type = 'wheel';`

### "Failed to create on Shopify"
- Check `sync_error` column in wheels/tires table
- Common issues:
  - Duplicate SKU/title
  - Missing required fields
  - Rate limiting
- Products marked as `'error'` will retry next run

### "No Klaviyo data found"
- Product page might have redirected to collection page
- Check if URL is correct
- Product might not have Klaviyo data embedded

### "GCS upload failed"
- Check Google Cloud credentials
- Verify bucket permissions
- Check network connectivity

## Module Structure

```
enhanced_cwo/
├── __init__.py              # Package initialization
├── config.py                # All configuration settings
├── gcs_manager.py           # Google Cloud Storage uploads
├── image_processing.py      # Image download, OCR, processing
├── shopify_ops.py           # Shopify GraphQL operations
├── scraper_core.py          # Page fetching, parsing, CAPTCHA
├── product_discovery.py     # Find new products, extract data
├── product_creation.py      # Create products in DB + Shopify
└── main.py                  # Main orchestrator (RUN THIS)
```

## Best Practices

1. **Run during off-peak hours** - Less load on CWO servers
2. **Monitor logs** - Watch for errors and failed creations
3. **Check daily limit** - Plan creation capacity
4. **Review failed products** - Investigate sync errors
5. **Backup before major changes** - Database safety

## Examples

### Full wheels scrape with discovery
```bash
python -m enhanced_cwo.main --wheels
```

### Tires sale items only
```bash
python -m enhanced_cwo.main --tires --sale-only
```

### Wheels inventory update only (no new products)
```bash
python -m enhanced_cwo.main --wheels --no-discovery
```

### Quick run (skip Shopify sync)
```bash
python -m enhanced_cwo.main --wheels --no-shopify-sync
```

## Support

For issues or questions:
1. Check logs for error messages
2. Review database `sync_error` columns
3. Check `product_creation_tracker` for limit status
4. Verify API keys and credentials

## Version

Enhanced CWO Scraper v1.0.0
- Original scraper functionality
- Product discovery and creation
- Daily limit enforcement
- Shopify table synchronization
- Image processing and GCS upload
