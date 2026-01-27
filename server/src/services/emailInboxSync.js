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
 * Sync emails from a specific inbox or folder
 * Supports batch fetching with uniqueness checking
 *
 * @param {number} shopId - Shop ID
 * @param {string} accountEmail - Email account
 * @param {object} options - Sync options
 * @param {number} options.maxEmails - Maximum emails to fetch (default: 500)
 * @param {number} options.batchSize - Emails per batch (default: 50)
 * @param {string} options.folderId - Folder ID (1=Inbox, 2=Sent)
 * @param {string} options.direction - Email direction ('inbound' or 'outbound')
 */
async function syncInbox(shopId, accountEmail, options = {}) {
  try {
    const {
      maxEmails = 500,
      batchSize = 50,
      folderId = '1',
      direction = 'inbound'
    } = options;

    const folderName = folderId === '1' ? 'Inbox' : folderId === '2' ? 'Sent' : `Folder ${folderId}`;
    console.log(`🔄 Syncing ${folderName} for ${accountEmail} (max ${maxEmails}, batches of ${batchSize})`);

    let newCount = 0;
    let skippedCount = 0;
    let totalFetched = 0;
    let batch = 0;

    // Fetch emails in batches until we hit maxEmails or run out of emails
    while (totalFetched < maxEmails) {
      batch++;
      const start = totalFetched;
      const limit = Math.min(batchSize, maxEmails - totalFetched);

      console.log(`  📦 Batch ${batch}: Fetching ${limit} emails (offset ${start})...`);

      const emails = await fetchInbox(shopId, {
        accountEmail: accountEmail,
        folderId: folderId,
        limit: limit,
        start: start,
        sortBy: 'receivedTime',
        sortOrder: 'desc'
      });

      // If we got no emails, we've reached the end
      if (emails.length === 0) {
        console.log(`  ✅ Reached end of ${folderName} at batch ${batch}`);
        break;
      }

      totalFetched += emails.length;
      let batchNewCount = 0;
      let batchSkippedCount = 0;

      for (const email of emails) {
        try {
          // Check if we already have this email (uniqueness check)
          const [existing] = await db.execute(
            'SELECT id FROM customer_emails WHERE zoho_message_id = ?',
            [email.messageId]
          );

          if (existing.length > 0) {
            batchSkippedCount++;
            continue;
          }

          // Filtering logic for inbound emails:
          // - sales@: ALL emails (no filtering)
          // - support@: ONLY emails from customers with orders
          if (direction === 'inbound' && accountEmail === 'support@tfswheels.com') {
            const [orders] = await db.execute(
              'SELECT id FROM orders WHERE customer_email = ?',
              [email.fromAddress || email.sender]
            );

            if (orders.length === 0) {
              // Not related to any order, skip support@ email
              batchSkippedCount++;
              continue;
            }
          }
          // sales@ emails: No filtering, all emails are processed
          // Outbound emails: No filtering

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
        // Handle both inbound and outbound emails
        const emailData = {
          subject: fullEmail.subject,
          fromEmail: direction === 'inbound' ? fullEmail.fromAddress : accountEmail,
          fromName: direction === 'inbound' ? (fullEmail.sender?.name || fullEmail.fromAddress) : 'TFS Wheels',
          toEmail: direction === 'inbound' ? accountEmail : (fullEmail.toAddress || fullEmail.recipient),
          toName: direction === 'inbound' ? 'TFS Wheels' : (fullEmail.recipientName || fullEmail.toAddress),
          messageId: fullEmail.messageId,
          inReplyTo: fullEmail.inReplyTo,
          references: fullEmail.references,
          direction: direction
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
          direction: direction,
          fromEmail: direction === 'inbound' ? fullEmail.fromAddress : accountEmail,
          fromName: direction === 'inbound' ? (fullEmail.sender?.name || fullEmail.fromAddress) : 'TFS Wheels',
          toEmail: direction === 'inbound' ? accountEmail : (fullEmail.toAddress || fullEmail.recipient),
          toName: direction === 'inbound' ? 'TFS Wheels' : (fullEmail.recipientName || fullEmail.toAddress),
          cc: fullEmail.cc || null,
          subject: fullEmail.subject || '(No Subject)',
          bodyText: fullEmail.content?.plainContent || fullEmail.content || fullEmail.summary || '',
          bodyHtml: fullEmail.content?.htmlContent || null,
          receivedAt: receivedAt,
          sentAt: direction === 'outbound' ? receivedAt : null
        });

        batchNewCount++;

        } catch (emailError) {
          console.error(`❌ Failed to process email ${email.messageId}:`, emailError.message);
          continue;
        }
      }

      // Update counts
      newCount += batchNewCount;
      skippedCount += batchSkippedCount;

      console.log(`  ✅ Batch ${batch}: ${batchNewCount} new, ${batchSkippedCount} skipped`);

      // If we got fewer emails than requested, we've reached the end
      if (emails.length < limit) {
        console.log(`  ✅ Reached end of ${folderName} (last batch had ${emails.length}/${limit} emails)`);
        break;
      }
    }

    // Update last sync time
    lastSyncTimes[accountEmail === 'sales@tfswheels.com' ? 'sales' : 'support'] = new Date();

    console.log(`✅ Synced ${folderName} for ${accountEmail}: ${newCount} new, ${skippedCount} skipped (${totalFetched} total fetched)`);

    return {
      account: accountEmail,
      folder: folderName,
      new: newCount,
      skipped: skippedCount,
      totalFetched: totalFetched
    };

  } catch (error) {
    console.error(`❌ Failed to sync inbox ${accountEmail}:`, error);
    throw error;
  }
}

