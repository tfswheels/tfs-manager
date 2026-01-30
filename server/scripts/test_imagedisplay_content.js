#!/usr/bin/env node
import { downloadEmbeddedImage } from '../src/services/zohoMailEnhanced.js';

async function testDownload() {
  try {
    const shopId = 1;
    const imageDisplayUrl = '/mail/ImageDisplay?na=4132877000000008002&nmsgId=1769809526191153400&f=1.png&mode=inline&cid=0.1730347760.1656728105959496990.19c10de35bc__inline__img__src&';

    console.log('Downloading and checking content...\n');

    const imageData = await downloadEmbeddedImage(shopId, imageDisplayUrl);

    console.log(`Downloaded ${imageData.size} bytes`);
    console.log(`MIME Type: ${imageData.mimeType}\n`);

    // Check if it's actually an image by looking at the first few bytes
    const header = imageData.buffer.slice(0, 100).toString();
    console.log('First 100 chars:');
    console.log(header);
    console.log('');

    // Check for PNG signature
    const isPNG = imageData.buffer[0] === 0x89 && imageData.buffer[1] === 0x50;
    // Check for JPEG signature
    const isJPEG = imageData.buffer[0] === 0xFF && imageData.buffer[1] === 0xD8;
    // Check for HTML
    const isHTML = header.includes('<html') || header.includes('<!DOCTYPE');

    console.log('File type detection:');
    console.log(`  Is PNG: ${isPNG}`);
    console.log(`  Is JPEG: ${isJPEG}`);
    console.log(`  Is HTML: ${isHTML}`);

    if (isHTML) {
      console.log('\n❌ Zoho returned HTML (probably an auth error or login page)');
      console.log('The ImageDisplay endpoint requires cookie-based authentication, not OAuth token');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testDownload();
