import db from '../config/database.js';
import crypto from 'crypto';

/**
 * Email Threading Service
 *
 * Handles email conversation threading and management
 * Features:
 * - Thread creation and management
 * - Email-to-order linking
 * - Thread participant tracking
 * - Unread count management
 */

/**
 * Generate thread ID from email headers
 * Uses In-Reply-To or References headers, or generates new ID
 */
export function generateThreadId(email) {
  // If email has In-Reply-To, use that as thread ID
  if (email.inReplyTo) {
    return email.inReplyTo;
  }

  // If email has References, use the first one
  if (email.references) {
    const refs = Array.isArray(email.references) ? email.references : email.references.split(' ');
    if (refs.length > 0) {
      return refs[0];
    }
  }

  // If email has Message-ID, use that as new thread ID
  if (email.messageId) {
    return email.messageId;
  }

  // Generate new thread ID based on subject and sender
  const hash = crypto.createHash('md5')
    .update(`${email.subject}-${email.fromEmail}-${Date.now()}`)
    .digest('hex');

  return `thread-${hash}`;
}

/**
 * Find or create email conversation
 */
export async function findOrCreateConversation(shopId, email) {
  try {
    // Generate thread ID
    const threadId = generateThreadId(email);

    // Check if conversation exists
    let [conversations] = await db.execute(
      `SELECT * FROM email_conversations WHERE thread_id = ?`,
      [threadId]
    );

    if (conversations.length > 0) {
      // Update existing conversation
      const conversation = conversations[0];

      await db.execute(
        `UPDATE email_conversations
         SET last_message_at = NOW(),
             message_count = message_count + 1,
             unread_count = unread_count + ?,
             updated_at = NOW()
         WHERE id = ?`,
        [email.direction === 'inbound' ? 1 : 0, conversation.id]
      );

      console.log(`✅ Updated conversation #${conversation.id}`);

      return conversation.id;
    }

    // Create new conversation
    console.log(`📨 Creating new conversation with thread_id: ${threadId}`);

    // Try to link to order by customer email
    let orderId = null;
    if (email.fromEmail || email.toEmail) {
      const customerEmail = email.direction === 'inbound' ? email.fromEmail : email.toEmail;

      const [orders] = await db.execute(
        `SELECT id FROM orders
         WHERE customer_email = ?
         AND shop_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [customerEmail, shopId]
      );

      if (orders.length > 0) {
        orderId = orders[0].id;
        console.log(`🔗 Linked to order #${orderId}`);
      }
    }

    // Get customer info
    const customerEmail = email.direction === 'inbound' ? email.fromEmail : email.toEmail;
    const customerName = email.direction === 'inbound' ? email.fromName : email.toName;

    // Create participants array
    const participants = [email.fromEmail, email.toEmail].filter(Boolean);
    if (email.cc) {
      participants.push(...(Array.isArray(email.cc) ? email.cc : [email.cc]));
    }

    const [result] = await db.execute(
      `INSERT INTO email_conversations (
        shop_id,
        order_id,
        thread_id,
        subject,
        participants,
        customer_email,
        customer_name,
        last_message_at,
        message_count,
        unread_count,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1, ?, 'active')`,
      [
        shopId,
        orderId,
        threadId,
        email.subject,
        JSON.stringify(participants),
        customerEmail,
        customerName,
        email.direction === 'inbound' ? 1 : 0
      ]
    );

    const conversationId = result.insertId;

    console.log(`✅ Created conversation #${conversationId}`);

    return conversationId;

  } catch (error) {
    console.error('❌ Failed to find/create conversation:', error);
    throw error;
  }
}

/**
 * Save email to database
 */
