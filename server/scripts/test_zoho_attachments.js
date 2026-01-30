#!/usr/bin/env node
import { fetchEmailAttachments } from '../src/services/zohoMailEnhanced.js';

async function testZohoAttachments() {
  try {
    const shopId = 1;
    const messageId = '1769809526191153400'; // Test email
    const accountEmail = 'sales@tfswheels.com';
    const folderId = '1';

    console.log('Fetching attachments from Zoho API...');
    console.log(`Message ID: ${messageId}\n`);

    const attachments = await fetchEmailAttachments(shopId, messageId, accountEmail, folderId);

    console.log(`Total attachments: ${attachments.length}\n`);

    attachments.forEach((att, i) => {
      console.log(`Attachment ${i+1}:`);
      console.log(`  Name: ${att.attachmentName}`);
      console.log(`  ID: ${att.attachmentId}`);
      console.log(`  Size: ${att.size}`);
      console.log(`  Type: ${att.mimeType}`);
      console.log(`  Disposition: ${att.disposition}`);
      console.log(`  Content-ID: ${att.contentId}`);
      console.log('');
    });

    // Check if any match "1.png"
    const pngMatch = attachments.find(att => att.attachmentName === '1.png');
    if (pngMatch) {
      console.log('✅ Found 1.png in attachments!');
    } else {
      console.log('❌ 1.png NOT in attachments list');
      console.log('This means the embedded image is NOT accessible via Zoho attachments API');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testZohoAttachments();
