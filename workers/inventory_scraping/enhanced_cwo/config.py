"""
Configuration module for Enhanced CWO Scraper

All settings, constants, and command-line argument parsing.
"""

import os
import sys
import logging

# =============================================================================
# LOGGING SETUP
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# PRODUCT MODE CONFIGURATION
# =============================================================================

MODE = 'wheels'  # 'wheels' or 'tires'
HEADLESS = True
RESUME_FROM_CHECKPOINT = False
STOP_ON_BACKORDER_ONLY = False
SALE_ONLY = False

# =============================================================================
# NEW FEATURES CONFIGURATION
# =============================================================================

ENABLE_PRODUCT_DISCOVERY = True  # Enable new product creation
ENABLE_SHOPIFY_SYNC = True  # Sync Shopify tables before scraping
MAX_PRODUCTS_PER_DAY = 1000  # Daily creation limit
RETRY_FAILED_PRODUCTS = True  # Retry products with product_sync='error'

# =============================================================================
# COMMAND LINE ARGUMENTS
# =============================================================================

if '--wheels' in sys.argv:
    MODE = 'wheels'
if '--tires' in sys.argv:
    MODE = 'tires'
if '--headed' in sys.argv:
    HEADLESS = False
if '--resume' in sys.argv:
    RESUME_FROM_CHECKPOINT = True
if '--stop-on-backorder-only' in sys.argv:
    STOP_ON_BACKORDER_ONLY = True
if '--sale-only' in sys.argv:
    SALE_ONLY = True
if '--no-discovery' in sys.argv:
    ENABLE_PRODUCT_DISCOVERY = False
if '--no-shopify-sync' in sys.argv:
    ENABLE_SHOPIFY_SYNC = False

# =============================================================================
# SCRAPING SETTINGS
# =============================================================================

CONCURRENT_PAGE_WORKERS = 20
BATCH_SIZE = 100
MAX_CONSECUTIVE_NON_IN_STOCK = 30
IN_STOCK_QUANTITY = 131

# =============================================================================
# PRODUCT DISCOVERY SETTINGS
# =============================================================================

MAX_CONCURRENT_PRODUCT_EXTRACTIONS = 10
DISCOVERY_BATCH_SIZE = 50

# =============================================================================
# IMAGE PROCESSING SETTINGS
# =============================================================================

MAX_CONCURRENT_UPLOADS = 5
MAX_CONCURRENT_DOWNLOADS = 10
BUCKET_NAME = 'tfs-product-images'
GCS_FOLDER = 'products/'
PLACEHOLDER_IMAGE = "https://storage.googleapis.com/tfs-product-images/Placeholder%20Image/TFS_placeholder_image.png"

# =============================================================================
# SHOPIFY CONFIGURATION
# =============================================================================

SHOPIFY_STORE_URL = os.getenv('SHOPIFY_STORE_URL', 'https://2f3d7a-2.myshopify.com/admin/api/2025-01/graphql.json')
SHOPIFY_ACCESS_TOKEN = os.getenv('SHOPIFY_ACCESS_TOKEN')

if not SHOPIFY_ACCESS_TOKEN:
    raise ValueError("SHOPIFY_ACCESS_TOKEN environment variable is required")

# =============================================================================
# PERFORMANCE OPTIMIZATION
# =============================================================================

PAGES_PER_REFRESH_BATCH = 600  # Refresh browser every 600 pages to prevent performance degradation
REFRESH_COOLOFF_MINUTES = 5  # Cool off period when refreshing browser (minutes)
RETRY_COOLOFF_MINUTES = 5  # Fixed cool off period before retrying failed pages

# =============================================================================
# CHECKPOINTING
# =============================================================================

CHECKPOINT_FILE = 'cwo_checkpoint.json'
CHECKPOINT_INTERVAL = 50

# =============================================================================
# API KEYS
# =============================================================================

CAPSOLVER_API_KEY = os.environ.get('CAPSOLVER_API_KEY')
ZENROWS_API_KEY = os.environ.get('ZENROWS_API_KEY')

if not ZENROWS_API_KEY:
    raise ValueError("ZENROWS_API_KEY environment variable is required")

# =============================================================================
# BASE URL
# =============================================================================

BASE_URL_BASE = f"https://www.customwheeloffset.com/store/{MODE}"

# =============================================================================
# BRAND FILTERING
# =============================================================================

