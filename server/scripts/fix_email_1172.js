#!/usr/bin/env node
/**
 * Fix email 1172 - fetch original HTML from Zoho and check for embedded images
 */
import db from '../src/config/database.js';
import { fetchEmailDetails } from '../src/services/zohoMailEnhanced.js';

async function fixEmail() {
  try {
    console.log('🔄 Fixing email 1172...\n');

    // Get email from database
    const [emails] = await db.execute(
      'SELECT id, zoho_message_id FROM customer_emails WHERE id = 1172'
    );

    if (emails.length === 0) {
      console.error('❌ Email 1172 not found');
      process.exit(1);
    }

    const email = emails[0];

    // Fetch original email from Zoho
    console.log('📥 Fetching original email from Zoho...');
    const accountEmail = 'sales@tfswheels.com';
    const folderId = '1';

    const fullEmail = await fetchEmailDetails(1, email.zoho_message_id, accountEmail, folderId);

    console.log('\nFull email object:');
    console.log(JSON.stringify(fullEmail, null, 2).substring(0, 1000));

    const htmlContent = fullEmail.content?.content || fullEmail.bodyHtml || fullEmail.body_html || '';

    console.log('\nOriginal email HTML (first 800 chars):');
    console.log(htmlContent.substring(0, 800));

    console.log('\n\nChecking for embedded images:');
    const hasImageDisplay = htmlContent.includes('/mail/ImageDisplay');
    const hasCidRefs = htmlContent.includes('cid:');
    const hasImgTags = htmlContent.includes('<img');

    console.log(`  Has ImageDisplay URLs: ${hasImageDisplay}`);
    console.log(`  Has cid: references: ${hasCidRefs}`);
    console.log(`  Has <img> tags: ${hasImgTags}`);

    if (hasImageDisplay) {
      const matches = htmlContent.match(/<img[^>]*src=["']\/mail\/ImageDisplay\?[^"']*["'][^>]*>/gi);
      console.log(`\n  Found ${matches?.length || 0} ImageDisplay image(s):`);
      if (matches) {
        matches.forEach((match, i) => {
          console.log(`\n  Image ${i + 1}:`);
          console.log(`    ${match.substring(0, 200)}...`);
        });
      }
    }

    // Update email HTML in database to original
    console.log('\n\n💾 Updating email HTML to original from Zoho...');
    await db.execute(
      'UPDATE customer_emails SET body_html = ? WHERE id = ?',
      [htmlContent, email.id]
    );

    console.log('✅ Email 1172 fixed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Failed to fix email:', error);
    process.exit(1);
  }
}

fixEmail();
