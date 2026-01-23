import express from 'express';
import db from '../config/database.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Get current product creation job configuration and stats
 */
router.get('/config', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Get active product creation job
    const [jobs] = await db.execute(
      `SELECT * FROM product_creation_jobs
       WHERE shop_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId]
    );

    if (jobs.length === 0) {
      // Create default job if none exists
      const nextRunAt = new Date();
      nextRunAt.setHours(nextRunAt.getHours() + 24);

      await db.execute(
        `INSERT INTO product_creation_jobs (
          shop_id,
          max_products_per_run,
          schedule_interval,
          enabled,
          next_run_at
        ) VALUES (?, 1000, 24, TRUE, ?)`,
        [shopId, nextRunAt]
      );

      return res.json({
        job: {
          shop_id: shopId,
          max_products_per_run: 1000,
          schedule_interval: 24,
          enabled: true,
          next_run_at: nextRunAt,
          status: 'pending'
        }
      });
    }

    res.json({ job: jobs[0] });
  } catch (error) {
    console.error('❌ Get product creation config error:', error);
    res.status(500).json({ error: 'Failed to fetch product creation config' });
  }
});

/**
 * Update product creation configuration
 */
router.put('/config', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const {
      maxProductsPerRun,
      scheduleInterval,
      maxWheelsPerRun,
      maxTiresPerRun,
      enabled
    } = req.body;

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Get current job
    const [jobs] = await db.execute(
      `SELECT id FROM product_creation_jobs
       WHERE shop_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId]
    );

    if (jobs.length === 0) {
      return res.status(404).json({ error: 'No product creation job found' });
    }

    const jobId = jobs[0].id;

    // Build update query
    const updates = [];
    const params = [];

    if (maxProductsPerRun !== undefined) {
      updates.push('max_products_per_run = ?');
      params.push(maxProductsPerRun);
    }
    if (scheduleInterval !== undefined) {
      updates.push('schedule_interval = ?');
      params.push(scheduleInterval);
    }
    if (maxWheelsPerRun !== undefined) {
      updates.push('max_wheels_per_run = ?');
      params.push(maxWheelsPerRun);
    }
    if (maxTiresPerRun !== undefined) {
      updates.push('max_tires_per_run = ?');
      params.push(maxTiresPerRun);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(enabled);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(jobId);

    await db.execute(
      `UPDATE product_creation_jobs
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      params
    );

    console.log(`✅ Updated product creation config`);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Update product creation config error:', error);
    res.status(500).json({ error: 'Failed to update product creation config' });
  }
});

/**
 * Get product creation history
 * Only shows jobs from the last 7 days to avoid stale data
 */
router.get('/history', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500); // Ensure valid range 1-500

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Clean up stale "running" jobs (running for more than 2 hours)
    await db.execute(
      `UPDATE product_creation_jobs
       SET status = 'failed',
           error_message = 'Job timed out - marked as failed',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE shop_id = ?
       AND status = 'running'
       AND started_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)`,
      [shopId]
    );

    // Get recent history (last 7 days)
    const [history] = await db.execute(
      `SELECT * FROM product_creation_jobs
       WHERE shop_id = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      [shopId]
    );

    res.json({ history });
  } catch (error) {
    console.error('❌ Get product creation history error:', error);
    res.status(500).json({ error: 'Failed to fetch product creation history' });
  }
});

/**
 * Manually trigger product creation now
 */
