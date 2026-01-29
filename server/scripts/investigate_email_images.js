#!/usr/bin/env node

/**
 * Investigate email attachments and embedded images
 */

import db from '../src/config/database.js';

async function investigate() {
  try {
    console.log('🔍 Investigating email attachments and embedded images...\n');

    // Check email_attachments table structure
    console.log('📊 Structure of email_attachments table:');
    const [attachmentColumns] = await db.execute('DESCRIBE email_attachments');
    console.log('');
    attachmentColumns.forEach(col => {
      console.log(`  ${col.Field.padEnd(25)} ${col.Type.padEnd(30)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    // Count attachments
    console.log('\n📎 Attachment statistics:');
    const [attachStats] = await db.execute(`
      SELECT
        COUNT(*) as total_attachments,
        COUNT(DISTINCT email_id) as emails_with_attachments,
        SUM(CASE WHEN mime_type LIKE 'image/%' THEN 1 ELSE 0 END) as image_attachments,
        SUM(CASE WHEN is_inline = 1 THEN 1 ELSE 0 END) as inline_attachments
      FROM email_attachments
    `);

    if (attachStats.length > 0) {
      const stats = attachStats[0];
      console.log(`  Total attachments: ${stats.total_attachments}`);
      console.log(`  Emails with attachments: ${stats.emails_with_attachments}`);
      console.log(`  Image attachments: ${stats.image_attachments}`);
      console.log(`  Inline attachments: ${stats.inline_attachments}`);
    }

    // Sample image attachments
    console.log('\n🖼️  Sample image attachments:');
    const [imageAttachments] = await db.execute(`
      SELECT
        a.id,
        a.email_id,
        a.filename,
        a.mime_type,
        a.content_id,
        a.is_inline,
        a.file_size,
        a.file_path,
        a.file_url,
        e.subject,
        SUBSTRING(e.body_html, 1, 500) as html_snippet
      FROM email_attachments a
      JOIN customer_emails e ON a.email_id = e.id
      WHERE a.mime_type LIKE 'image/%'
      LIMIT 3
    `);

    imageAttachments.forEach((att, idx) => {
      console.log(`\n  --- Image ${idx + 1} ---`);
      console.log(`  Attachment ID: ${att.id}`);
      console.log(`  Email ID: ${att.email_id}`);
      console.log(`  Email Subject: ${att.subject}`);
      console.log(`  Filename: ${att.filename}`);
      console.log(`  MIME Type: ${att.mime_type}`);
      console.log(`  Content-ID: ${att.content_id || '(none)'}`);
      console.log(`  Is Inline: ${att.is_inline ? 'Yes' : 'No'}`);
      console.log(`  Size: ${att.file_size ? (att.file_size / 1024).toFixed(2) + ' KB' : 'unknown'}`);
      console.log(`  File Path: ${att.file_path || '(none)'}`);
      console.log(`  File URL: ${att.file_url || '(none)'}`);

      // Check if HTML references this image
      if (att.html_snippet) {
        const hasCidReference = att.content_id && att.html_snippet.includes(`cid:${att.content_id}`);
        const hasSrcReference = att.html_snippet.includes(`src=`);
        console.log(`  HTML has cid: reference: ${hasCidReference ? 'Yes' : 'No'}`);
        console.log(`  HTML has src= attribute: ${hasSrcReference ? 'Yes' : 'No'}`);
      }
    });

    // Check for emails with cid: references in HTML
    console.log('\n\n🔍 Emails with cid: references in HTML:');
    const [cidEmails] = await db.execute(`
      SELECT id, subject,
        SUBSTRING(body_html, 1, 300) as html_preview
      FROM customer_emails
      WHERE body_html LIKE '%cid:%'
      LIMIT 2
    `);

    cidEmails.forEach((email, idx) => {
      console.log(`\n  --- Email ${idx + 1} ---`);
      console.log(`  Email ID: ${email.id}`);
      console.log(`  Subject: ${email.subject}`);
      console.log(`  HTML Preview: ${email.html_preview.substring(0, 200)}...`);
    });

    // Check if attachments have file_path or file_url
    console.log('\n\n💾 How are attachments stored?');
    const [storageCheck] = await db.execute(`
      SELECT
        id,
        filename,
        CASE
          WHEN file_path IS NOT NULL THEN 'file_path'
          WHEN file_url IS NOT NULL THEN 'file_url'
          ELSE 'none'
        END as storage_method,
        file_path,
        file_url
      FROM email_attachments
      WHERE mime_type LIKE 'image/%'
      LIMIT 5
    `);

    storageCheck.forEach((att, idx) => {
      console.log(`  ${idx + 1}. ${att.filename}: ${att.storage_method}`);
      if (att.file_path) console.log(`      Path: ${att.file_path}`);
      if (att.file_url) console.log(`      URL: ${att.file_url}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

investigate();
