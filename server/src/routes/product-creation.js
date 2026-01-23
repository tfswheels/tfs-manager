import express from 'express';
import db from '../config/database.js';

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

    // Use string interpolation for LIMIT since MySQL doesn't support placeholders for LIMIT in prepared statements
    const [history] = await db.execute(
      `SELECT * FROM product_creation_jobs
       WHERE shop_id = ?
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

    console.log(`✅ Started manual product creation run #${result.insertId}`);

    // TODO: Trigger actual product creation worker process here
    // For now, just return success
    res.json({
      success: true,
      jobId: result.insertId,
      message: 'Product creation started. This will create products from scraped data.'
    });
  } catch (error) {
    console.error('❌ Run product creation error:', error);
    res.status(500).json({ error: 'Failed to start product creation' });
  }
});

/**
 * Get today's product creation stats
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

    // Get today's stats
    const [stats] = await db.execute(
      `SELECT
        SUM(products_created) as total_created,
        SUM(wheels_created) as wheels_created,
        SUM(tires_created) as tires_created
       FROM product_creation_jobs
       WHERE shop_id = ?
       AND DATE(created_at) = CURDATE()
       AND status = 'completed'`,
      [shopId]
    );

    // Get current config for daily limit
    const [config] = await db.execute(
      `SELECT max_products_per_run FROM product_creation_jobs
       WHERE shop_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId]
    );

    const dailyLimit = config[0]?.max_products_per_run || 1000;
    const totalCreated = stats[0]?.total_created || 0;
    const wheelsCreated = stats[0]?.wheels_created || 0;
    const tiresCreated = stats[0]?.tires_created || 0;

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
