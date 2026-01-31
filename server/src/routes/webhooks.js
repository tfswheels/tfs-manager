import express from 'express';
import crypto from 'crypto';
import db from '../config/database.js';
import { shopify } from '../config/shopify.js';
import { fetchEmailDetails } from '../services/zohoMailEnhanced.js';
import { findOrCreateConversation, saveEmail } from '../services/emailThreading.js';

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

    // Use timing-safe comparison to prevent timing attacks
    const isValid = shopify.auth.safeCompare(hash, hmacHeader);

    if (!isValid) {
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
          sku,
          title,
          quantity,
          price
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          sku = VALUES(sku),
          quantity = VALUES(quantity),
          price = VALUES(price)`,
        [
          order.id,
          item.product_id,
          item.variant_id,
          item.sku || null,
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

    // Sync line items (delete old ones and re-insert to handle additions/removals)
    if (order.line_items && order.line_items.length > 0) {
      // Delete existing line items for this order
      await db.execute(
        'DELETE FROM order_items WHERE shopify_order_id = ?',
        [order.id]
      );

      // Re-insert all current line items
      for (const item of order.line_items) {
        await db.execute(
          `INSERT INTO order_items (
            shopify_order_id,
            product_id,
            variant_id,
            sku,
            title,
            quantity,
            price
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            order.id,
            item.product_id,
            item.variant_id,
            item.sku || null,
            item.title,
            item.quantity,
            parseFloat(item.price)
          ]
        );
      }
      console.log(`  ✓ Synced ${order.line_items.length} line items`);
    }

    console.log(`✅ Order ${order.name} updated successfully`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Orders updated webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * ============================================================================
 * EMAIL TRACKING (Open & Click Tracking)
 * ============================================================================
 */

/**
 * GET /track/open/:emailLogId/pixel.gif
 * Tracking pixel for email opens
 */
router.get('/track/open/:emailLogId/pixel.gif', async (req, res) => {
  try {
    const emailLogId = parseInt(req.params.emailLogId);

    // Check if email_delivery_stats record exists
    const [existing] = await db.execute(
      'SELECT * FROM email_delivery_stats WHERE email_log_id = ?',
      [emailLogId]
    );

    if (existing.length === 0) {
      // Create new stats record
      await db.execute(
        `INSERT INTO email_delivery_stats (
          email_log_id,
          opened_at,
          open_count,
          user_agent,
          ip_address
        ) VALUES (?, NOW(), 1, ?, ?)`,
        [
          emailLogId,
          req.headers['user-agent'] || null,
          req.ip || req.headers['x-forwarded-for'] || null
        ]
      );

      console.log(`📧 Email #${emailLogId} opened (first time)`);
    } else {
      // Increment open count (opened_at stays as first open time)
      await db.execute(
        `UPDATE email_delivery_stats
         SET open_count = open_count + 1,
             user_agent = ?,
             ip_address = ?
         WHERE email_log_id = ?`,
        [
          req.headers['user-agent'] || existing[0].user_agent,
          req.ip || req.headers['x-forwarded-for'] || existing[0].ip_address,
          emailLogId
        ]
      );

      console.log(`📧 Email #${emailLogId} opened again (count: ${existing[0].open_count + 1})`);
    }

    // Update email log status
    await db.execute(
      `UPDATE email_logs
       SET status = 'delivered'
       WHERE id = ? AND status = 'sent'`,
      [emailLogId]
    );

    // Return 1x1 transparent GIF
    const transparentGif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );

    res.set('Content-Type', 'image/gif');
    res.set('Content-Length', transparentGif.length);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(transparentGif);

  } catch (error) {
    console.error('❌ Open tracking failed:', error);

    // Still return the pixel even on error
    const transparentGif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    res.set('Content-Type', 'image/gif');
    res.send(transparentGif);
  }
});

/**
 * GET /track/click/:emailLogId
 * Click tracking and redirect
 */
router.get('/track/click/:emailLogId', async (req, res) => {
  try {
    const emailLogId = parseInt(req.params.emailLogId);
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).send('Missing target URL');
    }

    // Check if email_delivery_stats record exists
    const [existing] = await db.execute(
      'SELECT * FROM email_delivery_stats WHERE email_log_id = ?',
      [emailLogId]
    );

    if (existing.length === 0) {
      // Create new stats record with click
      await db.execute(
        `INSERT INTO email_delivery_stats (
          email_log_id,
          clicked_at,
          click_count,
          user_agent,
          ip_address
        ) VALUES (?, NOW(), 1, ?, ?)`,
        [
          emailLogId,
          req.headers['user-agent'] || null,
          req.ip || req.headers['x-forwarded-for'] || null
        ]
      );

      console.log(`🖱️  Email #${emailLogId} link clicked (first time): ${targetUrl}`);
    } else {
      // Update click stats (clicked_at stays as first click time)
      await db.execute(
        `UPDATE email_delivery_stats
         SET clicked_at = COALESCE(clicked_at, NOW()),
             click_count = click_count + 1,
             user_agent = ?,
             ip_address = ?
         WHERE email_log_id = ?`,
        [
          req.headers['user-agent'] || existing[0].user_agent,
          req.ip || req.headers['x-forwarded-for'] || existing[0].ip_address,
          emailLogId
        ]
      );

      console.log(`🖱️  Email #${emailLogId} link clicked again (count: ${existing[0].click_count + 1})`);
    }

    // Redirect to target URL
    res.redirect(targetUrl);

  } catch (error) {
    console.error('❌ Click tracking failed:', error);

    // Still redirect even on error
    const targetUrl = req.query.url;
    if (targetUrl) {
      res.redirect(targetUrl);
    } else {
      res.status(400).send('Missing target URL');
    }
  }
});

