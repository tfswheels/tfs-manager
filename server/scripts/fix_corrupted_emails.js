import db from '../src/config/database.js';

/**
 * Fix corrupted email data:
 * 1. Fix customer attribution (sales@/support@ showing as customer)
 * 2. Identify emails with truncated content that need re-fetching
 */

async function fixCorruptedEmails() {
  try {
    console.log('🔍 Scanning for corrupted emails...\n');

    // Find conversations where customer_email is one of our addresses
    console.log('1. Finding conversations with incorrect customer attribution...');
    const [wrongCustomers] = await db.execute(`
      SELECT
        id,
        customer_email,
        customer_name,
        subject
      FROM email_conversations
      WHERE customer_email IN ('sales@tfswheels.com', 'support@tfswheels.com')
      LIMIT 100
    `);

    console.log(`   Found ${wrongCustomers.length} conversations with wrong customer\n`);

    for (const conv of wrongCustomers) {
      console.log(`   📧 Conversation #${conv.id}: "${conv.subject}"`);
      console.log(`      Current customer: ${conv.customer_email}`);

      // Find the actual customer from the emails in this conversation
      const [emails] = await db.execute(`
        SELECT
          direction,
          from_email,
          from_name,
          to_email,
          to_name
        FROM customer_emails
        WHERE conversation_id = ?
        ORDER BY COALESCE(sent_at, received_at) ASC
        LIMIT 10
      `, [conv.id]);

      if (emails.length === 0) {
        console.log(`      ⚠️  No emails found for this conversation\n`);
        continue;
      }

      // Find the actual customer (not sales@ or support@)
      const ourEmails = ['sales@tfswheels.com', 'support@tfswheels.com'];
      let actualCustomerEmail = null;
      let actualCustomerName = null;

      for (const email of emails) {
        if (email.direction === 'inbound') {
          // Inbound: customer should be from_email
          if (!ourEmails.includes(email.from_email?.toLowerCase())) {
            actualCustomerEmail = email.from_email;
            actualCustomerName = email.from_name;
            break;
          }
        } else {
          // Outbound: customer should be to_email
          if (!ourEmails.includes(email.to_email?.toLowerCase())) {
            actualCustomerEmail = email.to_email;
            actualCustomerName = email.to_name;
            break;
          }
        }
      }

      if (actualCustomerEmail && !ourEmails.includes(actualCustomerEmail.toLowerCase())) {
        console.log(`      ✅ Fixed customer: ${actualCustomerEmail} (${actualCustomerName})`);

        // Update conversation with correct customer
        await db.execute(`
          UPDATE email_conversations
          SET customer_email = ?,
              customer_name = ?
          WHERE id = ?
        `, [actualCustomerEmail, actualCustomerName, conv.id]);
      } else {
        console.log(`      ⚠️  Could not determine actual customer\n`);
      }

      console.log('');
    }

    // Find emails with potentially truncated content
    console.log('\n2. Finding emails with truncated content...');
    const [truncatedEmails] = await db.execute(`
      SELECT
        id,
        conversation_id,
        subject,
        LENGTH(body_text) as text_length,
        body_text
      FROM customer_emails
      WHERE (body_text IS NULL OR body_text = '' OR LENGTH(body_text) < 100)
        AND direction = 'inbound'
      LIMIT 50
    `);

    console.log(`   Found ${truncatedEmails.length} emails with potentially truncated content`);

    if (truncatedEmails.length > 0) {
      console.log('\n   Sample truncated emails:');
      truncatedEmails.slice(0, 5).forEach(email => {
        console.log(`   - Email #${email.id}: "${email.subject}" (${email.text_length} chars)`);
        console.log(`     Content preview: "${email.body_text?.substring(0, 100)}..."`);
      });
    }

    // Find emails with invalid dates
    console.log('\n3. Finding emails with invalid dates...');
    const [invalidDates] = await db.execute(`
      SELECT
        id,
        conversation_id,
        subject,
        received_at,
        sent_at,
        created_at
      FROM customer_emails
      WHERE (received_at IS NULL OR received_at < '1971-01-01')
        AND (sent_at IS NULL OR sent_at < '1971-01-01')
      LIMIT 50
    `);

    console.log(`   Found ${invalidDates.length} emails with invalid dates`);

    console.log('\n✅ Corruption scan complete!');
    console.log('\nSummary:');
    console.log(`   - Fixed ${wrongCustomers.length} customer attributions`);
    console.log(`   - Found ${truncatedEmails.length} emails with truncated content`);
    console.log(`   - Found ${invalidDates.length} emails with invalid dates`);

    if (truncatedEmails.length > 0 || invalidDates.length > 0) {
      console.log('\n⚠️  To fix truncated content and invalid dates, you need to:');
      console.log('   1. Delete the corrupted emails from customer_emails table');
      console.log('   2. Delete the affected conversations from email_conversations table');
      console.log('   3. Re-run the email sync to fetch fresh data');
      console.log('\n   Would you like me to create a script to do this automatically?');
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixCorruptedEmails();
