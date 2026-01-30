#!/usr/bin/env node
/**
 * Re-sync email 1171 to get attachments with Zoho metadata
 */
import db from '../src/config/database.js';
import { fetchEmailDetails, fetchEmailAttachments } from '../src/services/zohoMailEnhanced.js';

async function resyncEmail() {
  try {
    console.log('🔄 Re-syncing email 1171...\n');

    // Get email details
    const [emails] = await db.execute(
      'SELECT id, zoho_message_id, conversation_id FROM customer_emails WHERE id = 1171'
    );

    if (emails.length === 0) {
      console.error('❌ Email 1171 not found');
      process.exit(1);
    }

    const email = emails[0];

    // Delete old attachments
    console.log('🗑️  Deleting old attachments...');
    await db.execute('DELETE FROM email_attachments WHERE email_id = ?', [email.id]);

    // Use default account
    const accountEmail = 'sales@tfswheels.com';
    const folderId = '1'; // Inbox

    // Fetch attachments from Zoho
    console.log('📥 Fetching attachments from Zoho...');
    const attachments = await fetchEmailAttachments(1, email.zoho_message_id, accountEmail, folderId);

    console.log(`Found ${attachments.length} attachment(s)\n`);

    // Save with Zoho metadata
    for (const attachment of attachments) {
      await db.execute(
        `INSERT INTO email_attachments
         (email_id, filename, original_filename, file_size, mime_type, is_inline, content_id,
          zoho_attachment_id, zoho_message_id, zoho_account_email, zoho_folder_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          email.id,
          attachment.attachmentName,
          attachment.attachmentName,
          attachment.size || 0,
          attachment.mimeType || 'application/octet-stream',
          attachment.disposition === 'inline' ? 1 : 0,
          attachment.contentId || null,
          attachment.attachmentId,
          email.zoho_message_id,
          accountEmail,
          folderId
        ]
      );

      console.log(`  ✅ ${attachment.attachmentName} (${((attachment.size || 0) / 1024).toFixed(2)} KB)`);
    }

    console.log('\n✅ Email re-synced successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Failed to re-sync email:', error);
    process.exit(1);
  }
}

resyncEmail();
