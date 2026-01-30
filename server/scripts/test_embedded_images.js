#!/usr/bin/env node
/**
 * Test embedded image processing
 * Dry run to check if we can process a single email with embedded images
 */

import db from '../src/config/database.js';
import { downloadEmbeddedImage } from '../src/services/zohoMailEnhanced.js';

async function testEmbeddedImageProcessing() {
  try {
    console.log('🧪 Testing embedded image processing...\n');

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      ['2f3d7a-2.myshopify.com']
    );

    const shopId = shopRows[0].id;

    // Find one email with ImageDisplay URL
    const [emails] = await db.execute(`
      SELECT
        e.id,
        e.body_html,
        e.zoho_message_id,
        e.subject,
        ec.ticket_number
      FROM customer_emails e
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE e.body_html LIKE '%/mail/ImageDisplay%'
      LIMIT 1
    `);

    if (emails.length === 0) {
      console.log('No emails with embedded images found');
      process.exit(0);
    }

    const email = emails[0];

    console.log(`Found test email:`);
    console.log(`  ID: ${email.id}`);
    console.log(`  Ticket: ${email.ticket_number}`);
    console.log(`  Subject: ${email.subject}`);
    console.log(`  Zoho Message ID: ${email.zoho_message_id}\n`);

    // Extract ImageDisplay URLs
    const imageDisplayRegex = /<img([^>]*?)src=["']\/mail\/ImageDisplay\?([^"']+)["']([^>]*?)>/gi;
    const matches = [...email.body_html.matchAll(imageDisplayRegex)];

    console.log(`Found ${matches.length} embedded image(s):\n`);

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      let queryString = match[2];

      // Decode HTML entities (&amp; -> &)
      queryString = queryString.replace(/&amp;/g, '&');

      const params = new URLSearchParams(queryString);

      console.log(`Image ${i + 1}:`);
      console.log(`  Filename: ${params.get('f')}`);
      console.log(`  Content ID: ${params.get('cid')}`);
      console.log(`  Mode: ${params.get('mode')}`);

      // Try to download one image as a test
      if (i === 0) {
        try {
          console.log(`\n  🔄 Attempting to download...`);
          const imageData = await downloadEmbeddedImage(
            shopId,
            email.zoho_message_id,
            params.get('f'),
            'sales@tfswheels.com',
            '1'
          );

          console.log(`  ✅ Download successful!`);
          console.log(`    Filename: ${imageData.filename}`);
          console.log(`    Size: ${(imageData.size / 1024).toFixed(2)} KB`);
          console.log(`    MIME Type: ${imageData.mimeType}`);
          console.log(`    Content ID: ${imageData.contentId}`);
        } catch (downloadError) {
          console.error(`  ❌ Download failed:`, downloadError.message);
        }
      }

      console.log('');
    }

    console.log('\n✅ Test complete!');
    console.log('\nTo process all emails with embedded images, run:');
    console.log('  node server/scripts/backfill_embedded_images.js');

    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testEmbeddedImageProcessing();
