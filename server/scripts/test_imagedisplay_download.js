#!/usr/bin/env node
import { downloadEmbeddedImage } from '../src/services/zohoMailEnhanced.js';

async function testDownload() {
  try {
    const shopId = 1;
    const imageDisplayUrl = '/mail/ImageDisplay?na=4132877000000008002&nmsgId=1769809526191153400&f=1.png&mode=inline&cid=0.1730347760.1656728105959496990.19c10de35bc__inline__img__src&';

    console.log('Testing ImageDisplay download...');
    console.log(`URL: ${imageDisplayUrl}\n`);

    const imageData = await downloadEmbeddedImage(shopId, imageDisplayUrl);

    console.log('\n✅ Download successful!');
    console.log(`Filename: ${imageData.filename}`);
    console.log(`Size: ${imageData.size} bytes (${(imageData.size / 1024).toFixed(2)} KB)`);
    console.log(`MIME Type: ${imageData.mimeType}`);
    console.log(`Content-ID: ${imageData.contentId}`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Download failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testDownload();
