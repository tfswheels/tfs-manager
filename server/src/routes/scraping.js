import express from 'express';
import { verifyShopInstalled } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get scraping jobs
 */
router.get('/jobs', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;

    const [jobs] = await db.execute(
      'SELECT * FROM scraping_jobs WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50',
      [shopId]
    );

    res.json({ jobs });
  } catch (error) {
    console.error('Get scraping jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch scraping jobs' });
  }
});

/**
 * Trigger new scraping job
 */
router.post('/jobs', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { scraper_type, config } = req.body;

    const [result] = await db.execute(
      `INSERT INTO scraping_jobs (shop_id, scraper_type, config, status, created_at)
      VALUES (?, ?, ?, 'pending', NOW())`,
      [shopId, scraper_type, JSON.stringify(config)]
    );

    res.json({
      success: true,
      jobId: result.insertId
    });
  } catch (error) {
    console.error('Create scraping job error:', error);
    res.status(500).json({ error: 'Failed to create scraping job' });
  }
});

export default router;
