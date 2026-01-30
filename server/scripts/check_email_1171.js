#!/usr/bin/env node
import db from '../src/config/database.js';

async function checkEmail() {
  try {
    // Get the test email details
    const [emails] = await db.execute(`
      SELECT id, subject, body_html, zoho_message_id
      FROM customer_emails
      WHERE id = 1171
    `);

    if (emails.length === 0) {
      console.log('Email 1171 not found');
      process.exit(1);
    }

    const email = emails[0];
    console.log('Email ID:', email.id);
    console.log('Subject:', email.subject);
    console.log('Zoho ID:', email.zoho_message_id);
    console.log('');

    // Check for images in HTML
    if (email.body_html) {
      const hasImageDisplay = email.body_html.includes('/mail/ImageDisplay');
      const hasCid = email.body_html.includes('cid:');
      const hasImg = email.body_html.includes('<img');

      console.log('HTML Analysis:');
      console.log('  Has <img> tags:', hasImg);
      console.log('  Has /mail/ImageDisplay URLs:', hasImageDisplay);
      console.log('  Has cid: references:', hasCid);
      console.log('');

      if (hasImageDisplay) {
        console.log('⚠️  PROBLEM: Still has ImageDisplay URLs (embedded images NOT processed!)');
        console.log('');
      }
      if (hasCid) {
        console.log('✅ Has cid: references (embedded images processed correctly!)');
        console.log('');
      }
    }

    // Check attachments
    const [attachments] = await db.execute(`
      SELECT id, filename, original_filename, is_inline, content_id, file_size
      FROM email_attachments
      WHERE email_id = 1171
    `);

    console.log(`Attachments: ${attachments.length}`);
    if (attachments.length > 0) {
      attachments.forEach(att => {
        console.log(`  - ${att.original_filename} (${att.file_size} bytes)`);
        console.log(`    Inline: ${att.is_inline}, Content-ID: ${att.content_id || 'none'}`);
      });
    } else {
      console.log('  ⚠️  NO ATTACHMENTS SAVED!');
      console.log('');
      console.log('This means the new code did NOT run during sync.');
      console.log('Railway may not have deployed the new code yet.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkEmail();
