import db from '../src/config/database.js';

async function fixMessageCounts() {
  try {
    console.log('🔍 Fetching all conversations...');

    const [conversations] = await db.execute(
      `SELECT id, ticket_number, message_count
       FROM email_conversations
       WHERE shop_id = 1
       ORDER BY id`
    );

    console.log(`📊 Checking ${conversations.length} conversations...`);
    let fixed = 0;
    let checked = 0;

    for (const conv of conversations) {
      const [emails] = await db.execute(
        `SELECT COUNT(*) as count
         FROM customer_emails
         WHERE conversation_id = ?`,
        [conv.id]
      );

      const actualCount = emails[0].count;
      checked++;

      if (conv.message_count !== actualCount) {
        console.log(`🔧 Fixing ${conv.ticket_number}: ${conv.message_count} -> ${actualCount} messages`);
        await db.execute(
          `UPDATE email_conversations
           SET message_count = ?
           WHERE id = ?`,
          [actualCount, conv.id]
        );
        fixed++;
      }

      // Progress indicator
      if (checked % 50 === 0) {
        console.log(`   Progress: ${checked}/${conversations.length} checked, ${fixed} fixed`);
      }
    }

    console.log(`\n✅ Done! Checked ${checked} conversations, fixed ${fixed} incorrect message counts`);
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await db.end();
  }
}

fixMessageCounts();
