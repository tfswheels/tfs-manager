#!/usr/bin/env node
/**
 * Test script to check HTML entity encoding in database
 */

import db from '../src/config/database.js';

async function checkHTMLEntities() {
  try {
    console.log('🔍 Checking for HTML entities in email data...\n');

    // Check email_conversations for HTML entities
    const [conversations] = await db.execute(`
      SELECT id, ticket_number, customer_name, customer_email, subject
      FROM email_conversations
      WHERE customer_name LIKE '%&%' OR customer_email LIKE '%&%' OR subject LIKE '%&%'
      LIMIT 10
    `);

    console.log(`Found ${conversations.length} conversations with HTML entities:\n`);
    conversations.forEach(conv => {
      console.log(`ID: ${conv.id} | Ticket: ${conv.ticket_number}`);
      console.log(`  Name: ${conv.customer_name}`);
      console.log(`  Email: ${conv.customer_email}`);
      console.log(`  Subject: ${conv.subject}`);
      console.log('');
    });

    // Check customer_emails for HTML entities
    const [emails] = await db.execute(`
      SELECT id, from_name, from_email, subject
      FROM customer_emails
      WHERE from_name LIKE '%&%' OR from_email LIKE '%&%' OR subject LIKE '%&%'
      LIMIT 10
    `);

    console.log(`\nFound ${emails.length} emails with HTML entities:\n`);
    emails.forEach(email => {
      console.log(`ID: ${email.id}`);
      console.log(`  From Name: ${email.from_name}`);
      console.log(`  From Email: ${email.from_email}`);
      console.log(`  Subject: ${email.subject}`);
      console.log('');
    });

    // Check email_attachments schema
    const [attachments] = await db.execute(`
      SELECT *
      FROM email_attachments
      WHERE is_inline = 1
      LIMIT 5
    `);

    console.log(`\nFound ${attachments.length} inline attachments:\n`);
    attachments.forEach(att => {
      console.log(`ID: ${att.id} | File: ${att.filename}`);
      console.log(`  Content-ID: ${att.content_id}`);
      console.log(`  Is Inline: ${att.is_inline}`);
      console.log(`  Size: ${att.file_size}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkHTMLEntities();
