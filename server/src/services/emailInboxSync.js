import { fetchInbox, fetchEmailDetails, fetchEmailAttachments, downloadAttachment, downloadEmbeddedImage } from './zohoMailEnhanced.js';
import { findOrCreateConversation, saveEmail } from './emailThreading.js';
import db from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attachment storage path
const ATTACHMENTS_DIR = path.join(__dirname, '../../storage/email_attachments');

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
 * Save email attachments to file system and database
 *
 * @param {number} shopId - Shop ID
 * @param {number} emailId - Database email ID
 * @param {string} messageId - Zoho message ID
 * @param {string} accountEmail - Email account
 * @param {string} folderId - Folder ID
 */
async function processAndSaveAttachments(shopId, emailId, messageId, accountEmail, folderId) {
  try {
    // Fetch attachment metadata from Zoho
    const attachments = await fetchEmailAttachments(shopId, messageId, accountEmail, folderId);

    if (attachments.length === 0) {
      return; // No attachments to process
    }

    console.log(`  📎 Processing ${attachments.length} attachment(s) for email ${emailId}...`);

    for (const attachment of attachments) {
      try {
        // Save attachment metadata to database (don't download file - fetch from Zoho on-demand)
        await db.execute(
          `INSERT INTO email_attachments
           (email_id, filename, original_filename, file_size, mime_type, is_inline, content_id,
            zoho_attachment_id, zoho_message_id, zoho_account_email, zoho_folder_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            emailId,
            attachment.attachmentName,              // Use original filename
            attachment.attachmentName,
            attachment.size || 0,
            attachment.mimeType || 'application/octet-stream',
            attachment.disposition === 'inline' ? 1 : 0,
            attachment.contentId || null,
            attachment.attachmentId,                // Zoho attachment ID
            messageId,                              // Zoho message ID
            accountEmail,                           // Email account
            folderId                                // Folder ID
          ]
        );

        console.log(`    ✅ Saved attachment metadata: ${attachment.attachmentName} (${((attachment.size || 0) / 1024).toFixed(2)} KB)`);

      } catch (attachmentError) {
        console.error(`    ❌ Failed to save attachment ${attachment.attachmentName}:`, attachmentError.message);
        // Continue with other attachments
      }
    }

  } catch (error) {
    console.error(`  ❌ Failed to process attachments for email ${emailId}:`, error.message);
    // Don't fail the email sync if attachments fail
  }
}

/**
 * Process embedded images in email HTML
 * Detects Zoho ImageDisplay URLs, downloads images, saves them as inline attachments,
 * and replaces URLs with cid: references
 *
 * @param {number} shopId - Shop ID
 * @param {number} emailId - Database email ID
 * @param {string} html - Email HTML content
 * @param {string} messageId - Zoho message ID
 * @param {string} accountEmail - Email account
 * @param {string} folderId - Folder ID
 * @returns {Promise<string>} - Modified HTML with cid: references
 */
async function processEmbeddedImages(shopId, emailId, html, messageId, accountEmail, folderId) {
  if (!html) {
    return html;
  }

  try {
    // Find all Zoho ImageDisplay URLs in the HTML
    // Pattern: /mail/ImageDisplay?na=...&nmsgId=...&f=FILENAME&mode=inline&cid=...
    const imageDisplayRegex = /<img([^>]*?)src=["']\/mail\/ImageDisplay\?([^"']+)["']([^>]*?)>/gi;
    const matches = [...html.matchAll(imageDisplayRegex)];

    if (matches.length === 0) {
      return html; // No embedded images
    }

    console.log(`  🖼️  Found ${matches.length} embedded image(s) to download...`);

    // Ensure attachments directory exists
    await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });

    let modifiedHtml = html;

    for (const match of matches) {
      try {
        const fullImgTag = match[0];
        const beforeSrc = match[1];
        let queryString = match[2];
        const afterSrc = match[3];

        // Decode HTML entities in query string (&amp; -> &)
        queryString = queryString.replace(/&amp;/g, '&');

        // Reconstruct the full ImageDisplay URL
        const imageDisplayUrl = `/mail/ImageDisplay?${queryString}`;

        // Parse query parameters for content ID
        const params = new URLSearchParams(queryString);
        const filename = params.get('f');
        const cidParam = params.get('cid');

        if (!filename) {
          console.warn(`    ⚠️  Skipping image with no filename parameter`);
          console.warn(`    Query string: ${queryString}`);
          continue;
        }

        // Download the embedded image directly from ImageDisplay endpoint
        const imageData = await downloadEmbeddedImage(shopId, imageDisplayUrl);

        // Generate unique filename
        const timestamp = Date.now();
        const randomSuffix = crypto.randomBytes(4).toString('hex');
        const ext = path.extname(imageData.filename) || '.jpg';
        const safeName = path.basename(imageData.filename, ext).replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFilename = `${timestamp}_${randomSuffix}_${safeName}${ext}`;
        const filePath = path.join(ATTACHMENTS_DIR, uniqueFilename);

        // Save to file system
        await fs.writeFile(filePath, imageData.buffer);

        // Generate content ID for cid: reference
        const contentId = cidParam || `${safeName}_${randomSuffix}@tfswheels`;

        // Save to database as inline attachment
        await db.execute(
          `INSERT INTO email_attachments
           (email_id, filename, original_filename, file_path, file_size, mime_type, is_inline, content_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            emailId,
            uniqueFilename,
            imageData.filename,
            filePath,
            imageData.size,
            imageData.mimeType,
            1, // is_inline = true
            contentId
          ]
        );

        console.log(`    ✅ Saved embedded image: ${imageData.filename} -> cid:${contentId}`);

        // Replace the ImageDisplay URL with cid: reference
        const cidUrl = `cid:${contentId}`;
        const newImgTag = `<img${beforeSrc}src="${cidUrl}"${afterSrc}>`;
        modifiedHtml = modifiedHtml.replace(fullImgTag, newImgTag);

      } catch (imageError) {
        console.error(`    ❌ Failed to process embedded image:`, imageError.message);
        // Continue with other images
      }
    }

    return modifiedHtml;

  } catch (error) {
    console.error(`  ❌ Failed to process embedded images for email ${emailId}:`, error.message);
    // Return original HTML if processing fails
    return html;
  }
}

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
    // Reduced logging - only log start if verbose mode enabled
    // console.log(`🔄 Syncing ${folderName} for ${accountEmail} (max ${maxEmails}, batches of ${batchSize})`);

    let newCount = 0;
    let skippedCount = 0;
    let totalFetched = 0;
    let batch = 0;

    // Fetch emails in batches until we hit maxEmails or run out of emails
    while (totalFetched < maxEmails) {
      batch++;
      const start = totalFetched;
      const limit = Math.min(batchSize, maxEmails - totalFetched);

      // Reduced logging - don't log every batch fetch
      // console.log(`  📦 Batch ${batch}: Fetching ${limit} emails (offset ${start})...`);

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

        // Try to fetch full email details including body
        let fullEmail = null;
        try {
          fullEmail = await fetchEmailDetails(shopId, email.messageId, accountEmail, folderId);
        } catch (detailsError) {
          console.error(`⚠️  Could not fetch full details for ${email.messageId}, skipping email`);
          // Skip emails where we can't get full content - don't save truncated emails
          batchSkippedCount++;
          continue;
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

        // Extract full email content from Zoho API response
        // Zoho returns content as: { messageId, content: "HTML string" }
        let bodyText = '';
        let bodyHtml = null;

        if (fullEmail.content?.content) {
          // Zoho Mail API format: content.content contains HTML
          bodyHtml = fullEmail.content.content;
          // Extract plain text from HTML (basic conversion - strip tags)
          bodyText = bodyHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
        } else if (fullEmail.summary) {
          // Fallback to summary if content isn't available
          bodyText = fullEmail.summary;
          bodyHtml = null;
        } else {
          // Last resort
          console.warn(`⚠️  No content found for email ${fullEmail.messageId}`);
          bodyText = '(No content available)';
          bodyHtml = null;
        }

        const emailId = await saveEmail(shopId, conversationId, {
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
          bodyText: bodyText,
          bodyHtml: bodyHtml,
          receivedAt: receivedAt,
          sentAt: direction === 'outbound' ? receivedAt : null
        });

        // Process and save regular attachments
        await processAndSaveAttachments(shopId, emailId, fullEmail.messageId, accountEmail, folderId);

        batchNewCount++;

        } catch (emailError) {
          console.error(`❌ Failed to process email ${email.messageId}:`, emailError.message);
          continue;
        }
      }

      // Update counts
      newCount += batchNewCount;
      skippedCount += batchSkippedCount;

      // Only log batch results if there were new emails
      if (batchNewCount > 0) {
        console.log(`  ✅ Batch ${batch}: ${batchNewCount} new, ${batchSkippedCount} skipped`);
      }

      // If we got fewer emails than requested, we've reached the end
      if (emails.length < limit) {
        // Reduced logging - don't log end of folder
        // console.log(`  ✅ Reached end of ${folderName} (last batch had ${emails.length}/${limit} emails)`);
        break;
      }
    }

    // Update last sync time
    lastSyncTimes[accountEmail === 'sales@tfswheels.com' ? 'sales' : 'support'] = new Date();

    // Only log summary if there were new emails or it's the first sync
    if (newCount > 0) {
      console.log(`✅ Synced ${folderName} for ${accountEmail}: ${newCount} new, ${skippedCount} skipped (${totalFetched} total fetched)`);
    }

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

    // Reduced logging - only log when needed
    // console.log('📬 Starting email sync...');
    // console.log(`   Max emails per folder: ${maxEmails}, Batch size: ${batchSize}, Sent folder: ${syncSentFolder ? 'Yes' : 'No'}`);

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
      // Only log if new emails were found
      if (totalNew > 0) {
        console.log(`✅ Email sync complete: ${totalNew} new emails (${totalFetched} total fetched)`);
      }
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
