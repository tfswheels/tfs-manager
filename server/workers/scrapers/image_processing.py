"""
Image Processing Module

Handles image downloading, OCR checking for "coming soon" text,
URL processing, and filename generation.
"""

import asyncio
import aiohttp
import hashlib
import io
import os
from urllib.parse import urlparse
from typing import Optional
from PIL import Image
import pytesseract

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import (
        MAX_CONCURRENT_DOWNLOADS,
        PLACEHOLDER_IMAGE,
        MODE,
        logger
    )
except ImportError:
    from config import (
        MAX_CONCURRENT_DOWNLOADS,
        PLACEHOLDER_IMAGE,
        MODE,
        logger
    )


def generate_filename(product_id: str, brand: str, model: str, original_url: str) -> str:
    """Generate unique filename for product image."""
    def clean(s: str) -> str:
        return ''.join(e for e in s if e.isalnum())

    brand = clean(brand or "")
    model = clean(model or "")
    product_id = clean(str(product_id))

    base_name = f"product_{product_id}_{brand}_{model}"
    url_hash = hashlib.md5((original_url or "").encode()).hexdigest()[:8]
    ext = os.path.splitext(urlparse(original_url).path)[1] or '.jpg'
    if not ext.startswith('.'):
        ext = '.' + ext

    return f"{base_name}_{url_hash}{ext}"


def process_image_url(image_url: str, product_type: str = None) -> str:
    """Replace compressed folder with regular folder in image URLs."""
    if not image_url or not isinstance(image_url, str):
        return image_url

    if product_type is None:
        product_type = MODE

    if product_type == 'wheels':
        return image_url.replace('/wheels-compressed/', '/wheels/')
    else:  # tires
        return image_url.replace('/tires-compressed/', '/tires/')


async def download_image_with_retry(session: aiohttp.ClientSession, url: str, download_sem: asyncio.Semaphore) -> Optional[bytes]:
    """Download image with retry logic."""
    if not url:
        return None

    valid_domains = [
        'https://images.customwheeloffset.com/',
        'https://images.offset.com/'
    ]

    if not any(url.startswith(domain) for domain in valid_domains):
        logger.debug(f"Invalid domain for image URL: {url}")
        return None

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://customwheeloffset.com/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-site'
    }

    async with download_sem:
        retry_delays = [1, 2, 5, 10, 15]
        for attempt, delay in enumerate(retry_delays):
            try:
                async with session.get(url, headers=headers) as response:
                    if response.status == 200:
                        content = await response.read()
                        if len(content) == 0:
                            logger.error(f"Downloaded 0 bytes from {url}")
                            return None
                        logger.debug(f"Successfully downloaded image: {len(content)} bytes")
                        return content
                    elif response.status in {429, 500, 502, 503, 504}:
                        if attempt < len(retry_delays) - 1:
                            await asyncio.sleep(delay)
                            continue
                        logger.error(f"Download failed after retries: {url}")
                        return None
                    else:
                        logger.error(f"Download failed: {url} (status {response.status})")
                        return None

            except aiohttp.ClientError as e:
                if attempt < len(retry_delays) - 1:
                    await asyncio.sleep(delay)
                    continue
                logger.error(f"Download failed: {url} - {e}")
                return None
            except Exception as e:
                logger.error(f"Unexpected download error: {url} - {e}")
                if attempt < len(retry_delays) - 1:
                    await asyncio.sleep(delay)
                    continue
                return None

    return None


async def check_image_for_coming_text(image_data: bytes) -> bool:
    """Check if image contains 'coming' text using OCR."""
    try:
        loop = asyncio.get_event_loop()

        def process_image():
            try:
                image = Image.open(io.BytesIO(image_data))
                text = pytesseract.image_to_string(image).lower()
                has_coming = 'coming' in text
                image.close()
                return has_coming
            except Exception as e:
                logger.debug(f"OCR processing failed: {e}")
                raise

        return await loop.run_in_executor(None, process_image)

    except Exception as e:
        logger.debug(f"OCR check failed: {e}")
        return False


async def process_product_image(session: aiohttp.ClientSession, gcs_manager, product_data: dict) -> Optional[str]:
    """
    Process a product image: download, check for 'coming soon', upload to GCS.

    Args:
        session: aiohttp session
        gcs_manager: GCSManager instance
        product_data: Dict with keys: image_url, product_id, brand, model

    Returns:
        GCS URL or PLACEHOLDER_IMAGE URL, or None if failed
    """
    image_url = product_data.get('image_url')

    if not image_url:
        logger.debug("No image URL provided")
        return None

    # Skip if already on GCS or is placeholder
    if image_url.startswith('https://storage.googleapis.com/'):
        logger.debug("Image already on GCS")
        return image_url

    # Process image URL (replace compressed folder with regular folder)
    processed_url = process_image_url(image_url)
    logger.debug(f"Processing image URL: {image_url} -> {processed_url}")

    # Create download semaphore
    download_sem = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)

    # Download the image
    image_data = await download_image_with_retry(session, processed_url, download_sem)
    if not image_data:
        logger.warning(f"Failed to download image: {image_url}")
        return None

    # Check for "coming" text in the image
    has_coming_text = await check_image_for_coming_text(image_data)

    if has_coming_text:
        logger.info(f"Image contains 'coming soon' text, using placeholder")
        return PLACEHOLDER_IMAGE
    else:
        # Upload to GCS
        filename = generate_filename(
            product_data.get('product_id', 'unknown'),
            product_data.get('brand', ''),
            product_data.get('model', ''),
            image_url
        )
        gcs_url = await gcs_manager.upload_image(session, image_data, filename)

        if gcs_url:
            logger.debug(f"Image uploaded to GCS: {filename}")
            return gcs_url
        else:
            logger.warning(f"Failed to upload image to GCS: {filename}")
            return None
