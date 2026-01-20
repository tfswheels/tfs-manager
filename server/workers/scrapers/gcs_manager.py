"""
Google Cloud Storage Manager

Handles image uploads to GCS bucket with authentication and retry logic.
"""

import asyncio
import aiohttp
import logging
from datetime import datetime, timedelta, timezone
import google.auth
from google.auth.transport.requests import Request
from typing import Optional

# Try relative imports first (when run as module), fall back to absolute
try:
    from .config import BUCKET_NAME, GCS_FOLDER, MAX_CONCURRENT_UPLOADS, logger
except ImportError:
    from config import BUCKET_NAME, GCS_FOLDER, MAX_CONCURRENT_UPLOADS, logger

# Token refresh margin
TOKEN_REFRESH_MARGIN = timedelta(minutes=5)


class GCSManager:
    """Manages Google Cloud Storage operations for product images."""

    def __init__(self):
        self.bucket_name = BUCKET_NAME
        self.folder = GCS_FOLDER
        self.upload_semaphore = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)
        self.token_lock = asyncio.Lock()
        self.creds = None
        self.project = None
        self.token = None
        self.token_expiry = None

    @classmethod
    async def create(cls):
        """Factory method to create and initialize GCSManager."""
        self = cls()
        await self.initialize_credentials()
        return self

    async def initialize_credentials(self):
        """Initialize or refresh GCS credentials."""
        async with self.token_lock:
            try:
                import os
                # Check if GCS_CREDENTIALS env var is set
                if not os.environ.get('GCS_CREDENTIALS') and not os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
                    logger.warning("GCS credentials not found in environment - GCS features will be disabled")
                    self.creds = None
                    self.project = None
                    self.token = None
                    return

                self.creds, self.project = google.auth.default()
                self.creds.refresh(Request())
                self.token = self.creds.token
                self.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=3600)
                logger.info("Successfully refreshed GCS access token")
            except Exception as e:
                logger.warning(f"GCS credentials not available: {e} - GCS features will be disabled")
                self.creds = None
                self.project = None
                self.token = None

    async def check_token_expiry(self):
        """Check if token needs refresh and refresh if needed."""
        try:
            if datetime.now(timezone.utc) + TOKEN_REFRESH_MARGIN >= self.token_expiry:
                logger.debug("Refreshing GCS token...")
                await self.initialize_credentials()
        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            raise

    async def upload_with_retry(self, session: aiohttp.ClientSession, upload_url: str,
                               params: dict, headers: dict, image_data: bytes) -> Optional[str]:
        """Upload image with retry logic."""
        retry_delays = [1, 2, 5, 10, 15]

        for attempt, delay in enumerate(retry_delays):
            try:
                async with session.post(upload_url, params=params, headers=headers, data=image_data) as response:
                    if response.status == 200:
                        return await response.text()
                    elif response.status == 401:
                        logger.warning("GCS unauthorized, refreshing credentials...")
                        await self.initialize_credentials()
                        headers['Authorization'] = f'Bearer {self.token}'
                        continue
                    elif response.status in {429, 500, 502, 503, 504}:
                        if attempt < len(retry_delays) - 1:
                            await asyncio.sleep(delay)
                            continue
                        logger.error(f"GCS upload failed with retryable status: {response.status}")
                        return None
                    else:
                        error_text = await response.text()
                        logger.error(f"GCS upload failed with status {response.status}: {error_text}")
                        return None

            except aiohttp.ClientError as e:
                if attempt < len(retry_delays) - 1:
                    await asyncio.sleep(delay)
                    continue
                logger.error(f"GCS upload failed after {len(retry_delays)} attempts: {e}")
                return None
            except Exception as e:
                logger.error(f"Unexpected GCS upload error: {e}")
                if attempt < len(retry_delays) - 1:
                    await asyncio.sleep(delay)
                    continue
                return None
        return None

    async def upload_image(self, session: aiohttp.ClientSession, image_data: bytes, image_name: str) -> Optional[str]:
        """Upload image to GCS and return public URL."""
        try:
            async with self.upload_semaphore:
                await self.check_token_expiry()

                headers = {
                    'Authorization': f'Bearer {self.token}',
                    'Content-Type': 'image/jpeg'
                }
                upload_url = f"https://storage.googleapis.com/upload/storage/v1/b/{self.bucket_name}/o"
                params = {'uploadType': 'media', 'name': f'{self.folder}{image_name}'}

                result = await self.upload_with_retry(session, upload_url, params, headers, image_data)

                if result:
                    gcs_url = f"https://storage.googleapis.com/{self.bucket_name}/{self.folder}{image_name}"
                    logger.debug(f"Successfully uploaded {image_name} to GCS")
                    return gcs_url
                else:
                    logger.error(f"Failed to upload {image_name} to GCS")
                    return None

        except Exception as e:
            logger.error(f"Exception uploading {image_name}: {e}")
            return None
