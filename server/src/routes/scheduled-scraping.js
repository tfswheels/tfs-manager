import express from 'express';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get all scheduled scrape jobs
 */
router.get('/', async (req, res) => {
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

    const [jobs] = await db.execute(
      `SELECT * FROM scheduled_scrape_jobs
       WHERE shop_id = ?
       ORDER BY created_at DESC`,
      [shopId]
    );

    // Parse JSON config for each job
    const jobsWithConfig = jobs.map(job => ({
      ...job,
      config: typeof job.config === 'string' ? JSON.parse(job.config) : job.config
    }));

    res.json({ jobs: jobsWithConfig });
  } catch (error) {
    console.error('❌ Get scheduled jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled jobs' });
  }
});

/**
 * Create a new scheduled scrape job
 */
router.post('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { name, scraperType, scheduleInterval, config } = req.body;

    if (!name || !scraperType || !scheduleInterval) {
      return res.status(400).json({
        error: 'Missing required fields: name, scraperType, scheduleInterval'
      });
    }

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Calculate next run time
    const nextRunAt = new Date();
    nextRunAt.setHours(nextRunAt.getHours() + parseInt(scheduleInterval));

    const [result] = await db.execute(
      `INSERT INTO scheduled_scrape_jobs (
        shop_id,
        name,
        scraper_type,
        schedule_interval,
        config,
        enabled,
        next_run_at
      ) VALUES (?, ?, ?, ?, ?, TRUE, ?)`,
      [
        shopId,
        name,
        scraperType,
        scheduleInterval,
        JSON.stringify(config),
        nextRunAt
      ]
    );

    console.log(`✅ Created scheduled job: ${name} (${scraperType}, every ${scheduleInterval}h)`);

    res.json({
      success: true,
      job: {
        id: result.insertId,
        name,
        scraper_type: scraperType,
        schedule_interval: scheduleInterval,
        config: finalConfig,
        next_run_at: nextRunAt
      }
    });
  } catch (error) {
    console.error('❌ Create scheduled job error:', error);
    res.status(500).json({ error: 'Failed to create scheduled job' });
  }
});

/**
 * Update a scheduled scrape job
 */
router.put('/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    const { name, scraperType, scheduleInterval, config, enabled } = req.body;

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (scraperType !== undefined) {
      updates.push('scraper_type = ?');
      params.push(scraperType);
    }
    if (scheduleInterval !== undefined) {
      updates.push('schedule_interval = ?');
      params.push(scheduleInterval);
    }
    if (config !== undefined) {
      updates.push('config = ?');
      params.push(JSON.stringify(config));
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
      `UPDATE scheduled_scrape_jobs
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      params
    );

    console.log(`✅ Updated scheduled job #${jobId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Update scheduled job error:', error);
    res.status(500).json({ error: 'Failed to update scheduled job' });
  }
});

/**
 * Delete a scheduled scrape job
 */
router.delete('/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);

    await db.execute(
      'DELETE FROM scheduled_scrape_jobs WHERE id = ?',
      [jobId]
    );

    console.log(`✅ Deleted scheduled job #${jobId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Delete scheduled job error:', error);
    res.status(500).json({ error: 'Failed to delete scheduled job' });
  }
});

/**
 * Toggle enabled status
 */
router.post('/:jobId/toggle', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);

    // Get current status
    const [jobs] = await db.execute(
      'SELECT enabled FROM scheduled_scrape_jobs WHERE id = ?',
      [jobId]
    );

    if (jobs.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const newStatus = !jobs[0].enabled;

    await db.execute(
      'UPDATE scheduled_scrape_jobs SET enabled = ?, updated_at = NOW() WHERE id = ?',
      [newStatus, jobId]
    );

    console.log(`✅ Toggled scheduled job #${jobId} to ${newStatus ? 'enabled' : 'disabled'}`);

    res.json({ success: true, enabled: newStatus });
  } catch (error) {
    console.error('❌ Toggle scheduled job error:', error);
    res.status(500).json({ error: 'Failed to toggle scheduled job' });
  }
});

/**
 * Get execution history for a scheduled job
 */
router.get('/:jobId/history', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);

    const [history] = await db.execute(
      `SELECT * FROM scraping_jobs
       WHERE scheduled_job_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [jobId]
    );

    res.json({ history });
  } catch (error) {
    console.error('❌ Get job history error:', error);
    res.status(500).json({ error: 'Failed to fetch job history' });
  }
});

export default router;
