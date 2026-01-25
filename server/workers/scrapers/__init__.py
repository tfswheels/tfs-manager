"""
Enhanced CWO Scraper - Modular Implementation

Combines inventory scraping with automated product discovery and creation.
"""

__version__ = "1.0.0"
__author__ = "TFS Wheels"

# Make key components available at package level
from .config import MODE

__all__ = [
    'MODE',
]
