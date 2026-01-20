import express from 'express';
import crypto from 'crypto';
import db from '../config/database.js';

const router = express.Router();

/**
 * Verify Shopify webhook HMAC signature
 */
const verifyWebhook = (req, res, next) => {
  try {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];

    if (!hmacHeader) {
      console.error('Missing HMAC header');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rawBody = req.body;
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(rawBody, 'utf8')
      .digest('base64');

    if (hash !== hmacHeader) {
      console.error('HMAC verification failed');
      return res.status(401).json({ error: 'Unauthorized - Invalid HMAC' });
    }

    req.webhookBody = JSON.parse(rawBody.toString());
    next();
  } catch (error) {
    console.error('Webhook verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

/**
 * GDPR: Customers Data Request
 * Shop owner requests data for a customer
 */
router.post('/customers/data_request', verifyWebhook, async (req, res) => {
  try {
    const data = req.webhookBody;
    const { shop_domain, customer, orders_requested } = data;

    console.log(`🔒 GDPR Data Request for customer: ${customer.email} from ${shop_domain}`);

    // Log the GDPR request
    await db.execute(
      `INSERT INTO gdpr_requests (
        shop_domain,
        request_type,
        customer_email,
        customer_id,
        orders_requested,
        request_data,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        shop_domain,
        'data_request',
        customer.email,
        customer.id,
        JSON.stringify(orders_requested),
        JSON.stringify(data)
      ]
    );

    // Collect customer data from our database
    const [orders] = await db.execute(
      'SELECT * FROM orders WHERE customer_email = ?',
      [customer.email]
    );

    const [emailLogs] = await db.execute(
      'SELECT * FROM email_logs WHERE recipient_email = ?',
      [customer.email]
    );

    console.log(`✅ GDPR Data Request processed for ${customer.email}`);
    console.log(`   Orders found: ${orders.length}`);
    console.log(`   Email logs found: ${emailLogs.length}`);

    // In production, you would send this data to the shop owner
    // For now, we just log it and acknowledge receipt

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('GDPR data request error:', error);
    res.status(500).json({ error: 'GDPR request processing failed' });
  }
});

/**
 * GDPR: Customers Redact
 * Shop owner requests deletion of customer data (48 hours after shop uninstall)
 */
router.post('/customers/redact', verifyWebhook, async (req, res) => {
  try {
    const data = req.webhookBody;
    const { shop_domain, customer, orders_to_redact } = data;

    console.log(`🗑️ GDPR Redaction Request for customer: ${customer.email} from ${shop_domain}`);

    // Log the GDPR request
    await db.execute(
      `INSERT INTO gdpr_requests (
        shop_domain,
        request_type,
        customer_email,
        customer_id,
        orders_requested,
        request_data,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        shop_domain,
        'customer_redact',
        customer.email,
        customer.id,
        JSON.stringify(orders_to_redact),
        JSON.stringify(data)
      ]
    );

    // Anonymize customer data (don't delete, for record-keeping)
    await db.execute(
      `UPDATE orders SET
        customer_name = 'REDACTED',
        customer_email = 'redacted@privacy.com'
      WHERE customer_email = ?`,
      [customer.email]
    );

    await db.execute(
      `UPDATE email_logs SET
        recipient_email = 'redacted@privacy.com',
        recipient_name = 'REDACTED'
      WHERE recipient_email = ?`,
      [customer.email]
    );

    console.log(`✅ Customer data redacted for ${customer.email}`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('GDPR redaction error:', error);
    res.status(500).json({ error: 'GDPR redaction processing failed' });
  }
});

/**
 * GDPR: Shop Redact
 * Shopify requests deletion of all shop data (after app uninstall + 48 hours)
 */
router.post('/shop/redact', verifyWebhook, async (req, res) => {
  try {
    const data = req.webhookBody;
    const { shop_domain } = data;

    console.log(`🗑️ GDPR Shop Deletion Request for: ${shop_domain}`);

    // Log the GDPR request
    await db.execute(
      `INSERT INTO gdpr_requests (
        shop_domain,
        request_type,
        request_data,
        created_at
      ) VALUES (?, ?, ?, NOW())`,
      [
        shop_domain,
        'shop_redact',
        JSON.stringify(data)
      ]
    );

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop_domain]
    );

    if (shops.length > 0) {
      const shopId = shops[0].id;

      // Delete all shop-related data
      await db.execute('DELETE FROM email_templates WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM email_logs WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM order_items WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM orders WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM products WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM processing_logs WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM scraping_jobs WHERE shop_id = ?', [shopId]);
      await db.execute('DELETE FROM shops WHERE id = ?', [shopId]);

      console.log(`✅ All data deleted for shop: ${shop_domain}`);
    } else {
      console.log(`ℹ️ No data found for shop: ${shop_domain}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('GDPR shop deletion error:', error);
    res.status(500).json({ error: 'GDPR shop deletion processing failed' });
  }
});

export default router;
