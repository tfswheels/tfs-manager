import express from 'express';
import db from '../config/database.js';

const router = express.Router();

/**
 * Zoho Mail Webhook - Receive incoming emails
 * This endpoint is called by Zoho when emails arrive at sales@tfswheels.com
 *
 * Webhook setup in Zoho:
 * 1. Go to Zoho Mail Settings > Webhooks
 * 2. Create webhook for "New Email Received" event
 * 3. Set URL to: https://your-domain.com/webhooks/zoho/email-received
 * 4. Copy the webhook secret and store in shop_settings.zoho_webhook_secret
 */
router.post('/email-received', express.json(), async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    console.log('📧 Zoho webhook received:', JSON.stringify(req.body, null, 2));

    // Get shop ID and webhook secret
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Get webhook secret for verification
    const [settings] = await db.execute(
      'SELECT zoho_webhook_secret FROM shop_settings WHERE shop_id = ?',
      [shopId]
    );

    // TODO: Verify webhook signature if Zoho provides one
    // For now, we'll proceed without verification but log everything

    // Log the webhook event
    await db.execute(
      `INSERT INTO zoho_webhook_logs (
        shop_id,
        event_type,
        payload,
        processed,
        created_at
      ) VALUES (?, 'email.received', ?, FALSE, NOW())`,
      [shopId, JSON.stringify(req.body)]
    );

    // Extract email data from Zoho webhook payload
    // Zoho webhook structure may vary - adjust based on actual payload
    const emailData = extractEmailData(req.body);

    if (!emailData) {
      console.error('❌ Failed to extract email data from webhook');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Try to auto-associate email with an order
    const orderId = await findOrderByEmail(shopId, emailData.from_email);

    // Store incoming email in database
    const [result] = await db.execute(
      `INSERT INTO customer_emails (
        shop_id,
        order_id,
        zoho_message_id,
        from_email,
        from_name,
        to_email,
        subject,
        body_text,
        body_html,
        thread_id,
        in_reply_to,
        status,
        received_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, NOW(), NOW())`,
      [
        shopId,
        orderId,
        emailData.message_id,
        emailData.from_email,
        emailData.from_name,
        emailData.to_email,
        emailData.subject,
        emailData.body_text,
        emailData.body_html,
        emailData.thread_id,
        emailData.in_reply_to,
        emailData.received_at
      ]
    );

    const customerEmailId = result.insertId;

    // Update or create email conversation
    await updateEmailConversation(shopId, orderId, emailData);

    console.log(`✅ Stored incoming email #${customerEmailId} from ${emailData.from_email}`);

    // Mark webhook as processed
    await db.execute(
      'UPDATE zoho_webhook_logs SET processed = TRUE WHERE shop_id = ? AND created_at = (SELECT MAX(created_at) FROM zoho_webhook_logs WHERE shop_id = ?)',
      [shopId, shopId]
    );

    res.json({
      success: true,
      message: 'Email received and processed',
      customerEmailId: customerEmailId,
      associatedOrderId: orderId
    });

  } catch (error) {
    console.error('❌ Zoho webhook error:', error);
    res.status(500).json({
      error: 'Failed to process webhook',
      message: error.message
    });
  }
});

/**
 * Extract email data from Zoho webhook payload
 * Adjust this based on actual Zoho webhook structure
 */
function extractEmailData(payload) {
  try {
    // Zoho Mail webhook payload structure (may need adjustment based on actual payload)
    // This is a best-guess structure - adjust when you see real webhook data

    const email = payload.email || payload.message || payload;

    return {
      message_id: email.messageId || email.id || null,
      from_email: email.from?.address || email.fromAddress || email.from || null,
      from_name: email.from?.name || email.fromName || null,
      to_email: email.to?.address || email.toAddress || email.to || 'sales@tfswheels.com',
      subject: email.subject || '',
      body_text: email.textBody || email.bodyText || email.body || '',
      body_html: email.htmlBody || email.bodyHtml || null,
      thread_id: email.threadId || email.conversationId || null,
      in_reply_to: email.inReplyTo || email.references?.[0] || null,
      received_at: email.receivedTime || email.date || new Date()
    };
  } catch (error) {
    console.error('❌ Error extracting email data:', error);
    return null;
  }
}

/**
 * Find order by customer email
 */
async function findOrderByEmail(shopId, email) {
  if (!email) return null;

  try {
    const [orders] = await db.execute(
      `SELECT id FROM orders
       WHERE shop_id = ? AND customer_email = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId, email]
    );

    return orders.length > 0 ? orders[0].id : null;
  } catch (error) {
    console.error('Error finding order by email:', error);
    return null;
  }
}

/**
 * Update or create email conversation
 */
async function updateEmailConversation(shopId, orderId, emailData) {
  try {
    const threadId = emailData.thread_id || `thread-${Date.now()}`;

    // Check if conversation exists
    const [conversations] = await db.execute(
      'SELECT id, message_count FROM email_conversations WHERE thread_id = ? AND shop_id = ?',
      [threadId, shopId]
    );

    if (conversations.length > 0) {
      // Update existing conversation
      const conversation = conversations[0];
      await db.execute(
        `UPDATE email_conversations
         SET message_count = message_count + 1,
             last_message_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [conversation.id]
      );
    } else {
      // Create new conversation
      await db.execute(
        `INSERT INTO email_conversations (
          shop_id,
          order_id,
          thread_id,
          subject,
          participants,
          message_count,
          last_message_at,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, NOW(), 'active', NOW(), NOW())`,
        [
          shopId,
          orderId,
          threadId,
          emailData.subject,
          JSON.stringify([emailData.from_email, emailData.to_email])
        ]
      );
    }
  } catch (error) {
    console.error('Error updating email conversation:', error);
  }
}

/**
 * Test endpoint to simulate incoming email (for development)
 */
router.post('/email-received/test', express.json(), async (req, res) => {
  try {
    console.log('🧪 Test email webhook triggered');

    // Simulate Zoho webhook payload
    const testPayload = {
      email: {
        messageId: `test-${Date.now()}`,
        from: {
          address: req.body.from || 'customer@example.com',
          name: req.body.fromName || 'Test Customer'
        },
        to: {
          address: 'sales@tfswheels.com',
          name: 'TFS Wheels'
        },
        subject: req.body.subject || 'Test Email Subject',
        textBody: req.body.body || 'This is a test email body',
        htmlBody: null,
        threadId: req.body.threadId || null,
        inReplyTo: null,
        receivedTime: new Date().toISOString()
      }
    };

    // Forward to actual webhook handler
    req.body = testPayload;
    return router.handle({ ...req, method: 'POST', url: '/email-received' }, res);

  } catch (error) {
    console.error('❌ Test webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
