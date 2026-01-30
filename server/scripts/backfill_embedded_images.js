#!/usr/bin/env node
/**
 * Backfill Embedded Images Script
 *
 * Processes existing emails that contain Zoho ImageDisplay URLs:
 * 1. Finds emails with /mail/ImageDisplay URLs in their HTML
 * 2. Downloads the embedded images from Zoho
 * 3. Saves them as inline attachments
 * 4. Replaces ImageDisplay URLs with cid: references
 *
 * This fixes emails that were synced before the embedded image processing was implemented.
 */

import db from '../src/config/database.js';
import { downloadEmbeddedImage } from '../src/services/zohoMailEnhanced.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attachment storage path
const ATTACHMENTS_DIR = path.join(__dirname, '../storage/email_attachments');

/**
 * Process embedded images for a single email
 */
async function processEmailEmbeddedImages(shopId, email) {
  const { id: emailId, body_html, zoho_message_id, conversation_id } = email;

  if (!body_html) {
    return { success: false, reason: 'No HTML content' };
  }

  try {
    // Find all Zoho ImageDisplay URLs
    const imageDisplayRegex = /<img([^>]*?)src=["']\/mail\/ImageDisplay\?([^"']+)["']([^>]*?)>/gi;
    const matches = [...body_html.matchAll(imageDisplayRegex)];

    if (matches.length === 0) {
      return { success: false, reason: 'No embedded images' };
    }

    console.log(`  🖼️  Processing ${matches.length} embedded image(s)...`);

    // Get email account and folder from conversation
    const [convRows] = await db.execute(
      'SELECT ec.*, o.order_number FROM email_conversations ec LEFT JOIN orders o ON ec.order_id = o.id WHERE ec.id = ?',
      [conversation_id]
    );

    if (convRows.length === 0) {
      return { success: false, reason: 'Conversation not found' };
    }

    // Determine which email account this belongs to (sales@ or support@)
    const accountEmail = 'sales@tfswheels.com'; // Default to sales@
    const folderId = '1'; // Inbox

    // Ensure attachments directory exists
    await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });

    let modifiedHtml = body_html;
    let successCount = 0;
    let failCount = 0;

    for (const match of matches) {
      try {
        const fullImgTag = match[0];
        const beforeSrc = match[1];
        let queryString = match[2];
        const afterSrc = match[3];

        // Decode HTML entities in query string (&amp; -> &)
        queryString = queryString.replace(/&amp;/g, '&');

        // Reconstruct the full ImageDisplay URL
        const imageDisplayUrl = `/mail/ImageDisplay?${queryString}`;

        // Parse query parameters
        const params = new URLSearchParams(queryString);
        const filename = params.get('f');
        const cidParam = params.get('cid');

        if (!filename) {
          console.warn(`    ⚠️  Skipping image with no filename parameter`);
          console.warn(`    Query string: ${queryString}`);
          failCount++;
          continue;
        }

        // Download the embedded image directly from ImageDisplay endpoint
        const imageData = await downloadEmbeddedImage(shopId, imageDisplayUrl);

        // Generate unique filename
        const timestamp = Date.now();
        const randomSuffix = crypto.randomBytes(4).toString('hex');
        const ext = path.extname(imageData.filename) || '.jpg';
        const safeName = path.basename(imageData.filename, ext).replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueFilename = `${timestamp}_${randomSuffix}_${safeName}${ext}`;
        const filePath = path.join(ATTACHMENTS_DIR, uniqueFilename);

        // Save to file system
        await fs.writeFile(filePath, imageData.buffer);

        // Generate content ID
        const contentId = cidParam || `${safeName}_${randomSuffix}@tfswheels`;

        // Save to database as inline attachment
        await db.execute(
          `INSERT INTO email_attachments
           (email_id, filename, original_filename, file_path, file_size, mime_type, is_inline, content_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            emailId,
            uniqueFilename,
            imageData.filename,
            filePath,
            imageData.size,
            imageData.mimeType,
            1, // is_inline = true
            contentId
          ]
        );

        console.log(`    ✅ Saved: ${imageData.filename} -> cid:${contentId}`);

        // Replace the ImageDisplay URL with cid: reference
        const cidUrl = `cid:${contentId}`;
        const newImgTag = `<img${beforeSrc}src="${cidUrl}"${afterSrc}>`;
        modifiedHtml = modifiedHtml.replace(fullImgTag, newImgTag);

        successCount++;

      } catch (imageError) {
        console.error(`    ❌ Failed to process embedded image:`, imageError.message);
        failCount++;
      }
    }

    // Update email with modified HTML
    if (modifiedHtml !== body_html) {
      await db.execute(
        `UPDATE customer_emails SET body_html = ? WHERE id = ?`,
        [modifiedHtml, emailId]
      );
    }

    return {
      success: true,
      imagesProcessed: successCount,
      imagesFailed: failCount
    };

  } catch (error) {
    console.error(`  ❌ Error processing email ${emailId}:`, error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Main backfill function
 */
async function backfillEmbeddedImages() {
  try {
    console.log('🔄 Starting embedded images backfill...\n');

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      ['2f3d7a-2.myshopify.com']
    );

    if (shopRows.length === 0) {
      console.error('❌ Shop not found');
      process.exit(1);
    }

    const shopId = shopRows[0].id;

    // Find all emails with ImageDisplay URLs
    const [emails] = await db.execute(`
      SELECT
        e.id,
        e.body_html,
        e.zoho_message_id,
        e.conversation_id,
        e.subject,
        ec.ticket_number
      FROM customer_emails e
      JOIN email_conversations ec ON e.conversation_id = ec.id
      WHERE e.body_html LIKE '%/mail/ImageDisplay%'
      ORDER BY e.id ASC
    `);

    console.log(`Found ${emails.length} email(s) with embedded images\n`);

    if (emails.length === 0) {
      console.log('✅ No emails to process');
      process.exit(0);
    }

    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let totalImagesProcessed = 0;
    let totalImagesFailed = 0;

    for (const email of emails) {
      console.log(`Processing email ${email.id} (Ticket: ${email.ticket_number})...`);
      console.log(`  Subject: ${email.subject}`);

      const result = await processEmailEmbeddedImages(shopId, email);

      if (result.success) {
        processedCount++;
        totalImagesProcessed += result.imagesProcessed || 0;
        totalImagesFailed += result.imagesFailed || 0;
        console.log(`  ✅ Success: ${result.imagesProcessed} image(s) processed, ${result.imagesFailed} failed\n`);
      } else if (result.reason === 'No embedded images') {
        skippedCount++;
        console.log(`  ⏭️  Skipped: ${result.reason}\n`);
      } else {
        failedCount++;
        console.log(`  ❌ Failed: ${result.reason}\n`);
      }

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Summary:');
    console.log('='.repeat(60));
    console.log(`Total emails found: ${emails.length}`);
    console.log(`Successfully processed: ${processedCount}`);
    console.log(`Skipped (no images): ${skippedCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(`Total images downloaded: ${totalImagesProcessed}`);
    console.log(`Total images failed: ${totalImagesFailed}`);
    console.log('='.repeat(60));

    process.exit(0);

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

// Run the backfill
backfillEmbeddedImages();
