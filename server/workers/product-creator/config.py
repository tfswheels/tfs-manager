"""
Minimal configuration for Product Creator Worker
"""

import logging
import os

# =============================================================================
# LOGGING SETUP
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# SHOPIFY CONFIGURATION
# =============================================================================

SHOPIFY_STORE_URL = os.getenv('SHOPIFY_STORE_URL', "https://2f3d7a-2.myshopify.com/admin/api/2025-01/graphql.json")
SHOPIFY_ACCESS_TOKEN = os.getenv('SHOPIFY_ACCESS_TOKEN', '')

# =============================================================================
# MODE CONFIGURATION
# =============================================================================

MODE = 'wheels'  # Default mode, can be overridden

# =============================================================================
# IMAGE SETTINGS
# =============================================================================

PLACEHOLDER_IMAGE = "https://storage.googleapis.com/tfs-product-images/Placeholder%20Image/TFS_placeholder_image.png"

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
