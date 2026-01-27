import db from '../src/config/database.js';
import { syncAllInboxes } from '../src/services/emailInboxSync.js';

/**
 * Clean corrupted emails and re-sync from Zoho
 *
 * This script will:
 * 1. Delete all conversations where customer is sales@/support@
 * 2. Delete all emails with invalid dates or truncated content
 * 3. Re-sync emails from Zoho to get fresh, correct data
 */

async function cleanAndResync() {
  try {
    const shopId = 1;

    console.log('🧹 Starting cleanup of corrupted email data...\n');

    // Step 1: Count what will be deleted
    const [convCount] = await db.execute(`
      SELECT COUNT(*) as count
      FROM email_conversations
      WHERE customer_email IN ('sales@tfswheels.com', 'support@tfswheels.com')
    `);

    const [emailCount] = await db.execute(`
      SELECT COUNT(*) as count
      FROM customer_emails
      WHERE (from_email = 'sales@tfswheels.com' AND to_email = 'sales@tfswheels.com')
         OR (from_email = 'support@tfswheels.com' AND to_email = 'support@tfswheels.com')
         OR (received_at IS NULL AND sent_at IS NULL)
         OR LENGTH(body_text) < 100
    `);

    console.log(`Found corrupted data:`);
    console.log(`  - ${convCount[0].count} conversations`);
    console.log(`  - ${emailCount[0].count} emails\n`);

    console.log('⚠️  WARNING: This will delete all corrupted emails and conversations!');
    console.log('⚠️  Make sure you have a database backup before proceeding.\n');

    // Give user time to cancel (Ctrl+C)
    console.log('Starting cleanup in 5 seconds... (Press Ctrl+C to cancel)');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 2: Delete corrupted emails
    console.log('\n🗑️  Deleting corrupted emails...');
    const [emailResult] = await db.execute(`
      DELETE FROM customer_emails
      WHERE (from_email = 'sales@tfswheels.com' AND to_email = 'sales@tfswheels.com')
         OR (from_email = 'support@tfswheels.com' AND to_email = 'support@tfswheels.com')
         OR (received_at IS NULL AND sent_at IS NULL)
         OR (LENGTH(body_text) < 100 AND direction = 'inbound')
    `);
    console.log(`   Deleted ${emailResult.affectedRows} emails`);

    // Step 3: Delete corrupted conversations
    console.log('\n🗑️  Deleting corrupted conversations...');
    const [convResult] = await db.execute(`
      DELETE FROM email_conversations
      WHERE customer_email IN ('sales@tfswheels.com', 'support@tfswheels.com')
         OR message_count = 0
         OR id NOT IN (SELECT DISTINCT conversation_id FROM customer_emails WHERE conversation_id IS NOT NULL)
    `);
    console.log(`   Deleted ${convResult.affectedRows} conversations`);

    // Step 4: Re-sync emails from Zoho
    console.log('\n📥 Re-syncing emails from Zoho...');
    console.log('   This may take several minutes...\n');

    const result = await syncAllInboxes(shopId, {
      maxEmails: 500,  // Sync last 500 emails per folder
      batchSize: 50,
      syncSentFolder: true
    });

    console.log('\n✅ Cleanup and re-sync complete!');
    console.log(`\nResults:`);
    console.log(`  - Deleted: ${emailResult.affectedRows} emails, ${convResult.affectedRows} conversations`);
    console.log(`  - Synced: ${result.totalNew} new emails from Zoho`);
    console.log(`  - Total fetched: ${result.totalFetched} emails`);

    if (result.totalNew === 0) {
      console.log('\n⚠️  No new emails were synced. This might mean:');
      console.log('    1. Zoho API authentication failed');
      console.log('    2. All emails still exist in the database (by zoho_message_id)');
      console.log('    3. Zoho has no emails in the specified folders');
      console.log('\nCheck the logs above for errors.');
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

cleanAndResync();
