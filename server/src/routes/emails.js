import express from 'express';
import db from '../config/database.js';
import { sendEmail, fetchInbox, fetchEmailDetails, markAsRead, archiveEmail, addEmailTracking } from '../services/zohoMailEnhanced.js';
import { generateEmailResponse, generateThreadSummary, improveDraft } from '../services/claudeAI.js';
import { findOrCreateConversation, saveEmail, markConversationAsRead, getConversationWithEmails, updateConversationPriority, closeConversation, archiveConversation } from '../services/emailThreading.js';
import { buildPlaceholderData, resolvePlaceholders, resolveEmailTemplate, getTemplatePreview, validatePlaceholders, getPlaceholderSuggestions, getAvailablePlaceholders } from '../services/placeholderResolver.js';
import { syncAllInboxes, getSyncStatus } from '../services/emailInboxSync.js';

const router = express.Router();

/**
 * ============================================================================
 * EMAIL COMPOSITION & SENDING
 * ============================================================================
 */

/**
 * POST /api/emails/compose
 * Create a new email draft with placeholder resolution
 */
router.post('/compose', async (req, res) => {
  try {
    const {
      to,
      toName,
      subject,
      body,
      templateId,
      orderId,
      customerId,
      customerEmail,
      customerName,
      conversationId
    } = req.body;

    const shopId = req.user?.shopId || 1;

    // Build placeholder context
    const context = {
      orderId,
      customerId,
      customerEmail,
      customerName
    };

    // If using template, load and resolve it
    let resolvedSubject = subject;
    let resolvedBody = body;

    if (templateId) {
      const preview = await getTemplatePreview(templateId, context);
      resolvedSubject = preview.subject;
      resolvedBody = preview.body;
    } else if (subject && body) {
      // Resolve placeholders in provided content
      const resolved = await resolveEmailTemplate(subject, body, context);
      resolvedSubject = resolved.subject;
      resolvedBody = resolved.body;
    }

    // Validate placeholders
    const validation = validatePlaceholders(
      resolvedSubject + ' ' + resolvedBody,
      await buildPlaceholderData(context)
    );

    res.json({
      success: true,
      email: {
        to,
        toName,
        subject: resolvedSubject,
        body: resolvedBody,
        conversationId
      },
      validation: validation
    });

  } catch (error) {
    console.error('❌ Email composition failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/send
 * Send email via Zoho with tracking
 */
router.post('/send', async (req, res) => {
  try {
    const {
      to,
      toName,
      subject,
      body,
      bodyHtml,
      fromAddress,
      fromName,
      cc,
      bcc,
      conversationId,
      orderId,
      customerId,
      inReplyTo,
      references,
      isAiGenerated = false,
      aiPrompt = null
    } = req.body;

    const shopId = req.user?.shopId || 1;

    // Create email log entry first (for tracking)
    const [logResult] = await db.execute(
      `INSERT INTO email_logs (
        shop_id, order_id, customer_id, conversation_id,
        to_email, to_name, from_email, from_name,
        subject, body_text, body_html,
        status, is_ai_generated, ai_prompt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?)`,
      [
        shopId, orderId, customerId, conversationId,
        to, toName, fromAddress || 'sales@tfswheels.com', fromName || 'TFS Wheels',
        subject, body, bodyHtml,
        isAiGenerated, aiPrompt
      ]
    );

    const emailLogId = logResult.insertId;

    // Add tracking to HTML body
    let trackedBodyHtml = bodyHtml;
    if (bodyHtml) {
      trackedBodyHtml = addEmailTracking(bodyHtml, emailLogId);
    }

    // Send email via Zoho
    const sendResult = await sendEmail(shopId, {
      to,
      toName,
      subject,
      bodyText: body,
      bodyHtml: trackedBodyHtml,
      fromAddress,
      fromName,
      cc,
      bcc,
      inReplyTo,
      references
    });

    // Update log with message ID and status
    await db.execute(
      `UPDATE email_logs
       SET zoho_message_id = ?,
           status = 'sent',
           sent_at = NOW()
       WHERE id = ?`,
      [sendResult.messageId, emailLogId]
    );

    // Save to customer_emails table for threading
    let finalConversationId = conversationId;

    if (!finalConversationId) {
      // Create new conversation
      const emailData = {
        subject,
        fromEmail: fromAddress || 'sales@tfswheels.com',
        fromName: fromName || 'TFS Wheels',
        toEmail: to,
        toName: toName,
        messageId: sendResult.messageId,
        inReplyTo,
        references,
        direction: 'outbound'
      };

      finalConversationId = await findOrCreateConversation(shopId, emailData);
    }

    // Save email to thread
    await saveEmail(shopId, finalConversationId, {
      zohoMessageId: sendResult.messageId,
      messageId: sendResult.messageId,
      inReplyTo,
      references,
      direction: 'outbound',
      fromEmail: fromAddress || 'sales@tfswheels.com',
      fromName: fromName || 'TFS Wheels',
      toEmail: to,
      toName: toName,
      cc,
      bcc,
      subject,
      bodyText: body,
      bodyHtml: trackedBodyHtml,
      sentAt: new Date(),
      isAiGenerated,
      aiConfidenceScore: null
    });

    res.json({
      success: true,
      messageId: sendResult.messageId,
      emailLogId: emailLogId,
      conversationId: finalConversationId
    });

  } catch (error) {
    console.error('❌ Email send failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/preview
 * Preview email with placeholders resolved
 */
router.post('/preview', async (req, res) => {
  try {
    const {
      subject,
      body,
      orderId,
      customerId,
      customerEmail,
      customerName
    } = req.body;

    const context = {
      orderId,
      customerId,
      customerEmail,
      customerName
    };

    const resolved = await resolveEmailTemplate(subject, body, context);

    res.json({
      success: true,
      preview: {
        subject: resolved.subject,
        body: resolved.body
      },
      resolvedData: resolved.resolvedData
    });

  } catch (error) {
    console.error('❌ Email preview failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * AI EMAIL GENERATION
 * ============================================================================
 */

/**
 * POST /api/emails/ai/generate
 * Generate AI email response
 */
router.post('/ai/generate', async (req, res) => {
  try {
    const {
      prompt,
      conversationId,
      orderId,
      customerId,
      customerEmail,
      customerName,
      voiceName,
      context,
      temperature
    } = req.body;

    const shopId = req.user?.shopId || 1;

    // Build customer data context
    const customerData = await buildPlaceholderData({
      orderId,
      customerId,
      customerEmail,
      customerName
    });

    // Generate response
    const result = await generateEmailResponse(shopId, {
      prompt,
      conversationId,
      orderId,
      customerData,
      voiceName,
      context,
      temperature
    });

    res.json({
      success: true,
      content: result.content,
      metadata: result.metadata
    });

  } catch (error) {
    console.error('❌ AI generation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/ai/improve
 * Improve existing email draft
 */
router.post('/ai/improve', async (req, res) => {
  try {
    const {
      draft,
      instructions,
      voiceName
    } = req.body;

    const shopId = req.user?.shopId || 1;

    const result = await improveDraft(shopId, draft, instructions, voiceName);

    res.json({
      success: true,
      content: result.content,
      metadata: result.metadata
    });

  } catch (error) {
    console.error('❌ Draft improvement failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/threads/:id/summarize
 * Generate AI summary of email thread
 */
router.post('/threads/:id/summarize', async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const shopId = req.user?.shopId || 1;

    const result = await generateThreadSummary(shopId, conversationId);

    res.json({
      success: true,
      summary: result.summary,
      metadata: result.metadata
    });

  } catch (error) {
    console.error('❌ Thread summary failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * INBOX & THREADING
 * ============================================================================
 */

/**
 * GET /api/emails/inbox
 * Fetch inbox with conversations
 */
router.get('/inbox', async (req, res) => {
  try {
    const shopId = req.user?.shopId || 1;
    const {
      status = 'active',
      priority,
      hasOrder,
      limit = 50,
      offset = 0
    } = req.query;

    // Build query
    let query = `
      SELECT
        c.*,
        o.order_number,
        o.customer_name as order_customer_name,
        o.vehicle_year,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_trim,
        (SELECT COUNT(*) FROM customer_emails WHERE conversation_id = c.id AND status = 'unread') as unread_count
      FROM email_conversations c
      LEFT JOIN orders o ON c.order_id = o.id
      WHERE c.shop_id = ?
    `;
    const params = [shopId];

    // Add filters
    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }

    if (priority) {
      query += ' AND c.priority = ?';
      params.push(priority);
    }

    if (hasOrder === 'true') {
      query += ' AND c.order_id IS NOT NULL';
    } else if (hasOrder === 'false') {
      query += ' AND c.order_id IS NULL';
    }

    // Order by last message
    query += ' ORDER BY c.last_message_at DESC';

    // Add pagination (using template literals - MySQL 8.0 doesn't support parameterized LIMIT/OFFSET)
    query += ` LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

    const [conversations] = await db.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM email_conversations c WHERE c.shop_id = ?';
    const countParams = [shopId];

    if (status) {
      countQuery += ' AND c.status = ?';
      countParams.push(status);
    }

    const [countResult] = await db.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      conversations: conversations,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + conversations.length) < total
      }
    });

  } catch (error) {
    console.error('❌ Inbox fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/conversations
 * Fetch conversations (alias for /inbox with frontend-compatible parameters)
 */
router.get('/conversations', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const {
      unreadOnly,
      priority,
      hasOrder,
      limit = 50,
      offset = 0
    } = req.query;

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
        c.*,
        o.order_number,
        o.customer_name as order_customer_name,
        o.vehicle_year,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_trim
      FROM email_conversations c
      LEFT JOIN orders o ON c.order_id = o.id
      WHERE c.shop_id = ?
    `;
    const params = [shopId];

    // Add filters
    if (unreadOnly === 'true') {
      query += ' AND c.unread_count > 0';
    }

    if (priority) {
      query += ' AND c.priority = ?';
      params.push(priority);
    }

    if (hasOrder === 'true') {
      query += ' AND c.order_id IS NOT NULL';
    } else if (hasOrder === 'false') {
      query += ' AND c.order_id IS NULL';
    }

    // Order by last message (active conversations first)
    query += ' AND c.status = \'active\' ORDER BY c.last_message_at DESC';

    // Add pagination (using template literals - MySQL 8.0 doesn't support parameterized LIMIT/OFFSET)
    query += ` LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

    const [conversations] = await db.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM email_conversations c WHERE c.shop_id = ? AND c.status = \'active\'';
    const countParams = [shopId];

    if (unreadOnly === 'true') {
      countQuery += ' AND c.unread_count > 0';
    }

    const [countResult] = await db.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      conversations: conversations,
      total: total,
      count: conversations.length,
      hasMore: (parseInt(offset) + conversations.length) < total
    });

  } catch (error) {
    console.error('❌ Conversations fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/conversations/:id
 * Get single conversation with emails (frontend-compatible alias)
 */
router.get('/conversations/:id', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const conversationId = parseInt(req.params.id);

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const conversation = await getConversationWithEmails(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    // Mark as read
    await markConversationAsRead(conversationId);

    // Transform to frontend-compatible format
    res.json({
      success: true,
      conversation: {
        ...conversation,
        messages: conversation.emails || [],
        customer: conversation.customer_email ? {
          name: conversation.customer_name,
          email: conversation.customer_email
        } : null,
        order: conversation.order_id ? {
          id: conversation.order_id,
          order_number: conversation.order_number,
          vehicle: {
            year: conversation.vehicle_year,
            make: conversation.vehicle_make,
            model: conversation.vehicle_model,
            trim: conversation.vehicle_trim
          }
        } : null
      }
    });

  } catch (error) {
    console.error('❌ Conversation fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/conversations/:id/summary
 * Generate AI summary for conversation
 */
router.post('/conversations/:id/summary', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const conversationId = parseInt(req.params.id);

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    const result = await generateThreadSummary(shopId, conversationId);

    // Save summary to conversation
    await db.execute(
      `UPDATE email_conversations
       SET ai_summary = ?, ai_summary_generated_at = NOW()
       WHERE id = ?`,
      [result.summary, conversationId]
    );

    res.json({
      success: true,
      summary: result.summary,
      metadata: result.metadata
    });

  } catch (error) {
    console.error('❌ Conversation summary failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/threads/:id
 * Get full conversation thread with all emails
 */
router.get('/threads/:id', async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);

    const conversation = await getConversationWithEmails(conversationId);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      conversation: conversation
    });

  } catch (error) {
    console.error('❌ Thread fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/emails/threads/:id/read
 * Mark conversation as read
 */
router.put('/threads/:id/read', async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);

    await markConversationAsRead(conversationId);

    res.json({
      success: true,
      message: 'Conversation marked as read'
    });

  } catch (error) {
    console.error('❌ Mark as read failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/emails/threads/:id/priority
 * Update conversation priority
 */
router.put('/threads/:id/priority', async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const { priority } = req.body;

    if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid priority value'
      });
    }

    await updateConversationPriority(conversationId, priority);

    res.json({
      success: true,
      message: 'Priority updated'
    });

  } catch (error) {
    console.error('❌ Priority update failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/emails/threads/:id/close
 * Close conversation
 */
router.put('/threads/:id/close', async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);

    await closeConversation(conversationId);

    res.json({
      success: true,
      message: 'Conversation closed'
    });

  } catch (error) {
    console.error('❌ Close conversation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/emails/threads/:id/archive
 * Archive conversation
 */
router.put('/threads/:id/archive', async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);

    await archiveConversation(conversationId);

    res.json({
      success: true,
      message: 'Conversation archived'
    });

  } catch (error) {
    console.error('❌ Archive conversation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * EMAIL TEMPLATES
 * ============================================================================
 */

/**
 * GET /api/emails/templates
 * Get all email templates
 */
router.get('/templates', async (req, res) => {
  try {
    const shopId = req.user?.shopId || 1;
    const { category, isActive = 'true' } = req.query;

    let query = 'SELECT * FROM email_templates WHERE shop_id = ?';
    const params = [shopId];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (isActive === 'true') {
      query += ' AND is_active = TRUE';
    }

    query += ' ORDER BY category, name';

    const [templates] = await db.execute(query, params);

    res.json({
      success: true,
      templates: templates
    });

  } catch (error) {
    console.error('❌ Template fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/templates/:id
 * Get single template
 */
router.get('/templates/:id', async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);

    const [templates] = await db.execute(
      'SELECT * FROM email_templates WHERE id = ?',
      [templateId]
    );

    if (templates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      template: templates[0]
    });

  } catch (error) {
    console.error('❌ Template fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/templates/:id/preview
 * Preview template with sample data
 */
router.get('/templates/:id/preview', async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const { orderId, customerId, customerEmail } = req.query;

    const context = {
      orderId: orderId ? parseInt(orderId) : null,
      customerId: customerId ? parseInt(customerId) : null,
      customerEmail: customerEmail
    };

    const preview = await getTemplatePreview(templateId, context);

    res.json({
      success: true,
      preview: preview
    });

  } catch (error) {
    console.error('❌ Template preview failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/templates
 * Create new email template
 */
router.post('/templates', async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      subject,
      body,
      variables
    } = req.body;

    const shopId = req.user?.shopId || 1;

    const [result] = await db.execute(
      `INSERT INTO email_templates (
        shop_id, name, description, category,
        subject, body, variables, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        shopId,
        name,
        description,
        category,
        subject,
        body,
        JSON.stringify(variables || [])
      ]
    );

    res.json({
      success: true,
      templateId: result.insertId,
      message: 'Template created successfully'
    });

  } catch (error) {
    console.error('❌ Template creation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/emails/templates/:id
 * Update email template
 */
router.put('/templates/:id', async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);
    const {
      name,
      description,
      category,
      subject,
      body,
      variables,
      isActive
    } = req.body;

    await db.execute(
      `UPDATE email_templates
       SET name = ?,
           description = ?,
           category = ?,
           subject = ?,
           body = ?,
           variables = ?,
           is_active = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        name,
        description,
        category,
        subject,
        body,
        JSON.stringify(variables || []),
        isActive !== undefined ? isActive : true,
        templateId
      ]
    );

    res.json({
      success: true,
      message: 'Template updated successfully'
    });

  } catch (error) {
    console.error('❌ Template update failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/emails/templates/:id
 * Delete email template
 */
router.delete('/templates/:id', async (req, res) => {
  try {
    const templateId = parseInt(req.params.id);

    await db.execute(
      'DELETE FROM email_templates WHERE id = ?',
      [templateId]
    );

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });

  } catch (error) {
    console.error('❌ Template deletion failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * PLACEHOLDERS
 * ============================================================================
 */

/**
 * GET /api/emails/placeholders
 * Get available placeholders
 */
router.get('/placeholders', async (req, res) => {
  try {
    const { category } = req.query;

    const placeholders = await getAvailablePlaceholders(category);

    res.json({
      success: true,
      placeholders: placeholders
    });

  } catch (error) {
    console.error('❌ Placeholder fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/placeholders/suggestions
 * Get placeholder suggestions for context
 */
router.get('/placeholders/suggestions', async (req, res) => {
  try {
    const { orderId, customerId } = req.query;

    const context = {
      orderId: orderId ? parseInt(orderId) : null,
      customerId: customerId ? parseInt(customerId) : null
    };

    const suggestions = await getPlaceholderSuggestions(context);

    res.json({
      success: true,
      suggestions: suggestions
    });

  } catch (error) {
    console.error('❌ Placeholder suggestions failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * SYNC STATUS & MANAGEMENT
 * ============================================================================
 */

/**
 * GET /api/emails/sync/status
 * Get sync status
 */
router.get('/sync/status', async (req, res) => {
  try {
    const status = getSyncStatus();

    res.json({
      success: true,
      status: status
    });

  } catch (error) {
    console.error('❌ Sync status fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/emails/sync/now
 * Trigger manual sync
 */
router.post('/sync/now', async (req, res) => {
  try {
    const shopId = req.user?.shopId || 1;

    const result = await syncAllInboxes(shopId);

    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    console.error('❌ Manual sync failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ============================================================================
 * DELIVERABILITY STATS
 * ============================================================================
 */

/**
 * GET /api/emails/stats/deliverability
 * Get deliverability statistics
 */
router.get('/stats/deliverability', async (req, res) => {
  try {
    const shopId = req.user?.shopId || 1;
    const { startDate, endDate } = req.query;

    let query = `
      SELECT
        COUNT(DISTINCT el.id) as total_sent,
        COUNT(DISTINCT eds.email_log_id) as total_opened,
        SUM(eds.open_count) as total_opens,
        COUNT(DISTINCT CASE WHEN eds.clicked_at IS NOT NULL THEN eds.email_log_id END) as total_clicked,
        SUM(eds.click_count) as total_clicks,
        COUNT(DISTINCT CASE WHEN eds.bounced_at IS NOT NULL THEN eds.email_log_id END) as total_bounced,
        COUNT(DISTINCT CASE WHEN eds.spam_reported_at IS NOT NULL THEN eds.email_log_id END) as total_spam
      FROM email_logs el
      LEFT JOIN email_delivery_stats eds ON el.id = eds.email_log_id
      WHERE el.shop_id = ? AND el.status = 'sent'
    `;
    const params = [shopId];

    if (startDate) {
      query += ' AND el.sent_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND el.sent_at <= ?';
      params.push(endDate);
    }

    const [stats] = await db.execute(query, params);

    const result = stats[0];

    // Calculate rates
    const openRate = result.total_sent > 0 ? (result.total_opened / result.total_sent * 100).toFixed(2) : 0;
    const clickRate = result.total_sent > 0 ? (result.total_clicked / result.total_sent * 100).toFixed(2) : 0;
    const bounceRate = result.total_sent > 0 ? (result.total_bounced / result.total_sent * 100).toFixed(2) : 0;
    const spamRate = result.total_sent > 0 ? (result.total_spam / result.total_sent * 100).toFixed(2) : 0;

    res.json({
      success: true,
      stats: {
        total_sent: result.total_sent,
        total_opened: result.total_opened,
        total_opens: result.total_opens,
        total_clicked: result.total_clicked,
        total_clicks: result.total_clicks,
        total_bounced: result.total_bounced,
        total_spam: result.total_spam,
        open_rate: parseFloat(openRate),
        click_rate: parseFloat(clickRate),
        bounce_rate: parseFloat(bounceRate),
        spam_rate: parseFloat(spamRate)
      }
    });

  } catch (error) {
    console.error('❌ Deliverability stats fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/emails/:id/stats
 * Get stats for specific email
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const emailLogId = parseInt(req.params.id);

    const [stats] = await db.execute(
      `SELECT * FROM email_delivery_stats WHERE email_log_id = ?`,
      [emailLogId]
    );

    if (stats.length === 0) {
      return res.json({
        success: true,
        stats: {
          opened: false,
          clicked: false,
          bounced: false,
          spam_reported: false
        }
      });
    }

    const stat = stats[0];

    res.json({
      success: true,
      stats: {
        opened: !!stat.opened_at,
        opened_at: stat.opened_at,
        open_count: stat.open_count,
        clicked: !!stat.clicked_at,
        clicked_at: stat.clicked_at,
        click_count: stat.click_count,
        bounced: !!stat.bounced_at,
        bounced_at: stat.bounced_at,
        bounce_type: stat.bounce_type,
        spam_reported: !!stat.spam_reported_at,
        spam_reported_at: stat.spam_reported_at
      }
    });

  } catch (error) {
    console.error('❌ Email stats fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
