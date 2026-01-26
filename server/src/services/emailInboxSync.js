import { fetchInbox, fetchEmailDetails } from './zohoMailEnhanced.js';
import { findOrCreateConversation, saveEmail } from './emailThreading.js';
import db from '../config/database.js';

/**
 * Email Inbox Synchronization Service
 *
 * Hybrid approach: API polling + Webhooks
 * - Polls sales@ and support@ every minute
 * - Stores emails in database with threading
 * - Links emails to orders when possible
 * - Webhooks handle real-time events (opens, clicks, bounces)
 */

// Track last sync times to avoid duplicate processing
const lastSyncTimes = {
  sales: null,
  support: null
};

/**
 * Sync emails from a specific inbox
 */
async function syncInbox(shopId, accountEmail) {
  try {
    console.log(`🔄 Syncing inbox: ${accountEmail}`);

    const lastSync = lastSyncTimes[accountEmail === 'sales@tfswheels.com' ? 'sales' : 'support'];

    // Fetch recent emails (last 50)
    const emails = await fetchInbox(shopId, {
      accountEmail: accountEmail,
      limit: 50,
      sortBy: 'receivedTime',
      sortOrder: 'desc'
    });

    let newCount = 0;
    let skippedCount = 0;

    for (const email of emails) {
      try {
        // Check if we already have this email
        const [existing] = await db.execute(
          'SELECT id FROM customer_emails WHERE zoho_message_id = ?',
          [email.messageId]
        );

        if (existing.length > 0) {
          skippedCount++;
          continue;
        }

        // Filtering logic:
        // - sales@: ALL emails (no filtering)
        // - support@: ONLY emails from customers with orders
        if (accountEmail === 'support@tfswheels.com') {
          const [orders] = await db.execute(
            'SELECT id FROM orders WHERE customer_email = ?',
            [email.fromAddress || email.sender]
          );

          if (orders.length === 0) {
            // Not related to any order, skip support@ email
            console.log(`⏭️  Skipping support@ email from ${email.fromAddress || email.sender} - no order found`);
            skippedCount++;
            continue;
          }
        }
        // sales@ emails: No filtering, all emails are processed

        // Try to fetch full email details including body, but use basic info if it fails
        let fullEmail = null;
        try {
          fullEmail = await fetchEmailDetails(shopId, email.messageId, accountEmail);
        } catch (detailsError) {
          console.log(`⚠️  Could not fetch full details for ${email.messageId}, using basic info from list`);
          // Use basic email info from the list response
          fullEmail = {
            messageId: email.messageId,
            subject: email.subject,
            fromAddress: email.fromAddress || email.sender,
            sender: { name: email.senderName || email.fromAddress },
            inReplyTo: email.inReplyTo,
            references: email.references,
            cc: email.cc,
            receivedTime: email.receivedTime || email.time,
            content: email.summary || '',  // Use summary as fallback for body
          };
        }

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

        // Save email to database (convert undefined to null for MySQL)
        // Validate receivedAt - must be a valid date or null
        let receivedAt = null;
        if (fullEmail.receivedTime) {
          const parsedDate = new Date(fullEmail.receivedTime);
          // Check if date is valid (not NaN and not invalid date)
          if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 1970) {
            receivedAt = parsedDate;
          }
        }

        await saveEmail(shopId, conversationId, {
          zohoMessageId: fullEmail.messageId,
          messageId: fullEmail.messageId,
          inReplyTo: fullEmail.inReplyTo || null,
          references: fullEmail.references || null,
          direction: 'inbound',
          fromEmail: fullEmail.fromAddress,
          fromName: fullEmail.sender?.name || fullEmail.fromAddress,
          toEmail: accountEmail,
          toName: 'TFS Wheels',
          cc: fullEmail.cc || null,
          subject: fullEmail.subject || '(No Subject)',
          bodyText: fullEmail.content?.plainContent || fullEmail.content || fullEmail.summary || '',
          bodyHtml: fullEmail.content?.htmlContent || null,
          receivedAt: receivedAt
        });

        newCount++;

      } catch (emailError) {
        console.error(`❌ Failed to process email ${email.messageId}:`, emailError);
        continue;
      }
    }

    // Update last sync time
    lastSyncTimes[accountEmail === 'sales@tfswheels.com' ? 'sales' : 'support'] = new Date();

    console.log(`✅ Synced ${accountEmail}: ${newCount} new, ${skippedCount} skipped`);

    return {
      account: accountEmail,
      new: newCount,
      skipped: skippedCount,
      total: emails.length
    };

  } catch (error) {
    console.error(`❌ Failed to sync inbox ${accountEmail}:`, error);
    throw error;
  }
}

