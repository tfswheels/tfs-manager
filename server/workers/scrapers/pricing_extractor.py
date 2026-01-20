"""
Pricing Extraction Module

Extracts map_price from CWO product page HTML.
"""

import re
from bs4 import BeautifulSoup
from typing import Optional

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import logger
except ImportError:
    from config import logger


def extract_map_price_from_html(html: str) -> Optional[float]:
    """
    Extract the 'each' price from CWO product page HTML.

    Handles both regular and sale pricing structures:
    - Regular: Single price container with <span class="w-price">
    - Sale: Two price containers, second one (without line-through) is actual price

    Returns:
        Float price or None if not found
    """
    try:
        soup = BeautifulSoup(html, 'html.parser')

        # Find all price containers
        price_containers = soup.find_all('div', id=re.compile(r'(wheel|tire)-price-container'))

        if not price_containers:
            logger.warning("No price containers found")
            return None

        # For sale items, there are 2 containers - we want the second one (actual price)
        # For regular items, there's 1 container - we want that one

        # Find the last non-strikethrough price container
        target_container = None
        for container in price_containers:
            # Check if this container has strikethrough styling (sale "was" price)
            has_strikethrough = False

            # Check for inline style or line-through class
            style_attr = container.get('style', '')
            if 'line-through' in style_attr or '#B50202' in style_attr or '#d00' in style_attr:
                has_strikethrough = True
                continue  # Skip "was" price containers

            # Also check h3 tags inside for strikethrough
            h3_tags = container.find_all('h3', class_='ee-price')
            for h3 in h3_tags:
                if h3.get('style') and 'line-through' in h3.get('style'):
                    has_strikethrough = True
                    break

            if not has_strikethrough:
                target_container = container
                # Don't break - keep looking for the last valid one

        if not target_container:
            logger.warning("Could not find valid price container")
            return None

        # Extract the "each" price from the price-unit div
        price_unit = target_container.find('div', class_='price-unit')
        if not price_unit:
            logger.warning("No price-unit div found")
            return None

        price_span = price_unit.find('span', class_='w-price')
        if not price_span:
            logger.warning("No w-price span found")
            return None

        price_text = price_span.get_text(strip=True)

        # Clean and convert to float
        price_text = price_text.replace(',', '')
        price = float(price_text)

        logger.debug(f"Extracted map_price: ${price}")
        return price

    except Exception as e:
        logger.error(f"Error extracting map_price from HTML: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return None
