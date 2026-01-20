import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Get scraping jobs
 */
router.get('/jobs', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    console.log(`📋 Fetching scraping jobs for ${shop}...`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    const [jobs] = await db.execute(
      'SELECT * FROM scraping_jobs WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50',
      [shopId]
    );

    console.log(`✅ Retrieved ${jobs.length} scraping jobs`);

    res.json({ jobs });
  } catch (error) {
    console.error('❌ Get scraping jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch scraping jobs' });
  }
});

/**
 * Start scraping job immediately
 */
router.post('/start', async (req, res) => {
  try {
    const { shop = '2f3d7a-2.myshopify.com', scraperType } = req.body;

    console.log(`🚀 Starting scraping job for ${shop}, type: ${scraperType}...`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Create scraping job
    const [result] = await db.execute(
      `INSERT INTO scraping_jobs (
        shop_id,
        scraper_type,
        config,
        status,
        started_at,
        created_at
      ) VALUES (?, ?, ?, 'running', NOW(), NOW())`,
      [shopId, scraperType, JSON.stringify({ immediate: true })]
    );

    const jobId = result.insertId;

    console.log(`✅ Created scraping job #${jobId}`);

    // Spawn Python scraper process
    const scraperPath = path.join(__dirname, '../../workers/scrapers');
    const pythonScript = path.join(scraperPath, 'run_scraper.py');

    console.log(`🐍 Launching Python scraper: ${pythonScript}`);
    console.log(`📂 Working directory: ${scraperPath}`);

    const pythonProcess = spawn('python3', [
      pythonScript,
      `--job-id=${jobId}`,
      `--type=${scraperType}`
    ], {
      cwd: scraperPath,
      env: {
        ...process.env,
        // Ensure the scraper uses tfs-db for product data
        DB_NAME: 'tfs-db'  // Override to use product database
      }
    });

    // Log Python output in real-time
    pythonProcess.stdout.on('data', (data) => {
      console.log(`[Scraper #${jobId}] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`[Scraper #${jobId} ERROR] ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Scraper job #${jobId} completed successfully`);
      } else {
        console.error(`❌ Scraper job #${jobId} failed with code ${code}`);
      }
    });

    pythonProcess.on('error', (error) => {
      console.error(`❌ Failed to start scraper job #${jobId}:`, error);
    });

    res.json({
      success: true,
      job: {
        id: jobId,
        shop_id: shopId,
        scraper_type: scraperType,
        status: 'running',
        message: 'Scraping job started successfully. Check Railway logs for progress.'
      }
    });
  } catch (error) {
    console.error('❌ Start scraping error:', error);
    res.status(500).json({ error: 'Failed to start scraping job' });
  }
});

/**
 * Schedule recurring scraping job
 */
router.post('/schedule', async (req, res) => {
  try {
    const { shop = '2f3d7a-2.myshopify.com', scraperType, intervalHours } = req.body;

    console.log(`📅 Scheduling scraping job for ${shop}, type: ${scraperType}, interval: ${intervalHours}h...`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Create scheduled job
    const [result] = await db.execute(
      `INSERT INTO scraping_jobs (
        shop_id,
        scraper_type,
        config,
        status,
        created_at
      ) VALUES (?, ?, ?, 'pending', NOW())`,
      [
        shopId,
        scraperType,
        JSON.stringify({
          scheduled: true,
          intervalHours: intervalHours,
          nextRun: new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()
        })
      ]
    );

    const jobId = result.insertId;

    console.log(`✅ Scheduled scraping job #${jobId} to run every ${intervalHours} hours`);

    // TODO: Set up actual cron job or scheduled task
    // You can use node-cron or similar to trigger your Python scrapers

    res.json({
      success: true,
      job: {
        id: jobId,
        shop_id: shopId,
        scraper_type: scraperType,
        status: 'pending',
        interval_hours: intervalHours,
        message: `Scraping job scheduled to run every ${intervalHours} hours`
      }
    });
  } catch (error) {
    console.error('❌ Schedule scraping error:', error);
    res.status(500).json({ error: 'Failed to schedule scraping job' });
  }
});

export default router;
