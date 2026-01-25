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

# Configure logging to use stdout instead of stderr for INFO/DEBUG
# This prevents Node.js from labeling all logs as "ERROR" in Railway
import sys

class InfoFilter(logging.Filter):
    """Filter to send INFO/DEBUG to stdout, WARNING/ERROR to stderr"""
    def filter(self, record):
        return record.levelno <= logging.INFO

# Create handlers
stdout_handler = logging.StreamHandler(sys.stdout)
stdout_handler.setLevel(logging.DEBUG)
stdout_handler.addFilter(InfoFilter())

stderr_handler = logging.StreamHandler(sys.stderr)
stderr_handler.setLevel(logging.WARNING)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[stdout_handler, stderr_handler]
)
logger = logging.getLogger(__name__)

# =============================================================================
# PRODUCT MODE CONFIGURATION
# =============================================================================

MODE = 'wheels'  # 'wheels' or 'tires'
RESUME_FROM_CHECKPOINT = False
STOP_ON_BACKORDER_ONLY = False
SALE_ONLY = False

# =============================================================================
# NEW FEATURES CONFIGURATION
# =============================================================================

MAX_PRODUCTS_PER_DAY = int(os.environ.get('MAX_PRODUCTS_PER_DAY', '1000'))  # Daily creation limit (can be overridden via env var)

# Scraping mode: 'direct', 'zenrows', or 'hybrid'
SCRAPING_MODE = 'zenrows'  # Default to using ZenRows proxy
HYBRID_RETRY_COUNT = 3  # Number of direct attempts before using ZenRows in hybrid mode

# Legacy support for backward compatibility
USE_ZENROWS = True  # Deprecated: use SCRAPING_MODE instead

# =============================================================================
# COMMAND LINE ARGUMENTS
# =============================================================================

if '--wheels' in sys.argv:
    MODE = 'wheels'
if '--tires' in sys.argv:
    MODE = 'tires'
if '--resume' in sys.argv:
    RESUME_FROM_CHECKPOINT = True
if '--stop-on-backorder-only' in sys.argv:
    STOP_ON_BACKORDER_ONLY = True
if '--sale-only' in sys.argv:
    SALE_ONLY = True

# Legacy command-line arg support
if '--no-zenrows' in sys.argv:
    SCRAPING_MODE = 'direct'
    USE_ZENROWS = False

# Override from environment variables (from Node.js backend)
if os.environ.get('MAX_PRODUCTS_PER_DAY'):
    MAX_PRODUCTS_PER_DAY = int(os.environ.get('MAX_PRODUCTS_PER_DAY'))
    logger.info(f"📊 MAX_PRODUCTS_PER_DAY overridden from env var: {MAX_PRODUCTS_PER_DAY}")

if os.environ.get('BACKORDER_COUNT'):
    MAX_CONSECUTIVE_NON_IN_STOCK = int(os.environ.get('BACKORDER_COUNT'))
    logger.info(f"🛑 BACKORDER_COUNT overridden from env var: {MAX_CONSECUTIVE_NON_IN_STOCK}")

# Override scraping mode from environment variables
if os.environ.get('SCRAPING_MODE'):
    mode = os.environ.get('SCRAPING_MODE').lower()
    if mode in ['direct', 'zenrows', 'hybrid']:
        SCRAPING_MODE = mode
        # Update legacy USE_ZENROWS for backward compatibility
        USE_ZENROWS = (mode == 'zenrows')
        logger.info(f"🌐 SCRAPING_MODE overridden from env var: {SCRAPING_MODE}")
    else:
        logger.warning(f"Invalid SCRAPING_MODE '{mode}', using default: {SCRAPING_MODE}")

if os.environ.get('HYBRID_RETRY_COUNT'):
    try:
        HYBRID_RETRY_COUNT = int(os.environ.get('HYBRID_RETRY_COUNT'))
        logger.info(f"🔄 HYBRID_RETRY_COUNT overridden from env var: {HYBRID_RETRY_COUNT}")
    except ValueError:
        logger.warning(f"Invalid HYBRID_RETRY_COUNT value, using default: {HYBRID_RETRY_COUNT}")

# =============================================================================
# SCRAPING SETTINGS
# =============================================================================

CONCURRENT_PAGE_WORKERS = 20
BATCH_SIZE = 100
MAX_CONSECUTIVE_NON_IN_STOCK = int(os.environ.get('BACKORDER_COUNT', '30'))
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

SHOPIFY_STORE_URL = os.environ.get('SHOPIFY_STORE_URL', "https://2f3d7a-2.myshopify.com/admin/api/2025-01/graphql.json")
SHOPIFY_ACCESS_TOKEN = os.environ.get('SHOPIFY_ACCESS_TOKEN', '')

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
ZENROWS_API_KEY = os.environ.get('ZENROWS_API_KEY', '1952d3d9f407cef089c0871d5d37d426fe78546e')

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

# Override from environment variables (from Node.js backend)
if os.environ.get('EXCLUDED_BRANDS'):
    try:
        import json
        excluded_brands_from_env = json.loads(os.environ.get('EXCLUDED_BRANDS'))
        if isinstance(excluded_brands_from_env, list):
            SKIP_BRANDS = set(excluded_brands_from_env)
            SKIP_BRANDS_NORMALIZED = {brand.lower() for brand in SKIP_BRANDS}
            logger.info(f"🚫 EXCLUDED_BRANDS overridden from env var: {len(SKIP_BRANDS)} brands")
    except Exception as e:
        logger.warning(f"Failed to parse EXCLUDED_BRANDS from env var: {e}")

# Override SCRAPE_SPECIFIC_BRANDS from environment variables (from Node.js backend)
if os.environ.get('SPECIFIC_BRANDS'):
    try:
        import json
        specific_brands_from_env = json.loads(os.environ.get('SPECIFIC_BRANDS'))
        if isinstance(specific_brands_from_env, list):
            SCRAPE_SPECIFIC_BRANDS = specific_brands_from_env
            logger.info(f"🎯 SCRAPE_SPECIFIC_BRANDS set from env var: {', '.join(SCRAPE_SPECIFIC_BRANDS)}")
    except Exception as e:
        logger.warning(f"Failed to parse SPECIFIC_BRANDS from env var: {e}")

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
    'host': os.getenv('DB_HOST', '34.67.162.140'),
    'user': os.getenv('DB_USER', 'tfs'),
    'password': os.getenv('DB_PASSWORD', '[XtlAUU5;"1Ti*Ry'),
    'db': os.getenv('DB_NAME', 'tfs-db'),
    'port': int(os.getenv('DB_PORT', 3306)),
    'maxsize': 20,
    'minsize': 5
}

# =============================================================================
# LOG CONFIGURATION ON STARTUP
# =============================================================================

logger.info("=" * 80)
logger.info("ENHANCED CWO SCRAPER - CONFIGURATION")
logger.info("=" * 80)
logger.info(f"Mode: {MODE}")
logger.info(f"Resume: {RESUME_FROM_CHECKPOINT}")
logger.info(f"Sale Only: {SALE_ONLY}")
logger.info(f"Scraping Mode: {SCRAPING_MODE}")
if SCRAPING_MODE == 'hybrid':
    logger.info(f"Hybrid Retry Count: {HYBRID_RETRY_COUNT}")
logger.info(f"Max Products/Day: {MAX_PRODUCTS_PER_DAY}")
logger.info(f"Backorder Count: {MAX_CONSECUTIVE_NON_IN_STOCK}")
logger.info("=" * 80)
