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

    // Get raw body (already parsed as Buffer by express.raw middleware)
    const rawBody = req.body;

    // Calculate HMAC
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(rawBody, 'utf8')
      .digest('base64');

    if (hash !== hmacHeader) {
      console.error('HMAC verification failed');
      return res.status(401).json({ error: 'Unauthorized - Invalid HMAC' });
    }

    // Parse JSON body for use in handlers
    req.webhookBody = JSON.parse(rawBody.toString());
    next();
  } catch (error) {
    console.error('Webhook verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

/**
 * Orders Create Webhook
 * Triggered when a new order is created in Shopify
 */
router.post('/create', verifyWebhook, async (req, res) => {
  try {
    const order = req.webhookBody;

    console.log(`📦 New order received: ${order.name} (${order.id})`);

    // Save order to database
    await db.execute(
      `INSERT INTO orders (
        shopify_order_id,
        order_number,
        customer_name,
        customer_email,
        total_price,
        financial_status,
        fulfillment_status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        order_number = VALUES(order_number),
        customer_name = VALUES(customer_name),
        customer_email = VALUES(customer_email),
        total_price = VALUES(total_price),
        financial_status = VALUES(financial_status),
        fulfillment_status = VALUES(fulfillment_status)`,
      [
        order.id,
        order.name,
        `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
        order.customer?.email || null,
        parseFloat(order.total_price),
        order.financial_status,
        order.fulfillment_status || 'unfulfilled',
        new Date(order.created_at)
      ]
    );

    // Save line items
    for (const item of order.line_items || []) {
      await db.execute(
        `INSERT INTO order_items (
          shopify_order_id,
          product_id,
          variant_id,
          title,
          quantity,
          price
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          quantity = VALUES(quantity),
          price = VALUES(price)`,
        [
          order.id,
          item.product_id,
          item.variant_id,
          item.title,
          item.quantity,
          parseFloat(item.price)
        ]
      );
    }

    console.log(`✅ Order ${order.name} saved successfully`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Orders create webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Orders Updated Webhook
 * Triggered when an order is updated in Shopify
 */
router.post('/updated', verifyWebhook, async (req, res) => {
  try {
    const order = req.webhookBody;

    console.log(`📝 Order updated: ${order.name} (${order.id})`);

    // Update order in database
    await db.execute(
      `UPDATE orders SET
        financial_status = ?,
        fulfillment_status = ?,
        total_price = ?,
        updated_at = NOW()
      WHERE shopify_order_id = ?`,
      [
        order.financial_status,
        order.fulfillment_status || 'unfulfilled',
        parseFloat(order.total_price),
        order.id
      ]
    );

    console.log(`✅ Order ${order.name} updated successfully`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Orders updated webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Products Create Webhook
 * Triggered when a new product is created in Shopify
 */
router.post('/products/create', verifyWebhook, async (req, res) => {
  try {
    const product = req.webhookBody;

    console.log(`🆕 New product: ${product.title} (${product.id})`);

    await db.execute(
      `INSERT INTO products (
        shopify_product_id,
        title,
        vendor,
        product_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        vendor = VALUES(vendor),
        product_type = VALUES(product_type)`,
      [
        product.id,
        product.title,
        product.vendor || null,
        product.product_type || null,
        new Date(product.created_at)
      ]
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Products create webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Products Update Webhook
 * Triggered when a product is updated in Shopify
 */
router.post('/products/update', verifyWebhook, async (req, res) => {
  try {
    const product = req.webhookBody;

    console.log(`📝 Product updated: ${product.title} (${product.id})`);

    await db.execute(
      `UPDATE products SET
        title = ?,
        vendor = ?,
        product_type = ?,
        updated_at = NOW()
      WHERE shopify_product_id = ?`,
      [
        product.title,
        product.vendor || null,
        product.product_type || null,
        product.id
      ]
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Products update webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
