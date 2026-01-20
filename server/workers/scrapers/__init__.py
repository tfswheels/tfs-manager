"""
Enhanced CWO Scraper - Modular Implementation

Combines inventory scraping with automated product discovery and creation.
"""

__version__ = "1.0.0"
__author__ = "TFS Wheels"

# Make key components available at package level
from .config import MODE, ENABLE_PRODUCT_DISCOVERY, MAX_PRODUCTS_PER_DAY

__all__ = [
    'MODE',
    'ENABLE_PRODUCT_DISCOVERY',
    'MAX_PRODUCTS_PER_DAY',
]
