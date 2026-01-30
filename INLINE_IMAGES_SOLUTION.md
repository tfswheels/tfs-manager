# Inline/Embedded Images Solution

## ✅ WORKING SOLUTION - Images Display Inline in Email Threads

This document explains how we successfully implemented inline/embedded image support for emails synced from Zoho Mail, allowing images to display directly in email threads instead of showing placeholder buttons.

---

## The Problem

When emails with embedded images were synced from Zoho Mail, they appeared as "View Image in Zoho Mail" placeholder buttons instead of displaying the actual images inline. This was because:

1. **Zoho's HTML format**: Zoho sends email HTML with `/mail/ImageDisplay?...` URLs that require authentication
2. **Frontend can't authenticate**: The Vercel/Shopify frontend can't authenticate directly with Zoho
3. **No image downloading**: The original sync process didn't download or process embedded images at all

### What We Initially Thought Wouldn't Work

Initially, it seemed like we couldn't display inline images because:
- We thought we'd need to proxy all Zoho ImageDisplay requests
- We thought Railway's ephemeral storage would prevent saving images
- We assumed CORS issues would block image loading

**But we were wrong!** We found a working solution using Zoho's `/inline` API endpoint.

---

## The Solution Architecture

### Overview

1. **Email sync** downloads inline images using Zoho's `/inline` API endpoint
2. **HTML replacement** replaces Zoho ImageDisplay URLs with our attachment URLs
3. **Smart serving** tries disk first, falls back to Zoho if file missing (Railway deployments)
4. **CORS enabled** allows Vercel frontend to load images from Railway backend

### Key Files Modified

- `/server/src/services/zohoMailEnhanced.js` - Zoho API integration
- `/server/src/services/emailInboxSync.js` - Email sync and HTML processing
- `/server/src/routes/tickets.js` - Attachment serving endpoint

---

## Implementation Details

### 1. Zoho Mail API - `/inline` Endpoint Discovery

**Key Discovery**: Zoho provides a dedicated `/inline` endpoint for downloading embedded images using OAuth authentication.

**File**: `server/src/services/zohoMailEnhanced.js`

```javascript
export async function downloadInlineImage(shopId, messageId, contentId, filename, accountEmail = EMAIL_ACCOUNTS.sales, folderId = '1') {
  const accessToken = await getAccessToken(shopId);
  const accountId = await getZohoAccountId(accessToken, accountEmail);

  // Use Zoho's /inline endpoint with OAuth
  const response = await axios.get(
    `${ZOHO_API_BASE}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/inline`,
    {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      },
      params: {
        contentId: contentId  // The cid identifies the specific inline image
      },
      responseType: 'arraybuffer'
    }
  );

  return Buffer.from(response.data);
}
```

**Also updated** `fetchEmailAttachments()` to include `includeInline: 'true'` parameter, which returns separate arrays:
```javascript
{
  attachments: [...],  // Regular attachments
  inline: [...]        // Inline/embedded images with cid
}
```

### 2. Email Sync - Download Inline Images

**File**: `server/src/services/emailInboxSync.js`

**Function**: `processAndSaveAttachments()`

```javascript
// Fetch both regular attachments and inline images
const { attachments, inline } = await fetchEmailAttachments(shopId, messageId, accountEmail, folderId);

// Process regular attachments (metadata only - download on-demand)
for (const attachment of attachments) {
  await db.execute(
    `INSERT INTO email_attachments (...) VALUES (...)`,
    [..., is_inline: 0, ...]
  );
}

// Process inline images (download immediately and save to disk)
for (const inlineImage of inline) {
  // Download using /inline endpoint
  const imageData = await downloadInlineImage(
    shopId,
    messageId,
    inlineImage.cid,  // Content-ID identifies the image
    inlineImage.attachmentName,
    accountEmail,
    folderId
  );

  // Save to Railway's ephemeral storage
  const filePath = path.join(ATTACHMENTS_DIR, uniqueFilename);
  await fs.writeFile(filePath, imageData);

  // Save to database with cid mapping
  await db.execute(
    `INSERT INTO email_attachments (...) VALUES (...)`,
    [..., is_inline: 1, content_id: inlineImage.cid, file_path: filePath, ...]
  );

  // Build cid -> attachmentId mapping for HTML replacement
  cidToAttachmentId[inlineImage.cid] = result.insertId;
}

return cidToAttachmentId;  // Used for HTML replacement
```

