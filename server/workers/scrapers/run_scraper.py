#!/usr/bin/env python3
"""
Wrapper script to run the enhanced CWO scraper from Node.js backend.

Usage:
    python run_scraper.py --job-id=123 --type=wheels
    python run_scraper.py --job-id=124 --type=tires
"""

import sys
import os
import asyncio
import logging
import mysql.connector
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Parse arguments
job_id = None
scraper_type = 'wheels'

for arg in sys.argv[1:]:
    if arg.startswith('--job-id='):
        job_id = int(arg.split('=')[1])
    elif arg.startswith('--type='):
        scraper_type = arg.split('=')[1]

if not job_id:
    logger.error("Missing --job-id argument")
    sys.exit(1)

logger.info(f"Starting scraper job #{job_id}, type: {scraper_type}")

# Update job status to 'running'
try:
    from dotenv import load_dotenv
    load_dotenv()

    db_config = {
        'host': os.environ.get('DB_HOST'),
        'user': os.environ.get('DB_USER'),
        'password': os.environ.get('DB_PASSWORD'),
        'database': 'tfs-manager',  # Use tfs-manager for job tracking
        'autocommit': True
    }

    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()

    # Update status to running
    cursor.execute(
        "UPDATE scraping_jobs SET status = 'running', started_at = NOW() WHERE id = %s",
        (job_id,)
    )
    logger.info(f"Updated job #{job_id} status to 'running'")

    cursor.close()
    conn.close()

except Exception as e:
    logger.error(f"Failed to update job status: {e}")

# Now run the actual scraper
try:
    logger.info("=" * 80)
    logger.info(f"STARTING {scraper_type.upper()} SCRAPER")
    logger.info("=" * 80)

    # Import and run the main scraper
    # Preserve all command line arguments except job-id and type
    # (which are specific to run_scraper.py)
    preserved_args = [arg for arg in sys.argv[1:] if not arg.startswith('--job-id=') and not arg.startswith('--type=')]
    sys.argv = ['main.py', f'--{scraper_type}'] + preserved_args

    from main import run_enhanced_scraper

    # Run the scraper (returns stats dict)
    stats = asyncio.run(run_enhanced_scraper())

    # stats should be a dict with products_found, products_created_wheels_table, etc.
    # If None or empty, default to 0
    if not stats:
        stats = {
            'products_found': 0,
            'products_created_wheels_table': 0,
            'products_updated': 0
        }

    logger.info("=" * 80)
    logger.info("SCRAPER COMPLETED SUCCESSFULLY")
    logger.info("=" * 80)

    # Update job status to completed
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()

    cursor.execute(
        """UPDATE scraping_jobs
           SET status = 'completed',
               completed_at = NOW(),
               products_found = %s,
               products_created = %s,
               products_updated = %s
           WHERE id = %s""",
        (
            stats.get('products_found', 0),
            stats.get('products_created_wheels_table', 0),  # New products saved to DB
            stats.get('products_updated', 0),
            job_id
        )
    )

    logger.info(f"Updated job #{job_id} status to 'completed'")

    cursor.close()
    conn.close()

    logger.info("=" * 80)
    logger.info("JOB COMPLETED")
    logger.info("=" * 80)

except Exception as e:
    logger.error(f"Scraper failed: {e}")
    import traceback
    logger.error(traceback.format_exc())

    # Update job status to failed
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()

        cursor.execute(
            """UPDATE scraping_jobs
               SET status = 'failed',
                   completed_at = NOW(),
                   error_message = %s
               WHERE id = %s""",
            (str(e)[:500], job_id)
        )

        cursor.close()
        conn.close()
    except:
        pass

    sys.exit(1)