router.post('/run-now', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Get current config
    const [jobs] = await db.execute(
      `SELECT * FROM product_creation_jobs
       WHERE shop_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId]
    );

    if (jobs.length === 0) {
      return res.status(404).json({ error: 'No product creation job configured' });
    }

    const config = jobs[0];

    // Create a new job entry for this manual run
    const nextScheduledRun = new Date();
    nextScheduledRun.setHours(nextScheduledRun.getHours() + config.schedule_interval);

    const [result] = await db.execute(
      `INSERT INTO product_creation_jobs (
        shop_id,
        max_products_per_run,
        schedule_interval,
        max_wheels_per_run,
        max_tires_per_run,
        enabled,
        status,
        started_at,
        next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', NOW(), ?)`,
      [
        shopId,
        config.max_products_per_run,
        config.schedule_interval,
        config.max_wheels_per_run,
        config.max_tires_per_run,
        config.enabled,
        nextScheduledRun
      ]
    );

    const newJobId = result.insertId;
    console.log(`✅ Started manual product creation run #${newJobId}`);

    // Spawn Python product creation worker
    const workerPath = path.join(__dirname, '../../workers/product-creator');
    const pythonScript = path.join(workerPath, 'create_shopify_products.py');

    const args = [
      pythonScript,
      `--job-id=${newJobId}`,
      `--max-products=${config.max_products_per_run || 1000}`
    ];

    console.log(`📦 Spawning Python worker for manual run...`);
    console.log(`📂 Working directory: ${workerPath}`);
    console.log(`🐍 Python script: ${pythonScript}`);
    console.log(`📋 Arguments: ${JSON.stringify(args)}`);

    const pythonProcess = spawn('python3', args, {
      cwd: workerPath,
      env: {
        ...process.env,
        DB_NAME: 'tfs-manager'
      },
      detached: false
    });

    console.log(`✅ Python process spawned with PID: ${pythonProcess.pid}`);

    // Handle output
    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[Manual Run #${newJobId} STDOUT] ${output}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      console.log(`[Manual Run #${newJobId} STDERR] ${output}`);
      if (output.includes('ERROR') || output.includes('WARNING') || output.includes('Traceback')) {
        console.error(`[Manual Run #${newJobId} ⚠️  ERROR] ${output}`);
      }
    });

    pythonProcess.on('error', (error) => {
      console.error(`[Manual Run #${newJobId}] ❌ Process error:`, error);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Manual product creation run #${newJobId} completed successfully`);
      } else if (code === null) {
        console.log(`⚠️  Manual product creation run #${newJobId} was terminated`);
      } else {
        console.error(`❌ Manual product creation run #${newJobId} failed with exit code ${code}`);
      }
    });

    res.json({
      success: true,
      jobId: newJobId,
      message: 'Product creation started. Check server logs for progress.'
    });
  } catch (error) {
    console.error('❌ Run product creation error:', error);
    res.status(500).json({ error: 'Failed to start product creation' });
  }
});

/**
 * Get today's product creation stats
 * Uses shared daily limit system
 */
router.get('/stats/today', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Get today's stats from shared daily limit table
    const [stats] = await db.execute(
      `SELECT
        total_created,
        wheels_created,
        tires_created,
        limit_per_day
       FROM daily_shopify_creation_limit
       WHERE date = CURDATE()`
    );

    let totalCreated = 0;
    let wheelsCreated = 0;
    let tiresCreated = 0;
    let dailyLimit = 1000;

    if (stats.length > 0) {
      totalCreated = stats[0].total_created || 0;
      wheelsCreated = stats[0].wheels_created || 0;
      tiresCreated = stats[0].tires_created || 0;
      dailyLimit = stats[0].limit_per_day || 1000;
    } else {
      // Create today's entry if it doesn't exist
      await db.execute(
        `INSERT INTO daily_shopify_creation_limit
         (date, total_created, wheels_created, tires_created)
         VALUES (CURDATE(), 0, 0, 0)`
      );
    }

    res.json({
      today: {
        total: totalCreated,
        wheels: wheelsCreated,
        tires: tiresCreated,
        remaining: Math.max(0, dailyLimit - totalCreated),
        limit: dailyLimit
      }
    });
  } catch (error) {
    console.error('❌ Get today stats error:', error);
    res.status(500).json({ error: 'Failed to fetch today stats' });
  }
});

export default router;
