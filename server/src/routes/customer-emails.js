import express from 'express';
import db from '../config/database.js';
import { sendEmail } from '../services/zohoMail.js';

const router = express.Router();

/**
 * Get all customer emails with pagination and filtering
 */
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || ''; // unread, read, replied, archived

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Build query
    let query = `
      SELECT
        ce.*,
        o.order_number,
        o.customer_name,
        o.vehicle_year,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_trim
      FROM customer_emails ce
      LEFT JOIN orders o ON ce.order_id = o.id
      WHERE ce.shop_id = ?
    `;

    const params = [shopId];

    // Filter by status
    if (status) {
      query += ' AND ce.status = ?';
      params.push(status);
    }

    // Add ordering and pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY ce.received_at DESC LIMIT ${limit} OFFSET ${offset}`;

    // Fetch emails
    const [emails] = await db.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM customer_emails WHERE shop_id = ?';
    const countParams = [shopId];

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const [countResult] = await db.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      count: emails.length,
      total: total,
      page: page,
      limit: limit,
      hasMore: (page * limit) < total,
      emails: emails
    });

  } catch (error) {
    console.error('❌ Error fetching customer emails:', error);
    res.status(500).json({
      error: 'Failed to fetch customer emails',
      message: error.message
    });
  }
});

/**
 * Get single customer email by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { id } = req.params;

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Fetch email with order details
    const [emails] = await db.execute(
      `SELECT
        ce.*,
        o.order_number,
        o.customer_name,
        o.customer_email,
        o.vehicle_year,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_trim,
        o.total_price,
        o.tags
      FROM customer_emails ce
      LEFT JOIN orders o ON ce.order_id = o.id
      WHERE ce.id = ? AND ce.shop_id = ?`,
      [id, shopId]
    );

    if (emails.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Mark as read if it was unread
    if (emails[0].status === 'unread') {
      await db.execute(
        'UPDATE customer_emails SET status = ? WHERE id = ?',
        ['read', id]
      );
      emails[0].status = 'read';
    }

    res.json({
      success: true,
      email: emails[0]
    });

  } catch (error) {
    console.error('❌ Error fetching customer email:', error);
    res.status(500).json({
      error: 'Failed to fetch customer email',
      message: error.message
    });
  }
});

/**
 * Update customer email status
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { id } = req.params;
    const { status } = req.body; // unread, read, replied, archived

    console.log(`📧 Updating email #${id} status to: ${status}`);

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Update status
    await db.execute(
      'UPDATE customer_emails SET status = ?, updated_at = NOW() WHERE id = ? AND shop_id = ?',
      [status, id, shopId]
    );

    console.log(`✅ Updated email #${id} status`);

    res.json({
      success: true,
      message: 'Email status updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating email status:', error);
    res.status(500).json({
      error: 'Failed to update email status',
      message: error.message
    });
  }
});

/**
 * Reply to customer email
 */
router.post('/:id/reply', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { id } = req.params;
    const { subject, body } = req.body;

    console.log(`📧 Replying to email #${id}`);

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Fetch original email
    const [emails] = await db.execute(
      'SELECT * FROM customer_emails WHERE id = ? AND shop_id = ?',
      [id, shopId]
    );

    if (emails.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const originalEmail = emails[0];

    // Send reply via Zoho
    const result = await sendEmail(shopId, {
      to: originalEmail.from_email,
      toName: originalEmail.from_name,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      body: body,
      fromAddress: 'sales@tfswheels.com'
    });

    // Update original email status to 'replied'
    await db.execute(
      'UPDATE customer_emails SET status = ?, updated_at = NOW() WHERE id = ?',
      ['replied', id]
    );

    // Log the sent email
    await db.execute(
      `INSERT INTO email_logs (
        shop_id,
        order_id,
        recipient_email,
        recipient_name,
        subject,
        body,
        status,
        zoho_message_id,
        sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, NOW())`,
      [
        shopId,
        originalEmail.order_id,
        originalEmail.from_email,
        originalEmail.from_name,
        subject,
        body,
        result.messageId || null
      ]
    );

    console.log(`✅ Reply sent to ${originalEmail.from_email}`);

    res.json({
      success: true,
      message: 'Reply sent successfully'
    });

  } catch (error) {
    console.error('❌ Error sending reply:', error);
    res.status(500).json({
      error: 'Failed to send reply',
      message: error.message
    });
  }
});

/**
 * Get email statistics
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Get counts by status
    const [stats] = await db.execute(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as \`read\`,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived
      FROM customer_emails
      WHERE shop_id = ?`,
      [shopId]
    );

    res.json({
      success: true,
      stats: stats[0]
    });

  } catch (error) {
    console.error('❌ Error fetching email stats:', error);
    res.status(500).json({
      error: 'Failed to fetch email stats',
      message: error.message
    });
  }
});

export default router;