/**
 * Sync all inboxes (sales@ and support@)
 */
export async function syncAllInboxes(shopId) {
  try {
    console.log('📬 Starting inbox sync...');

    const results = [];

    // Sync sales@
    try {
      const salesResult = await syncInbox(shopId, 'sales@tfswheels.com');
      results.push(salesResult);
    } catch (error) {
      // Check if error is due to missing OAuth credentials
      if (error.message.includes('OAuth') || error.message.includes('URL_RULE_NOT_CONFIGURED')) {
        // Only log once, not every minute
        if (!global._zohoOAuthWarningLogged) {
          console.warn('⚠️  Zoho OAuth not configured yet. Email sync will be skipped until OAuth is set up.');
          console.warn('   Visit /auth/zoho/authorize to complete OAuth setup.');
          global._zohoOAuthWarningLogged = true;
        }
      } else {
        console.error('❌ Failed to sync sales@:', error.message);
      }
      results.push({
        account: 'sales@tfswheels.com',
        error: error.message
      });
    }

    // Sync support@ (only emails linked to orders)
    try {
      const supportResult = await syncInbox(shopId, 'support@tfswheels.com');
      results.push(supportResult);
    } catch (error) {
      // Don't log OAuth errors repeatedly for support@ if we already logged for sales@
      if (!error.message.includes('OAuth') && !error.message.includes('URL_RULE_NOT_CONFIGURED')) {
        console.error('❌ Failed to sync support@:', error.message);
      }
      results.push({
        account: 'support@tfswheels.com',
        error: error.message
      });
    }

    const totalNew = results.reduce((sum, r) => sum + (r.new || 0), 0);

    // Only log success if we actually synced emails
    const hasErrors = results.some(r => r.error);
    if (!hasErrors || totalNew > 0) {
      console.log(`✅ Inbox sync complete: ${totalNew} new emails`);
    }

    return {
      success: true,
      results: results,
      totalNew: totalNew
    };

  } catch (error) {
    console.error('❌ Inbox sync failed:', error);
    throw error;
  }
}

/**
 * Start automatic inbox polling (every minute)
 */
let syncInterval = null;

export function startInboxPolling(shopId) {
  if (syncInterval) {
    console.log('⚠️  Inbox polling already running');
    return;
  }

  console.log('🔄 Starting inbox polling (every 1 minute)...');

  // Initial sync
  syncAllInboxes(shopId).catch(error => {
    console.error('❌ Initial sync failed:', error);
  });

  // Poll every minute
  syncInterval = setInterval(() => {
    syncAllInboxes(shopId).catch(error => {
      console.error('❌ Scheduled sync failed:', error);
    });
  }, 60 * 1000); // 60 seconds

  console.log('✅ Inbox polling started');
}

/**
 * Stop automatic inbox polling
 */
export function stopInboxPolling() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('⏹️  Inbox polling stopped');
  }
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  return {
    polling: syncInterval !== null,
    lastSync: {
      sales: lastSyncTimes.sales,
      support: lastSyncTimes.support
    }
  };
}

export default {
  syncAllInboxes,
  startInboxPolling,
  stopInboxPolling,
  getSyncStatus
};
