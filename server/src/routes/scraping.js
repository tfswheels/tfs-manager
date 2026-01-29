import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Track running Python processes by job ID
const runningProcesses = new Map();

// Cleanup completed processes periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [jobId, processData] of runningProcesses.entries()) {
    // Remove processes that have exited or are older than 1 hour
    if (processData.exitCode !== null ||
        (processData.startTime && now - processData.startTime > 3600000)) {
      console.log(`🧹 Cleaning up completed/stale process for job ${jobId}`);
      runningProcesses.delete(jobId);
    }
  }
}, 300000); // Run every 5 minutes

/**
 * Get scraping jobs
 */
router.get('/jobs', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Only log errors - this endpoint is polled frequently by frontend
    // Removed: console.log(`📋 Fetching scraping jobs for ${shop}...`);

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

    // Only log errors - this endpoint is polled frequently by frontend
    // Removed: console.log(`✅ Retrieved ${jobs.length} scraping jobs`);

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
    const { shop = '2f3d7a-2.myshopify.com', scraperType, config = {} } = req.body;

    console.log(`🚀 Starting scraping job for ${shop}, type: ${scraperType}...`);
    console.log(`⚙️  Configuration:`, config);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Create scraping job with actual config
    const [result] = await db.execute(
      `INSERT INTO scraping_jobs (
        shop_id,
        scraper_type,
        config,
        status,
        started_at,
        created_at
      ) VALUES (?, ?, ?, 'running', NOW(), NOW())`,
      [shopId, scraperType, JSON.stringify(config)]
    );

    const jobId = result.insertId;

    console.log(`✅ Created scraping job #${jobId}`);

    // Spawn Python scraper process
    const scraperPath = path.join(__dirname, '../../workers/scrapers');

    // Select the appropriate scraper script based on job type
    let pythonScript;
    let args;

    if (scraperType === 'inventory_cost') {
      // Cost scraper for SDW Wheel Wholesale
      pythonScript = path.join(scraperPath, 'sdw_cost_scraper.py');
      args = [pythonScript];

      // Add wheels/tires flag
      if (config.productType === 'tires' || scraperType.includes('tire')) {
        args.push('--tires');
      } else {
        args.push('--wheels');
      }

      // Add headed flag if needed
      if (config.headed) {
        args.push('--headed');
      }
    } else {
      // Regular inventory scraper (CWO)
      pythonScript = path.join(scraperPath, 'run_scraper.py');
      args = [
        pythonScript,
        `--job-id=${jobId}`,
        `--type=${scraperType}`
      ];

      // Add optional flags based on config
      if (config.saleOnly) args.push('--sale-only');
    }

    console.log(`🐍 Launching Python scraper: ${pythonScript}`);
    console.log(`📂 Working directory: ${scraperPath}`);

    // Handle legacy useZenrows boolean (backward compatibility)
    if (config.useZenrows === false && !config.scrapingMode) {
      args.push('--no-zenrows');
    }

    console.log(`🔧 Python args:`, args.join(' '));

    // Build environment variables for Python process
    const pythonEnv = {
      ...process.env,
      // Ensure the scraper uses tfs-db for product data
      DB_NAME: 'tfs-db',  // Override to use product database
      // Pass config via environment variables
      EXCLUDED_BRANDS: config.excludedBrands ? JSON.stringify(config.excludedBrands) : '[]',
      SPECIFIC_BRANDS: config.specificBrands ? JSON.stringify(config.specificBrands) : '[]',
      BACKORDER_COUNT: config.backorderCount?.toString() || '5',
      // Scraping mode configuration
      SCRAPING_MODE: config.scrapingMode || 'zenrows',
      HYBRID_RETRY_COUNT: config.hybridRetryCount?.toString() || '3'
    };

    // Add scraper-specific environment variables
    if (scraperType !== 'inventory_cost') {
      // Regular inventory scraper specific config
      pythonEnv.MAX_PRODUCTS_PER_DAY = config.maxProductsPerDay?.toString() || '1000';
    }

    const pythonProcess = spawn('python3', args, {
      cwd: scraperPath,
      env: pythonEnv
    });

    // Log Python output in real-time
    pythonProcess.stdout.on('data', (data) => {
      console.log(`[Scraper #${jobId}] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();

      // Python warnings/errors come through stderr, but so does normal logging
      // Only prefix with ERROR if it's actually an error/warning message
      if (output.includes('ERROR') || output.includes('WARNING') || output.includes('Traceback') || output.includes('Exception')) {
        console.error(`[Scraper #${jobId} ERROR] ${output}`);
      } else {
        // Regular Python INFO logs that went to stderr
        console.log(`[Scraper #${jobId}] ${output}`);
      }
    });

    pythonProcess.on('close', (code) => {
      // Remove from running processes
      runningProcesses.delete(jobId);

      if (code === 0) {
        console.log(`✅ Scraper job #${jobId} completed successfully`);
      } else if (code === null) {
        console.log(`⚠️  Scraper job #${jobId} was terminated`);
      } else {
        console.error(`❌ Scraper job #${jobId} failed with code ${code}`);
      }
    });

    pythonProcess.on('error', (error) => {
      console.error(`❌ Failed to start scraper job #${jobId}:`, error);
      runningProcesses.delete(jobId);
    });

    // Track the process
    runningProcesses.set(jobId, pythonProcess);

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
 * Terminate a running scraping job
 */
router.post('/terminate/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    console.log(`🛑 Attempting to terminate scraping job #${jobId}...`);

    // Check current job status in database
    const [jobs] = await db.execute(
      'SELECT status FROM scraping_jobs WHERE id = ?',
      [jobId]
    );

    if (jobs.length === 0) {
      return res.status(404).json({
        error: 'Job not found',
        message: 'This job does not exist in the database.'
      });
    }

    const currentStatus = jobs[0].status;

    // If job is not running, inform user
    if (currentStatus !== 'running') {
      return res.status(400).json({
        error: 'Job not running',
        message: `Job #${jobId} has status '${currentStatus}' and cannot be terminated.`
      });
    }

    // Check if process is in memory (it should be for running jobs)
    const process = runningProcesses.get(jobId);

    if (process) {
      // Process found - kill it
      console.log(`✅ Found running process for job #${jobId}, sending SIGTERM...`);
      process.kill('SIGTERM');
    } else {
      // Process not found - likely server restarted
      console.log(`⚠️  Process for job #${jobId} not found in memory (server may have restarted)`);
      console.log(`   Marking job as failed in database...`);
    }

    // Update job status in database regardless
    await db.execute(
      `UPDATE scraping_jobs
       SET status = ?,
           completed_at = NOW()
       WHERE id = ?`,
      [process ? 'terminated' : 'failed', jobId]
    );

    const statusMessage = process
      ? 'terminated successfully'
      : 'marked as failed (process was not found - server may have restarted)';

    console.log(`✅ Job #${jobId} ${statusMessage}`);

    res.json({
      success: true,
      message: `Scraping job #${jobId} has been ${statusMessage}`,
      jobId: jobId,
      wasProcessFound: !!process
    });
  } catch (error) {
    console.error('❌ Terminate scraping error:', error);
    res.status(500).json({ error: 'Failed to terminate scraping job' });
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
