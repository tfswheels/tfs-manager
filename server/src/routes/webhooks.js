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
 * Extract vehicle info from order webhook data
 */
function extractVehicleInfoFromWebhook(order) {
  let vehicleInfo = null;

  // 1. Check line items properties
  if (order.line_items) {
    for (const item of order.line_items) {
      if (item.properties && Array.isArray(item.properties)) {
        for (const prop of item.properties) {
          const propName = prop.name ? prop.name.toLowerCase() : '';
          if (propName === 'vehicle' || propName === '_vehicle') {
            vehicleInfo = prop.value;
            break;
          }
        }
      }
      if (vehicleInfo) break;
    }
  }

  // 2. Check order note
  if (!vehicleInfo && order.note) {
    const vehicleMatch = order.note.match(/Vehicle:\s*(.+?)(?:\n|$)/i);
    if (vehicleMatch) {
      vehicleInfo = vehicleMatch[1].trim();
    }
  }

  // 3. Check note_attributes
  if (!vehicleInfo && order.note_attributes && Array.isArray(order.note_attributes)) {
    for (const attr of order.note_attributes) {
      const attrName = attr.name ? attr.name.toLowerCase() : '';
      if (attrName === 'vehicle') {
        vehicleInfo = attr.value;
        break;
      }
    }
  }

  return vehicleInfo;
}

/**
 * Parse vehicle string into components
 */
function parseVehicleInfoFromWebhook(vehicleStr) {
  if (!vehicleStr) {
    return { year: null, make: null, model: null, trim: null };
  }

  const parts = vehicleStr.trim().split(/\s+/);
  const result = { year: null, make: null, model: null, trim: null };

  if (parts.length >= 1 && parts[0].match(/^\d{4}$/)) {
    result.year = parts[0];
    if (parts.length >= 2) result.make = parts[1];
    if (parts.length >= 3) result.model = parts[2];
    if (parts.length >= 4) result.trim = parts.slice(3).join(' ');
  } else {
    if (parts.length >= 1) result.make = parts[0];
    if (parts.length >= 2) result.model = parts[1];
    if (parts.length >= 3) result.trim = parts.slice(2).join(' ');
  }

  return result;
}

/**
 * Orders Create Webhook
 * Triggered when a new order is created in Shopify
 */
router.post('/create', verifyWebhook, async (req, res) => {
  try {
    const order = req.webhookBody;
    const shop = req.headers['x-shopify-shop-domain'] || '2f3d7a-2.myshopify.com';

    console.log(`📦 New order received: ${order.name} (${order.id}) from ${shop}`);

    // Get shop_id
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      console.error(`❌ Shop not found: ${shop}`);
      return res.status(200).json({ received: true }); // Return 200 to acknowledge webhook
    }

    const shopId = shops[0].id;

    // Extract vehicle info
    const vehicleStr = extractVehicleInfoFromWebhook(order);
    const vehicleInfo = parseVehicleInfoFromWebhook(vehicleStr);

    if (vehicleStr) {
      console.log(`  ✓ Found vehicle: ${vehicleStr}`);
    }

    // Save order to database with vehicle info
    await db.execute(
      `INSERT INTO orders (
        shop_id,
        shopify_order_id,
        order_number,
        customer_name,
        customer_email,
        total_price,
        financial_status,
        fulfillment_status,
        tags,
        vehicle_year,
        vehicle_make,
        vehicle_model,
        vehicle_trim,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        order_number = VALUES(order_number),
        customer_name = VALUES(customer_name),
        customer_email = VALUES(customer_email),
        total_price = VALUES(total_price),
        financial_status = VALUES(financial_status),
        fulfillment_status = VALUES(fulfillment_status),
        tags = VALUES(tags),
        vehicle_year = VALUES(vehicle_year),
        vehicle_make = VALUES(vehicle_make),
        vehicle_model = VALUES(vehicle_model),
        vehicle_trim = VALUES(vehicle_trim),
        updated_at = NOW()`,
      [
        shopId,
        order.id,
        order.name,
        `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
        order.customer?.email || null,
        parseFloat(order.total_price),
        order.financial_status,
        order.fulfillment_status || 'unfulfilled',
        order.tags || null,
        vehicleInfo.year,
        vehicleInfo.make,
        vehicleInfo.model,
        vehicleInfo.trim,
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

    // Extract vehicle info
    const vehicleStr = extractVehicleInfoFromWebhook(order);
    const vehicleInfo = parseVehicleInfoFromWebhook(vehicleStr);

    if (vehicleStr) {
      console.log(`  ✓ Found vehicle: ${vehicleStr}`);
    }

    // Update order in database with vehicle info
    await db.execute(
      `UPDATE orders SET
        financial_status = ?,
        fulfillment_status = ?,
        total_price = ?,
        tags = ?,
        vehicle_year = ?,
        vehicle_make = ?,
        vehicle_model = ?,
        vehicle_trim = ?,
        updated_at = NOW()
      WHERE shopify_order_id = ?`,
      [
        order.financial_status,
        order.fulfillment_status || 'unfulfilled',
        parseFloat(order.total_price),
        order.tags || null,
        vehicleInfo.year,
        vehicleInfo.make,
        vehicleInfo.model,
        vehicleInfo.trim,
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
