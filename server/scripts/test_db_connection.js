#!/usr/bin/env node

/**
 * Test database connection and query schema
 */

import db from '../src/config/database.js';

async function testConnection() {
  try {
    console.log('🔄 Testing database connection...');

    // Test basic connection
    const [result] = await db.execute('SELECT 1 as test');
    console.log('✅ Database connection successful!');

    // Show all tables
    console.log('\n📋 Tables in database:');
    const [tables] = await db.execute('SHOW TABLES');
    tables.forEach(row => {
      const tableName = Object.values(row)[0];
      console.log(`  - ${tableName}`);
    });

    // Describe customer_emails table
    console.log('\n📊 Structure of customer_emails table:');
    const [columns] = await db.execute('DESCRIBE customer_emails');
    console.log('');
    columns.forEach(col => {
      console.log(`  ${col.Field.padEnd(25)} ${col.Type.padEnd(20)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    // Check for emails with attachments
    console.log('\n📎 Checking for emails with attachments...');
    const [emailStats] = await db.execute(`
      SELECT
        COUNT(*) as total_emails,
        SUM(CASE WHEN body_html LIKE '%<img%' OR body_html LIKE '%cid:%' THEN 1 ELSE 0 END) as emails_with_img_tags,
        SUM(CASE WHEN body_text LIKE '%<image%' THEN 1 ELSE 0 END) as emails_with_image_placeholder
      FROM customer_emails
      WHERE body_html IS NOT NULL OR body_text IS NOT NULL
    `);

    console.log(`  Total emails: ${emailStats[0].total_emails}`);
    console.log(`  Emails with <img> tags in HTML: ${emailStats[0].emails_with_img_tags}`);
    console.log(`  Emails with <imageX> placeholder: ${emailStats[0].emails_with_image_placeholder}`);

    // Sample email with image placeholder
    console.log('\n🔍 Sample email with image reference:');
    const [sampleEmails] = await db.execute(`
      SELECT id, subject,
        SUBSTRING(body_text, 1, 200) as body_preview,
        SUBSTRING(body_html, 1, 300) as html_preview
      FROM customer_emails
      WHERE body_text LIKE '%<image%' OR body_html LIKE '%<img%'
      LIMIT 1
    `);

    if (sampleEmails.length > 0) {
      const email = sampleEmails[0];
      console.log(`  Email ID: ${email.id}`);
      console.log(`  Subject: ${email.subject}`);
      console.log(`  Body preview: ${email.body_preview}`);
      console.log(`  HTML preview: ${email.html_preview}`);
    } else {
      console.log('  No emails with image references found');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Database error:', error.message);
    process.exit(1);
  }
}

testConnection();
