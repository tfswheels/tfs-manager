#!/usr/bin/env node
/**
 * Check attachments in database
 */

import db from '../src/config/database.js';

async function checkAttachments() {
  try {
    console.log('🔍 Checking attachments in database...\n');

    // Check total attachments
    const [total] = await db.execute(`
      SELECT COUNT(*) as total FROM email_attachments
    `);
    console.log(`Total attachments: ${total[0].total}\n`);

    // Check inline vs regular
    const [breakdown] = await db.execute(`
      SELECT
        is_inline,
        COUNT(*) as count
      FROM email_attachments
      GROUP BY is_inline
    `);
    console.log('Breakdown by type:');
    breakdown.forEach(row => {
      console.log(`  ${row.is_inline ? 'Inline' : 'Regular'}: ${row.count}`);
    });
    console.log('');

    // Check some sample inline attachments
    const [inlineAttachments] = await db.execute(`
      SELECT
        a.*,
        e.subject,
        e.from_email,
        ec.ticket_number
      FROM email_attachments a
      JOIN customer_emails e ON a.email_id = e.id
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE a.is_inline = 1
      LIMIT 5
    `);

    console.log(`Sample inline attachments (${inlineAttachments.length}):\n`);
    inlineAttachments.forEach(att => {
      console.log(`Ticket: ${att.ticket_number}`);
      console.log(`  Subject: ${att.subject}`);
      console.log(`  Filename: ${att.filename}`);
      console.log(`  Content-ID: ${att.content_id}`);
      console.log(`  From: ${att.from_email}`);
      console.log('');
    });

    // Check some sample regular attachments
    const [regularAttachments] = await db.execute(`
      SELECT
        a.*,
        e.subject,
        e.from_email,
        ec.ticket_number
      FROM email_attachments a
      JOIN customer_emails e ON a.email_id = e.id
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE a.is_inline = 0
      LIMIT 5
    `);

    console.log(`Sample regular attachments (${regularAttachments.length}):\n`);
    regularAttachments.forEach(att => {
      console.log(`Ticket: ${att.ticket_number}`);
      console.log(`  Subject: ${att.subject}`);
      console.log(`  Filename: ${att.filename}`);
      console.log(`  Content-ID: ${att.content_id}`);
      console.log(`  From: ${att.from_email}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAttachments();
