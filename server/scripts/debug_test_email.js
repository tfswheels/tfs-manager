#!/usr/bin/env node
import db from '../src/config/database.js';

async function debugEmail() {
  try {
    // Get the actual HTML from the test email
    const [emails] = await db.execute('SELECT body_html FROM customer_emails WHERE id = 1171');

    if (emails.length === 0) {
      console.log('Email not found');
      process.exit(1);
    }

    const html = emails[0].body_html;

    console.log('=== HTML Analysis ===\n');
    console.log('Total HTML length:', html.length);
    console.log('Contains /mail/ImageDisplay:', html.includes('/mail/ImageDisplay'));
    console.log('Contains <img:', html.includes('<img'));
    console.log('');

    // Find all img tags
    const imgRegex = /<img[^>]*>/gi;
    const imgTags = html.match(imgRegex) || [];
    console.log('Found', imgTags.length, 'img tags\n');

    imgTags.forEach((tag, i) => {
      console.log(`Image ${i+1}:`);
      console.log(tag);
      console.log('');
    });

    // Check for the embedded table
    if (html.includes('<table')) {
      console.log('✅ Has table (the embedded vehicle data)');
    }

    // Show first 2000 chars to see structure
    console.log('\n=== First 2000 chars of HTML ===');
    console.log(html.substring(0, 2000));

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debugEmail();