SCRAPE_SPECIFIC_BRANDS = []  # e.g., ["Ferrada", "Vossen"]
USE_BRAND_FILTER_FOR_SKIP_BRANDS = False

SKIP_BRANDS = {
    "American Force", "American Force Cast", "American Racing",
    "American Racing Forged", "American Racing Vintage", "Asanti Black",
    "Asanti Forged", "Asanti Off Road", "ATX", "ATX Series", "Beyern", "Black Rhino",
    "Black Rhino Hard Alloys", "Black Rhino Powersports", "Coventry", "Cray", "DUB", "DUB 1PC",
    "ESR Forged", "ESR Forged Classic", "Fairway Alloys", "Foose", "Foose 1PC", "Fuel", "Fuel 1PC",
    "Fuel 2PC", "Fuel Forged", "Fuel Mono", "Fuel UTV", "Helo", "HRE", "JTX Forged", "KMC",
    "KMC Powersports", "Level 8", "Mandrus", "Moto Metal", "Motegi", "MSA Offroad Wheels",
    "Niche", "Niche 1PC", "Niche Mono", "Ohm", "OHM", "Performance Replicas", "Petrol", "Private Label",
    "Pro Comp", "Pro Comp Alloys", "RBP Forged", "RedBourne", "Rotiform", "Rotiform Forged",
    "Ruff", "Status", "TSW", "Tuff", "US Mag 1PC", "Variant", "Vision", "Victor Equipment", "XD",
    "XD Powersports", "XO"
}

SKIP_BRANDS_NORMALIZED = {brand.lower() for brand in SKIP_BRANDS}

# =============================================================================
# CONSTRUCT BASE_URL
# =============================================================================

if SCRAPE_SPECIFIC_BRANDS:
    scrape_brands_lower = {brand.lower() for brand in SCRAPE_SPECIFIC_BRANDS}
    overlap = scrape_brands_lower & SKIP_BRANDS_NORMALIZED
    if overlap:
        logger.warning(f"⚠️  WARNING: {len(overlap)} brand(s) in both lists")
        logger.warning(f"   {', '.join(overlap)} - WILL be scraped")

    brand_filter = "%27".join(brand.replace(' ', '+') for brand in SCRAPE_SPECIFIC_BRANDS)
    sale_toggle = 1 if SALE_ONLY else 0
    BASE_URL = f"{BASE_URL_BASE}?store={MODE}&brand={brand_filter}&modification=Minor+Plastic+Trimming&qdToggle=0&rubbing=No+rubbing+or+scrubbing&saleToggle={sale_toggle}&sort=instock&suspension=Leveling+Kit"
    logger.info(f"SCRAPE MODE: Specific brands - {', '.join(SCRAPE_SPECIFIC_BRANDS)}")
    SKIP_BRANDS_NORMALIZED = set()
else:
    BASE_URL = BASE_URL_BASE
    if USE_BRAND_FILTER_FOR_SKIP_BRANDS:
        logger.info("SCRAPE MODE: Brand filter optimization (will query DB)")
    else:
        logger.info(f"SCRAPE MODE: All pages (excluding {len(SKIP_BRANDS_NORMALIZED)} brands)")

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

DB_CONFIG = {
    'host': os.getenv('DB_HOST'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD'),
    'db': os.getenv('DB_NAME'),
    'port': int(os.getenv('DB_PORT', '3306')),
    'maxsize': 20,
    'minsize': 5
}

# Validate required database credentials
if not all([DB_CONFIG['host'], DB_CONFIG['user'], DB_CONFIG['password'], DB_CONFIG['db']]):
    raise ValueError("Database credentials (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) are required in environment variables")

# =============================================================================
# LOG CONFIGURATION ON STARTUP
# =============================================================================

logger.info("=" * 80)
logger.info("ENHANCED CWO SCRAPER - CONFIGURATION")
logger.info("=" * 80)
logger.info(f"Mode: {MODE}")
logger.info(f"Headless: {HEADLESS}")
logger.info(f"Resume: {RESUME_FROM_CHECKPOINT}")
logger.info(f"Sale Only: {SALE_ONLY}")
logger.info(f"Product Discovery: {ENABLE_PRODUCT_DISCOVERY}")
logger.info(f"Shopify Sync: {ENABLE_SHOPIFY_SYNC}")
logger.info(f"Max Products/Day: {MAX_PRODUCTS_PER_DAY}")
logger.info(f"Retry Failed: {RETRY_FAILED_PRODUCTS}")
logger.info("=" * 80)