/**
 * Sync all inboxes and sent folders - prioritizing sales@ over support@
 * Fetches up to 500 emails per folder in batches of 50
 */
export async function syncAllInboxes(shopId, options = {}) {
  try {
    const {
      maxEmails = 500,
      batchSize = 50,
      syncSentFolder = true
    } = options;

    console.log('📬 Starting email sync...');
    console.log(`   Max emails per folder: ${maxEmails}, Batch size: ${batchSize}, Sent folder: ${syncSentFolder ? 'Yes' : 'No'}`);

    const results = [];

    // SYNC SALES@ (highest priority)
    // 1. Sync sales@ Inbox (inbound emails)
    try {
      const salesInboxResult = await syncInbox(shopId, 'sales@tfswheels.com', {
        maxEmails,
        batchSize,
        folderId: '1',
        direction: 'inbound'
      });
      results.push(salesInboxResult);
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
        console.error('❌ Failed to sync sales@ inbox:', error.message);
      }
      results.push({
        account: 'sales@tfswheels.com',
        folder: 'Inbox',
        error: error.message
      });
    }

    // 2. Sync sales@ Sent folder (outbound emails)
    if (syncSentFolder) {
      try {
        const salesSentResult = await syncInbox(shopId, 'sales@tfswheels.com', {
          maxEmails,
          batchSize,
          folderId: '2',
          direction: 'outbound'
        });
        results.push(salesSentResult);
      } catch (error) {
        if (!error.message.includes('OAuth') && !error.message.includes('URL_RULE_NOT_CONFIGURED')) {
          console.error('❌ Failed to sync sales@ sent folder:', error.message);
        }
        results.push({
          account: 'sales@tfswheels.com',
          folder: 'Sent',
          error: error.message
        });
      }
    }

    // SYNC SUPPORT@ (secondary priority, only emails from customers with orders)
    // 3. Sync support@ Inbox (inbound emails)
    try {
      const supportInboxResult = await syncInbox(shopId, 'support@tfswheels.com', {
        maxEmails,
        batchSize,
        folderId: '1',
        direction: 'inbound'
      });
      results.push(supportInboxResult);
    } catch (error) {
      // Don't log OAuth errors repeatedly for support@ if we already logged for sales@
      if (!error.message.includes('OAuth') && !error.message.includes('URL_RULE_NOT_CONFIGURED')) {
        console.error('❌ Failed to sync support@ inbox:', error.message);
      }
      results.push({
        account: 'support@tfswheels.com',
        folder: 'Inbox',
        error: error.message
      });
    }

    // 4. Sync support@ Sent folder (outbound emails)
    if (syncSentFolder) {
      try {
        const supportSentResult = await syncInbox(shopId, 'support@tfswheels.com', {
          maxEmails,
          batchSize,
          folderId: '2',
          direction: 'outbound'
        });
        results.push(supportSentResult);
      } catch (error) {
        if (!error.message.includes('OAuth') && !error.message.includes('URL_RULE_NOT_CONFIGURED')) {
          console.error('❌ Failed to sync support@ sent folder:', error.message);
        }
        results.push({
          account: 'support@tfswheels.com',
          folder: 'Sent',
          error: error.message
        });
      }
    }

    const totalNew = results.reduce((sum, r) => sum + (r.new || 0), 0);
    const totalFetched = results.reduce((sum, r) => sum + (r.totalFetched || 0), 0);

    // Only log success if we actually synced emails
    const hasErrors = results.some(r => r.error);
    if (!hasErrors || totalNew > 0) {
      console.log(`✅ Email sync complete: ${totalNew} new emails (${totalFetched} total fetched)`);
    }

    return {
      success: true,
      results: results,
      totalNew: totalNew,
      totalFetched: totalFetched
    };

  } catch (error) {
    console.error('❌ Email sync failed:', error);
    throw error;
  }
}

/**
 * Start automatic inbox polling (every minute)
 * Uses smaller limits for recurring sync (50 emails per folder)
 */
let syncInterval = null;

export function startInboxPolling(shopId) {
  if (syncInterval) {
    console.log('⚠️  Inbox polling already running');
    return;
  }

  console.log('🔄 Starting inbox polling (every 1 minute)...');

  // Initial sync with smaller limits for recurring sync
  syncAllInboxes(shopId, {
    maxEmails: 50,  // Smaller limit for recurring sync
    batchSize: 50,
    syncSentFolder: true
  }).catch(error => {
    console.error('❌ Initial sync failed:', error);
  });

  // Poll every minute with small limits
  syncInterval = setInterval(() => {
    syncAllInboxes(shopId, {
      maxEmails: 50,  // Only check recent 50 emails per folder
      batchSize: 50,
      syncSentFolder: true
    }).catch(error => {
      console.error('❌ Scheduled sync failed:', error);
    });
  }, 60 * 1000); // 60 seconds

  console.log('✅ Inbox polling started (50 emails per folder, every minute)');
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