/**
 * ============================================================================
 * ZOHO MAIL WEBHOOKS
 * ============================================================================
 */

/**
 * POST /zoho/email-received
 * Zoho webhook for new incoming emails
 *
 * Note: This is supplementary to polling - provides real-time notifications
 */
router.post('/zoho/email-received', async (req, res) => {
  try {
    const { messageId, accountEmail, fromAddress, subject } = req.body;

    console.log(`📨 Webhook: New email received - ${messageId}`);

    // Log webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        processed_at
      ) VALUES ('email.received', ?, NOW())`,
      [JSON.stringify(req.body)]
    );

    // Check if we already processed this email
    const [existing] = await db.execute(
      'SELECT id FROM customer_emails WHERE zoho_message_id = ?',
      [messageId]
    );

    if (existing.length > 0) {
      console.log(`⏭️  Email ${messageId} already processed, skipping`);
      return res.json({ success: true, message: 'Already processed' });
    }

    // Determine shop ID (default to 1 for now)
    const shopId = 1;

    // If support@ email, check if it's related to an order
    if (accountEmail === 'support@tfswheels.com') {
      const [orders] = await db.execute(
        'SELECT id FROM orders WHERE customer_email = ?',
        [fromAddress]
      );

      if (orders.length === 0) {
        console.log(`⏭️  Skipping support email from ${fromAddress} - no order found`);
        return res.json({ success: true, message: 'Not order-related' });
      }
    }

    // Fetch full email details from Zoho
    const fullEmail = await fetchEmailDetails(shopId, messageId, accountEmail);

    // Find or create conversation thread
    const emailData = {
      subject: fullEmail.subject,
      fromEmail: fullEmail.fromAddress,
      fromName: fullEmail.sender?.name || fullEmail.fromAddress,
      toEmail: accountEmail,
      toName: 'TFS Wheels',
      messageId: fullEmail.messageId,
      inReplyTo: fullEmail.inReplyTo,
      references: fullEmail.references,
      direction: 'inbound'
    };

    const conversationId = await findOrCreateConversation(shopId, emailData);

    // Save email to database
    await saveEmail(shopId, conversationId, {
      zohoMessageId: fullEmail.messageId,
      messageId: fullEmail.messageId,
      inReplyTo: fullEmail.inReplyTo,
      references: fullEmail.references,
      direction: 'inbound',
      fromEmail: fullEmail.fromAddress,
      fromName: fullEmail.sender?.name || fullEmail.fromAddress,
      toEmail: accountEmail,
      toName: 'TFS Wheels',
      cc: fullEmail.cc,
      subject: fullEmail.subject,
      bodyText: fullEmail.content?.plainContent || fullEmail.content,
      bodyHtml: fullEmail.content?.htmlContent || null,
      receivedAt: new Date(fullEmail.receivedTime)
    });

    console.log(`✅ Webhook: Email ${messageId} processed successfully`);

    res.json({
      success: true,
      message: 'Email processed',
      conversationId: conversationId
    });

  } catch (error) {
    console.error('❌ Webhook email processing failed:', error);

    // Log failed webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        error_message,
        processed_at
      ) VALUES ('email.received', ?, ?, NOW())`,
      [JSON.stringify(req.body), error.message]
    );

    // Return 200 even on error to prevent Zoho from retrying
    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /zoho/bounce
 * Zoho webhook for email bounces
 */
router.post('/zoho/bounce', async (req, res) => {
  try {
    const {
      messageId,
      toAddress,
      bounceType,
      bounceReason,
      timestamp
    } = req.body;

    console.log(`⚠️  Webhook: Email bounced - ${messageId} (${bounceType})`);

    // Log webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        processed_at
      ) VALUES ('email.bounced', ?, NOW())`,
      [JSON.stringify(req.body)]
    );

    // Find email log by message ID
    const [logs] = await db.execute(
      'SELECT id FROM email_logs WHERE zoho_message_id = ?',
      [messageId]
    );

    if (logs.length === 0) {
      console.log(`⚠️  Email log not found for message ${messageId}`);
      return res.json({ success: true, message: 'Email log not found' });
    }

    const emailLogId = logs[0].id;

    // Update email log status
    await db.execute(
      `UPDATE email_logs
       SET status = 'bounced',
           error_message = ?
       WHERE id = ?`,
      [bounceReason, emailLogId]
    );

    // Update or create delivery stats
    const [existing] = await db.execute(
      'SELECT * FROM email_delivery_stats WHERE email_log_id = ?',
      [emailLogId]
    );

    if (existing.length === 0) {
      await db.execute(
        `INSERT INTO email_delivery_stats (
          email_log_id,
          bounced_at,
          bounce_type,
          bounce_reason
        ) VALUES (?, ?, ?, ?)`,
        [emailLogId, timestamp || new Date(), bounceType, bounceReason]
      );
    } else {
      await db.execute(
        `UPDATE email_delivery_stats
         SET bounced_at = ?,
             bounce_type = ?,
             bounce_reason = ?
         WHERE email_log_id = ?`,
        [timestamp || new Date(), bounceType, bounceReason, emailLogId]
      );
    }

    console.log(`✅ Webhook: Bounce recorded for email #${emailLogId}`);

    res.json({
      success: true,
      message: 'Bounce recorded'
    });

  } catch (error) {
    console.error('❌ Webhook bounce processing failed:', error);

    // Log failed webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        error_message,
        processed_at
      ) VALUES ('email.bounced', ?, ?, NOW())`,
      [JSON.stringify(req.body), error.message]
    );

    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /zoho/spam
 * Zoho webhook for spam reports
 */
router.post('/zoho/spam', async (req, res) => {
  try {
    const {
      messageId,
      toAddress,
      timestamp
    } = req.body;

    console.log(`🚫 Webhook: Spam reported - ${messageId}`);

    // Log webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        processed_at
      ) VALUES ('email.spam', ?, NOW())`,
      [JSON.stringify(req.body)]
    );

    // Find email log by message ID
    const [logs] = await db.execute(
      'SELECT id FROM email_logs WHERE zoho_message_id = ?',
      [messageId]
    );

    if (logs.length === 0) {
      console.log(`⚠️  Email log not found for message ${messageId}`);
      return res.json({ success: true, message: 'Email log not found' });
    }

    const emailLogId = logs[0].id;

    // Update email log status
    await db.execute(
      `UPDATE email_logs
       SET status = 'spam_reported'
       WHERE id = ?`,
      [emailLogId]
    );

    // Update or create delivery stats
    const [existing] = await db.execute(
      'SELECT * FROM email_delivery_stats WHERE email_log_id = ?',
      [emailLogId]
    );

    if (existing.length === 0) {
      await db.execute(
        `INSERT INTO email_delivery_stats (
          email_log_id,
          spam_reported_at
        ) VALUES (?, ?)`,
        [emailLogId, timestamp || new Date()]
      );
    } else {
      await db.execute(
        `UPDATE email_delivery_stats
         SET spam_reported_at = ?
         WHERE email_log_id = ?`,
        [timestamp || new Date(), emailLogId]
      );
    }

    console.log(`✅ Webhook: Spam report recorded for email #${emailLogId}`);

    res.json({
      success: true,
      message: 'Spam report recorded'
    });

  } catch (error) {
    console.error('❌ Webhook spam processing failed:', error);

    // Log failed webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        error_message,
        processed_at
      ) VALUES ('email.spam', ?, ?, NOW())`,
      [JSON.stringify(req.body), error.message]
    );

    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /zoho/delivery
 * Zoho webhook for successful delivery confirmation
 */
router.post('/zoho/delivery', async (req, res) => {
  try {
    const {
      messageId,
      toAddress,
      timestamp
    } = req.body;

    console.log(`✅ Webhook: Email delivered - ${messageId}`);

    // Log webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        processed_at
      ) VALUES ('email.delivered', ?, NOW())`,
      [JSON.stringify(req.body)]
    );

    // Find email log by message ID
    const [logs] = await db.execute(
      'SELECT id FROM email_logs WHERE zoho_message_id = ?',
      [messageId]
    );

    if (logs.length === 0) {
      console.log(`⚠️  Email log not found for message ${messageId}`);
      return res.json({ success: true, message: 'Email log not found' });
    }

    const emailLogId = logs[0].id;

    // Update email log status (only if not already opened)
    await db.execute(
      `UPDATE email_logs
       SET status = 'delivered'
       WHERE id = ? AND status = 'sent'`,
      [emailLogId]
    );

    console.log(`✅ Webhook: Delivery confirmed for email #${emailLogId}`);

    res.json({
      success: true,
      message: 'Delivery confirmed'
    });

  } catch (error) {
    console.error('❌ Webhook delivery processing failed:', error);

    // Log failed webhook
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        event_type,
        payload,
        error_message,
        processed_at
      ) VALUES ('email.delivered', ?, ?, NOW())`,
      [JSON.stringify(req.body), error.message]
    );

    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * WEBHOOK VERIFICATION (for Zoho webhook setup)
 * ============================================================================
 */

/**
 * GET /zoho/verify
 * Verification endpoint for Zoho webhook setup
 */
router.get('/zoho/verify', (req, res) => {
  const challenge = req.query.challenge;

  if (challenge) {
    console.log('✅ Zoho webhook verification successful');
    res.send(challenge);
  } else {
    res.status(400).send('Missing challenge parameter');
  }
});

export default router;
