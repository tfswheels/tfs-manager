import express from 'express';
import { verifyShopInstalled } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get email templates
 */
router.get('/templates', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;

    const [templates] = await db.execute(
      'SELECT * FROM email_templates WHERE shop_id = ? ORDER BY created_at DESC',
      [shopId]
    );

    res.json({ templates });
  } catch (error) {
    console.error('Get email templates error:', error);
    res.status(500).json({ error: 'Failed to fetch email templates' });
  }
});

/**
 * Create email template
 */
router.post('/templates', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { name, subject, body } = req.body;

    const [result] = await db.execute(
      `INSERT INTO email_templates (shop_id, name, subject, body, created_at)
      VALUES (?, ?, ?, ?, NOW())`,
      [shopId, name, subject, body]
    );

    res.json({
      success: true,
      templateId: result.insertId
    });
  } catch (error) {
    console.error('Create email template error:', error);
    res.status(500).json({ error: 'Failed to create email template' });
  }
});

/**
 * Get email logs
 */
router.get('/logs', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const [logs] = await db.execute(
      `SELECT * FROM email_logs
      WHERE shop_id = ?
      ORDER BY sent_at DESC
      LIMIT ? OFFSET ?`,
      [shopId, parseInt(limit), parseInt(offset)]
    );

    res.json({ logs });
  } catch (error) {
    console.error('Get email logs error:', error);
    res.status(500).json({ error: 'Failed to fetch email logs' });
  }
});

export default router;
