import express from 'express';
import { verifyShopInstalled } from '../middleware/auth.js';
import db from '../config/database.js';
import { sendTemplatedEmail } from '../services/zohoMail.js';

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

/**
 * Send email using template (without auth middleware for now)
 */
router.post('/send', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { templateId, orderIds } = req.body;

    console.log(`📧 Sending templated emails for orders: ${orderIds.join(', ')}`);

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Fetch orders with customer and vehicle info
    const placeholders = orderIds.map(() => '?').join(',');
    const [orders] = await db.execute(
      `SELECT * FROM orders
       WHERE id IN (${placeholders}) AND shop_id = ?`,
      [...orderIds, shopId]
    );

    const results = [];
    const errors = [];

    // Send email to each order
    for (const order of orders) {
      try {
        // Build template variables
        const variables = {
          customer_name: order.customer_name || 'Customer',
          order_number: order.order_number,
          vehicle_year: order.vehicle_year || '',
          vehicle_make: order.vehicle_make || '',
          vehicle_model: order.vehicle_model || '',
          vehicle_trim: order.vehicle_trim || '',
          email: order.customer_email,
          phone: order.customer_phone || '',
          order_id: order.id,
          // TODO: Add wheel_make, wheel_model, tracking_number from order_items
          wheel_make: '',
          wheel_model: '',
          tracking_number: ''
        };

        const result = await sendTemplatedEmail(
          shopId,
          templateId,
          {
            email: order.customer_email,
            name: order.customer_name
          },
          variables
        );

        results.push({
          orderId: order.id,
          orderNumber: order.order_number,
          email: order.customer_email,
          success: true
        });

        console.log(`✅ Email sent for order ${order.order_number}`);
      } catch (error) {
        console.error(`❌ Failed to send email for order ${order.order_number}:`, error.message);
        errors.push({
          orderId: order.id,
          orderNumber: order.order_number,
          email: order.customer_email,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      sent: results.length,
      failed: errors.length,
      results: results,
      errors: errors
    });

  } catch (error) {
    console.error('❌ Send email error:', error);
    res.status(500).json({
      error: 'Failed to send emails',
      message: error.message
    });
  }
});

export default router;
