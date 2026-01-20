import express from 'express';
import { verifyShopInstalled } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get dashboard statistics
 */
router.get('/dashboard/stats', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;

    // Get order counts
    const [orderStats] = await db.execute(
      `SELECT
        COUNT(*) as total_orders,
        COUNT(CASE WHEN financial_status = 'paid' THEN 1 END) as paid_orders,
        COUNT(CASE WHEN fulfillment_status = 'fulfilled' THEN 1 END) as fulfilled_orders,
        SUM(total_price) as total_revenue
      FROM orders
      WHERE shop_id = ?`,
      [shopId]
    );

    // Get product count
    const [productStats] = await db.execute(
      'SELECT COUNT(*) as total_products FROM products WHERE shop_id = ?',
      [shopId]
    );

    // Get recent orders
    const [recentOrders] = await db.execute(
      `SELECT order_number, customer_name, total_price, financial_status, created_at
      FROM orders
      WHERE shop_id = ?
      ORDER BY created_at DESC
      LIMIT 10`,
      [shopId]
    );

    res.json({
      orders: orderStats[0],
      products: productStats[0],
      recentOrders
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

/**
 * Get shop settings
 */
router.get('/settings', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;

    const [settings] = await db.execute(
      'SELECT * FROM shop_settings WHERE shop_id = ?',
      [shopId]
    );

    if (settings.length === 0) {
      // Return default settings
      return res.json({
        shop_id: shopId,
        email_from_name: 'TFS Wheels',
        email_reply_to: 'support@tfswheels.com',
        notification_email: 'support@tfswheels.com'
      });
    }

    res.json(settings[0]);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * Update shop settings
 */
router.post('/settings', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const settings = req.body;

    await db.execute(
      `INSERT INTO shop_settings (shop_id, email_from_name, email_reply_to, notification_email, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        email_from_name = VALUES(email_from_name),
        email_reply_to = VALUES(email_reply_to),
        notification_email = VALUES(notification_email),
        updated_at = NOW()`,
      [
        shopId,
        settings.email_from_name || 'TFS Wheels',
        settings.email_reply_to || 'support@tfswheels.com',
        settings.notification_email || 'support@tfswheels.com'
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