### 3. HTML Replacement - The Critical Part

**The Problem**: Zoho's HTML contains `/mail/ImageDisplay?...` URLs, NOT `cid:` references.

**Example Zoho HTML**:
```html
<img src="/mail/ImageDisplay?na=4132877000000008002&nmsgId=1769816295515153400&f=1.png&mode=inline&cid=0.1730347760.1656728105959496990.19c10de35bc__inline__img__src&" width="400" height="356">
```

**Notice**: The `cid` is a **query parameter** in the ImageDisplay URL, not a `cid:` reference.

**Solution**: Parse ImageDisplay URLs, extract the cid parameter, and replace with our attachment URLs.

**File**: `server/src/services/emailInboxSync.js`

```javascript
// After downloading inline images
if (bodyHtml && Object.keys(cidMapping).length > 0) {
  let updatedHtml = bodyHtml;
  const baseUrl = process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app';

  // Find all ImageDisplay img tags
  const imgRegex = /<img([^>]*?)src=["']\/mail\/ImageDisplay\?([^"']+)["']([^>]*?)>/gi;
  const matches = [...bodyHtml.matchAll(imgRegex)];

  for (const match of matches) {
    const fullImgTag = match[0];
    const beforeSrc = match[1];
    let queryString = match[2];
    const afterSrc = match[3];

    // Decode HTML entities (&amp; -> &)
    queryString = queryString.replace(/&amp;/g, '&');

    // Parse query parameters to extract cid
    const params = new URLSearchParams(queryString);
    const cidParam = params.get('cid');

    // Look up our attachment ID from the cid mapping
    const attachmentId = cidMapping[cidParam];

    if (attachmentId) {
      // Replace entire img tag with our attachment URL
      const replacementUrl = `${baseUrl}/api/tickets/attachments/${attachmentId}`;
      const newImgTag = `<img${beforeSrc}src="${replacementUrl}"${afterSrc}>`;
      updatedHtml = updatedHtml.replace(fullImgTag, newImgTag);
    }
  }

  // Update database with modified HTML
  await db.execute(
    'UPDATE customer_emails SET body_html = ? WHERE id = ?',
    [updatedHtml, emailId]
  );
}
```

**Result HTML**:
```html
<img src="https://tfs-manager-server-production.up.railway.app/api/tickets/attachments/20" width="400" height="356">
```

### 4. Smart Serving - Railway Ephemeral Storage Challenge

**The Challenge**: Railway's storage is ephemeral - files get wiped on every deployment.

**The Solution**: Try disk first (fast), fall back to Zoho if missing.

**File**: `server/src/routes/tickets.js`

**Endpoint**: `GET /api/tickets/attachments/:id`