export async function saveEmail(shopId, conversationId, emailData) {
  try {
    const {
      zohoMessageId,
      messageId,
      inReplyTo,
      references,
      direction,
      fromEmail,
      fromName,
      toEmail,
      toName,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      receivedAt,
      sentAt,
      isAiGenerated = false,
      aiConfidenceScore = null
    } = emailData;

    const [result] = await db.execute(
      `INSERT INTO customer_emails (
        shop_id,
        conversation_id,
        order_id,
        zoho_message_id,
        message_id,
        in_reply_to,
        \`references\`,
        direction,
        from_email,
        from_name,
        to_email,
        to_name,
        cc_emails,
        bcc_emails,
        subject,
        body_text,
        body_html,
        status,
        is_ai_generated,
        ai_confidence_score,
        received_at,
        sent_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        conversationId,
        zohoMessageId,
        messageId,
        inReplyTo || null,  // Convert undefined to null
        references || null,  // Convert undefined to null
        direction,
        fromEmail,
        fromName,
        toEmail,
        toName,
        cc ? JSON.stringify(Array.isArray(cc) ? cc : [cc]) : null,
        bcc ? JSON.stringify(Array.isArray(bcc) ? bcc : [bcc]) : null,
        subject,
        bodyText,
        bodyHtml || null,  // Convert undefined to null
        direction === 'inbound' ? 'unread' : 'sent',
        isAiGenerated,
        aiConfidenceScore,
        receivedAt || null,  // Convert undefined to null
        sentAt || null  // Convert undefined to null
      ]
    );

    console.log(`✅ Saved email #${result.insertId} to conversation #${conversationId}`);

    // Try to link to order if email is associated with one
    await linkEmailToOrder(result.insertId, fromEmail || toEmail);

    return result.insertId;

  } catch (error) {
    console.error('❌ Failed to save email:', error);
    throw error;
  }
}

/**
 * Link email to order based on customer email
 */
async function linkEmailToOrder(emailId, customerEmail) {
  try {
    if (!customerEmail) return;

    // Find most recent order for this customer
    const [orders] = await db.execute(
      `SELECT id FROM orders
       WHERE customer_email = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerEmail]
    );

    if (orders.length > 0) {
      await db.execute(
        `UPDATE customer_emails
         SET order_id = ?
         WHERE id = ?`,
        [orders[0].id, emailId]
      );

      console.log(`🔗 Linked email #${emailId} to order #${orders[0].id}`);
    }

  } catch (error) {
    console.error('❌ Failed to link email to order:', error);
  }
}

/**
 * Mark conversation as read
 */
export async function markConversationAsRead(conversationId) {
  try {
    await db.execute(
      `UPDATE customer_emails
       SET status = 'read', read_at = NOW()
       WHERE conversation_id = ? AND status = 'unread'`,
      [conversationId]
    );

    await db.execute(
      `UPDATE email_conversations
       SET unread_count = 0
       WHERE id = ?`,
      [conversationId]
    );

    console.log(`✅ Marked conversation #${conversationId} as read`);

  } catch (error) {
    console.error('❌ Failed to mark conversation as read:', error);
    throw error;
  }
}

/**
 * Get conversation with emails
 */
export async function getConversationWithEmails(conversationId) {
  try {
    // Get conversation
    const [conversations] = await db.execute(
      `SELECT
        c.*,
        o.order_number,
        o.shopify_order_id,
        o.customer_name as order_customer_name,
        o.vehicle_year,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_trim,
        CONCAT_WS(' ', o.vehicle_year, o.vehicle_make, o.vehicle_model, o.vehicle_trim) as vehicle_full
      FROM email_conversations c
      LEFT JOIN orders o ON c.order_id = o.id
      WHERE c.id = ?`,
      [conversationId]
    );

    if (conversations.length === 0) {
      return null;
    }

    const conversation = conversations[0];

    // Get emails in conversation
    const [emails] = await db.execute(
      `SELECT * FROM customer_emails
       WHERE conversation_id = ?
       ORDER BY COALESCE(sent_at, received_at) ASC`,
      [conversationId]
    );

    conversation.emails = emails;

    // Fix message count if inconsistent
    const actualCount = emails.length;
    if (conversation.message_count !== actualCount) {
      console.log(`⚠️  Fixing message count for conversation #${conversationId}: ${conversation.message_count} -> ${actualCount}`);
      await db.execute(
        `UPDATE email_conversations
         SET message_count = ?
         WHERE id = ?`,
        [actualCount, conversationId]
      );
      conversation.message_count = actualCount;
    }

    return conversation;

  } catch (error) {
    console.error('❌ Failed to get conversation:', error);
    throw error;
  }
}

/**
 * Update conversation priority
 */
export async function updateConversationPriority(conversationId, priority) {
  try {
    await db.execute(
      `UPDATE email_conversations
       SET priority = ?, updated_at = NOW()
       WHERE id = ?`,
      [priority, conversationId]
    );

    console.log(`✅ Updated conversation #${conversationId} priority to ${priority}`);

  } catch (error) {
    console.error('❌ Failed to update conversation priority:', error);
    throw error;
  }
}

/**
 * Close conversation
 */
export async function closeConversation(conversationId) {
  try {
    await db.execute(
      `UPDATE email_conversations
       SET status = 'closed', updated_at = NOW()
       WHERE id = ?`,
      [conversationId]
    );

    console.log(`✅ Closed conversation #${conversationId}`);

  } catch (error) {
    console.error('❌ Failed to close conversation:', error);
    throw error;
  }
}

/**
 * Archive conversation
 */
export async function archiveConversation(conversationId) {
  try {
    await db.execute(
      `UPDATE email_conversations
       SET status = 'archived', updated_at = NOW()
       WHERE id = ?`,
      [conversationId]
    );

    await db.execute(
      `UPDATE customer_emails
       SET status = 'archived'
       WHERE conversation_id = ?`,
      [conversationId]
    );

    console.log(`✅ Archived conversation #${conversationId}`);

  } catch (error) {
    console.error('❌ Failed to archive conversation:', error);
    throw error;
  }
}

export default {
  generateThreadId,
  findOrCreateConversation,
  saveEmail,
  linkEmailToOrder,
  markConversationAsRead,
  getConversationWithEmails,
  updateConversationPriority,
  closeConversation,
  archiveConversation
};
