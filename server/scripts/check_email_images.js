#!/usr/bin/env node
/**
 * Check email bodies for image references
 */

import db from '../src/config/database.js';

async function checkEmailImages() {
  try {
    console.log('🔍 Checking email bodies for image references...\n');

    // Find emails with images in their HTML
    const [emails] = await db.execute(`
      SELECT
        e.id,
        e.subject,
        e.from_email,
        e.body_html,
        ec.ticket_number
      FROM customer_emails e
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE e.body_html LIKE '%<img%' OR e.body_html LIKE '%image%'
      LIMIT 10
    `);

    console.log(`Found ${emails.length} emails with image references:\n`);

    emails.forEach(email => {
      console.log(`Ticket: ${email.ticket_number} | ID: ${email.id}`);
      console.log(`Subject: ${email.subject}`);
      console.log(`From: ${email.from_email}`);

      // Extract img tags
      const imgRegex = /<img[^>]*>/gi;
      const imgTags = email.body_html?.match(imgRegex) || [];

      if (imgTags.length > 0) {
        console.log(`Image tags found (${imgTags.length}):`);
        imgTags.forEach((tag, idx) => {
          console.log(`  ${idx + 1}. ${tag.substring(0, 150)}${tag.length > 150 ? '...' : ''}`);
        });
      }

      // Check for "image" mentions
      const hasImageWord = email.body_html?.toLowerCase().includes('image');
      if (hasImageWord && imgTags.length === 0) {
        console.log(`Contains "image" text but no <img> tags`);
      }

      console.log('');
    });

    // Look specifically for ticket 1198 mentioned by user (Re: Order 62423823)
    const [specificTicket] = await db.execute(`
      SELECT
        e.id,
        e.subject,
        e.from_email,
        e.body_html,
        e.body_text,
        ec.ticket_number
      FROM customer_emails e
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE ec.ticket_number = 'TFS-1-01198'
         OR e.subject LIKE '%62423823%'
      LIMIT 5
    `);

    if (specificTicket.length > 0) {
      console.log('\n=== SPECIFIC TICKET FROM SCREENSHOT (Re: Order 62423823) ===\n');
      specificTicket.forEach(email => {
        console.log(`Ticket: ${email.ticket_number} | ID: ${email.id}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`From: ${email.from_email}`);
        console.log('\nHTML Body (first 500 chars):');
        console.log(email.body_html?.substring(0, 500) || 'No HTML body');
        console.log('\nText Body (first 500 chars):');
        console.log(email.body_text?.substring(0, 500) || 'No text body');
        console.log('\n---\n');
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkEmailImages();