```javascript
router.get('/attachments/:id', async (req, res) => {
  const attachment = /* fetch from database */;

  let fileData;

  // For inline images
  if (attachment.is_inline && attachment.file_path) {
    try {
      // Try reading from disk (fast path)
      fileData = await fs.readFile(attachment.file_path);
      console.log('✅ Loaded inline image from disk');
    } catch (error) {
      // File not found (Railway deployment wiped storage)
      // Fall back to downloading from Zoho
      console.warn('⚠️ Inline image not on disk, fetching from Zoho...');

      fileData = await downloadInlineImage(
        shopId,
        attachment.zoho_message_id,
        attachment.content_id,  // Use cid, not attachment ID
        attachment.original_filename,
        attachment.zoho_account_email,
        attachment.zoho_folder_id
      );
    }
  } else {
    // Regular attachment - always fetch from Zoho on-demand
    fileData = await downloadAttachment(
      shopId,
      attachment.zoho_message_id,
      attachment.zoho_attachment_id,
      attachment.zoho_account_email,
      attachment.zoho_folder_id
    );
  }

  // Set inline disposition for browser rendering
  const disposition = attachment.is_inline ? 'inline' : 'attachment';

  res.setHeader('Content-Type', attachment.mime_type);
  res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.original_filename}"`);
  res.send(fileData);
});
```

**Why this works**:
- First load after sync: Image served from disk (fast)
- After Railway deployment: Image re-downloaded from Zoho (slightly slower, but works)
- Subsequent loads: Could be cached by Railway or browser
- No permanent storage needed!

---

## Database Schema

### `email_attachments` Table (Relevant Columns)

```sql
- id (PRIMARY KEY)
- email_id (FK to customer_emails)
- filename (unique filename on disk)
- original_filename (original name from email)
- file_path (path on Railway's ephemeral storage, can be NULL)
- file_size (bytes)
- mime_type (e.g., 'image/png')
- is_inline (0 = regular attachment, 1 = embedded image)
- content_id (cid for inline images, NULL for regular attachments)
- zoho_attachment_id (for regular attachments)
- zoho_message_id (Zoho message ID)
- zoho_account_email (sales@ or support@)
- zoho_folder_id (usually '1' for inbox)
```

**Key Points**:
- `is_inline = 1` identifies embedded images
- `content_id` stores the cid for HTML replacement and Zoho API calls
- `zoho_attachment_id` is used for regular attachments, NOT inline images
- Both regular and inline attachments store Zoho metadata for re-downloading

---

## CORS Configuration

**File**: `server/src/index.js`

```javascript
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://tfs-manager-admin.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));
```

**Why this matters**:
- Vercel frontend (embedded in Shopify iframe) loads images from Railway backend
- Without CORS, browsers block cross-origin image requests
- `credentials: true` allows authenticated requests if needed

---

## Testing & Verification

### Test Email: "Test #6" (Email ID 1177)

**Database Record**:
```
ID: 1177
Subject: Test #6
Attachment ID: 20 (inline image)
CID: 0.1730347760.1656728105959496990.19c10de35bc__inline__img__src
```

**HTML Before Fix**:
```html
<img src="/mail/ImageDisplay?na=...&cid=0.1730347760...&" width="400" height="356">
```

**HTML After Fix**:
```html
<img src="https://tfs-manager-server-production.up.railway.app/api/tickets/attachments/20" width="400" height="356">
```

**Result**: ✅ Image displays inline in email thread!

### Migration Script (One-Time Fix)

**File**: `/tmp/fix_test6_html.mjs`

Used to fix existing emails that were synced before the HTML replacement logic was implemented. For new emails, the fix is automatic during sync.

---

## Key Learnings & Gotchas

### ✅ What Works

1. **Zoho's `/inline` endpoint** - Official OAuth-authenticated way to download embedded images
2. **Smart fallback** - Disk first, Zoho second (handles Railway ephemeral storage)
3. **HTML replacement** - Parse ImageDisplay URLs, extract cid, replace with our URLs
4. **CORS enabled** - Allows Vercel frontend to load images from Railway backend
5. **Content-Disposition: inline** - Tells browser to display image, not download

### ❌ What Doesn't Work

1. **Assuming `cid:` references** - Zoho uses ImageDisplay URLs, not cid: references
2. **Returning 404 when file missing** - Must fall back to Zoho, not fail
3. **Using `downloadAttachment()` for inline images** - Must use `downloadInlineImage()` with cid
4. **Relying on Railway storage** - It's ephemeral, files get wiped on deployment

### 🔑 Critical Implementation Details

1. **Use `includeInline: 'true'` parameter** when fetching attachment list from Zoho
2. **Store `content_id` (cid)** in database for inline images - needed for re-downloading
3. **Parse ImageDisplay URL query params** to extract cid for HTML replacement
4. **Set `Content-Disposition: inline`** for browser to render image instead of download
5. **Import `downloadInlineImage`** in tickets.js for fallback serving

---

## Future Improvements (Optional)

### Option 1: Persistent Storage (e.g., S3)
- Save inline images to S3 instead of Railway's ephemeral storage
- Faster serving (no Zoho fallback needed)
- Additional cost and complexity

### Option 2: Browser Caching
- Set aggressive cache headers for inline images
- Reduces repeated downloads from Zoho
- Already partially implemented by browsers

### Option 3: Background Re-download
- After Railway deployment, background job re-downloads all inline images
- Faster first-page load
- More complex, probably not needed

**Current solution works perfectly without these!**

---

## Summary

**We successfully implemented inline image display** by:

1. ✅ Using Zoho's `/inline` API endpoint to download embedded images during email sync
2. ✅ Parsing ImageDisplay URLs to extract cid and replace with our attachment URLs
3. ✅ Implementing smart fallback serving (disk → Zoho) to handle Railway's ephemeral storage
4. ✅ Setting proper CORS and Content-Disposition headers for browser rendering

**Result**: Images now display inline in email threads, exactly as they appear in the original emails!

---

**Last Updated**: 2026-01-30
**Status**: ✅ WORKING IN PRODUCTION
