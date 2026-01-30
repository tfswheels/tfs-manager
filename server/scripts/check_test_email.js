#!/usr/bin/env node
import db from '../src/config/database.js';

async function checkTestEmail() {
  try {
    // Find the most recent email to sales@ (should be the test email)
    const [emails] = await db.execute(`
      SELECT
        e.id,
        e.subject,
        e.from_email,
        e.received_at,
        e.body_html,
        e.zoho_message_id,
        ec.ticket_number
      FROM customer_emails e
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE e.to_email = 'sales@tfswheels.com'
      ORDER BY e.id DESC
      LIMIT 5
    `);

    console.log('Recent emails to sales@:\n');
    emails.forEach(email => {
      console.log(`ID: ${email.id} | Ticket: ${email.ticket_number}`);
      console.log(`Subject: ${email.subject}`);
      console.log(`From: ${email.from_email}`);
      console.log(`Received: ${email.received_at}`);
      console.log(`Zoho ID: ${email.zoho_message_id}`);

      // Check for embedded images
      if (email.body_html) {
        const hasImageDisplay = email.body_html.includes('/mail/ImageDisplay');
        const hasCid = email.body_html.includes('cid:');
        console.log(`Has ImageDisplay URLs: ${hasImageDisplay}`);
        console.log(`Has cid: references: ${hasCid}`);
      }
      console.log('');
    });

    // Check if test email has attachments
    if (emails.length > 0) {
      const testEmail = emails[0];
      const [attachments] = await db.execute(`
        SELECT * FROM email_attachments WHERE email_id = ?
      `, [testEmail.id]);

      console.log(`\nAttachments for email ${testEmail.id}:`);
      console.log(`Total: ${attachments.length}`);
      attachments.forEach(att => {
        console.log(`  - ${att.original_filename} (inline: ${att.is_inline})`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkTestEmail();
