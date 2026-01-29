# Embedded Email Images - Implementation Complete

## Summary

Implemented full support for embedded/inline email images in the TFS Manager email system. Previously, embedded images in emails were displayed as `<imageX.jpeg>` placeholders. Now they are properly downloaded from Zoho, stored locally, and displayed inline in email threads.

**Date:** 2026-01-28
**Status:** ✅ Implementation Complete - Ready for Testing

---

## Problem

When emails with embedded images were synced from Zoho Mail, the images were not being downloaded or stored. The email HTML contained `cid:` (Content-ID) references like `<img src="cid:abc123@zoho.com">`, but there was no mechanism to:
1. Download the image files from Zoho
2. Store them on the server
3. Replace the `cid:` references with actual URLs

This resulted in broken images showing as `<imageX.jpeg>` text in the email viewer.

---

## Solution Overview

Implemented a complete end-to-end solution:
1. **Zoho API Integration**: Fetch attachment metadata and download files
2. **Server Storage**: Save attachments to file system with database metadata
3. **Email Sync**: Automatically process attachments during email sync
4. **API Endpoints**: Serve attachment files to frontend
5. **Frontend Processing**: Replace `cid:` references with actual image URLs

---

## Changes Made

### 1. Backend - Zoho Mail API (`server/src/services/zohoMailEnhanced.js`)

**Added two new functions:**

#### `fetchEmailAttachments()`
- Fetches attachment metadata from Zoho Mail API
- Endpoint: `/accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachmentinfo`
- Returns list of attachments with IDs, filenames, sizes, and Content-IDs
- Handles errors gracefully (returns empty array if no attachments)

#### `downloadAttachment()`
- Downloads actual attachment file data from Zoho
- Endpoint: `/accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachments/{attachmentId}`
- Returns file as Buffer for saving to disk
- Uses `responseType: 'arraybuffer'` for binary data

**Lines Added:** 447-529

---

### 2. Backend - Email Sync Service (`server/src/services/emailInboxSync.js`)

**Added attachment processing:**

#### New Function: `processAndSaveAttachments()`
- Called after each email is saved
- Fetches attachment metadata from Zoho
- Downloads each attachment file
- Saves files to `server/storage/email_attachments/`
- Stores metadata in `email_attachments` database table
- Handles inline vs regular attachments
- Generates unique filenames with timestamp prefix

**Key Features:**
- Creates storage directory if it doesn't exist
- Extracts Content-ID for inline images
- Stores `is_inline` flag for proper handling
- Continues on error (doesn't fail entire sync)

**File Storage Pattern:**
```
server/storage/email_attachments/1738123456789_image.jpg
```

**Database Record:**
```sql
INSERT INTO email_attachments (
  email_id,
  filename,           -- Unique: 1738123456789_image.jpg
  original_filename,  -- Original: image.jpg
  file_path,          -- Full path on disk
  file_size,          -- Bytes
  mime_type,          -- image/jpeg, image/png, etc.
  is_inline,          -- 1 for inline, 0 for regular attachments
  content_id,         -- <abc123@zoho.com> for cid: references
  created_at
) VALUES (...)
```

**Lines Modified:**
- Imports: 1-13
- New function: 40-97
- Email sync integration: 245-265

---

### 3. Backend - API Routes (`server/src/routes/tickets.js`)

**Added two new endpoints:**

#### `GET /api/tickets/attachments/:attachmentId`
Serves individual attachment files.

**Features:**
- Looks up attachment metadata from database
- Reads file from disk
- Sets proper Content-Type header
- Sets Content-Disposition for inline display
- Caches for 1 day (`Cache-Control: public, max-age=86400`)
- Returns 404 if file not found

**Example:**
```
GET /api/tickets/attachments/123
Response: <binary image data>
Headers:
  Content-Type: image/jpeg
  Content-Disposition: inline; filename="screenshot.jpg"
  Cache-Control: public, max-age=86400
```

#### `GET /api/tickets/:ticketId/attachments`
Returns all attachments for a ticket/conversation.

**Response Format:**
```json
{
  "success": true,
  "attachments": [
    {
      "id": 123,
      "email_id": 456,
      "filename": "1738123456789_image.jpg",
      "original_filename": "image.jpg",
      "file_size": 245760,
      "mime_type": "image/jpeg",
      "is_inline": 1,
      "content_id": "<abc123@zoho.com>",
      "created_at": "2026-01-28T10:30:00Z",
      "email_subject": "Product inquiry",
      "direction": "inbound",
      "url": "/api/tickets/attachments/123"
    }
  ]
}
```

**Lines Added:** 6-10, 23-25, 1359-1447

---

### 4. Frontend - Email Thread Component (`admin/src/pages/EmailThread.jsx`)

**Added inline image support:**

#### New State Variable: `emailAttachments`
Stores all attachments for the current ticket (separate from reply attachments).

#### New Function: `fetchAttachments()`
- Fetches attachments when ticket is loaded
- Calls `GET /api/tickets/:ticketId/attachments`
- Stores in `emailAttachments` state

#### New Function: `processInlineImages(html, attachments)`
Processes email HTML to replace `cid:` references with actual URLs.

**Algorithm:**
1. Filter attachments to find inline ones (with `content_id`)
2. For each inline attachment, create multiple CID pattern variations:
   - `cid:abc123@zoho.com`
   - `cid:<abc123@zoho.com>` (with angle brackets)
   - Without angle brackets
3. Replace all matches with actual image URL:
   - `https://tfs-manager-server.../api/tickets/attachments/123`
4. Return processed HTML

**Example Transformation:**
```html
<!-- Before -->
<img src="cid:abc123@zoho.com" alt="Product">

<!-- After -->
<img src="https://tfs-manager-server-production.up.railway.app/api/tickets/attachments/123" alt="Product">
```

**Integration:**
```jsx
<div dangerouslySetInnerHTML={{
  __html: processInlineImages(message.body_html, emailAttachments)
}} />
```

**Bug Fix:**
- Renamed reply attachment state from `attachments` to `replyAttachments`
- Separated concerns (email attachments vs reply attachments)

**Lines Modified:**
- State: 42, 47-48
- UseEffect: 50-56
- Functions: 107-155
- Rendering: 699 (critical change)
- Reply attachments: 224, 267, 294, 298, 606, 609

---

## Database Schema

### `email_attachments` Table

Already existed but was never populated. Now actively used:

```sql
CREATE TABLE email_attachments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email_id INT NOT NULL,              -- FK to customer_emails
  filename VARCHAR(255) NOT NULL,      -- Unique timestamped filename
  original_filename VARCHAR(255),      -- Original from Zoho
  file_path VARCHAR(500),              -- Full path on disk
  file_url VARCHAR(500),               -- Unused (for future cloud storage)
  file_size INT,                       -- Bytes
  mime_type VARCHAR(100),              -- Content-Type
  is_inline TINYINT(1),                -- 1 for inline images
  uploaded_by INT,                     -- FK to staff_users (for manual uploads)
  content_id VARCHAR(255),             -- For cid: references
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (email_id) REFERENCES customer_emails(id),
  INDEX idx_email_id (email_id),
  INDEX idx_content_id (content_id)
);
```

---

## File Structure

```
server/
  ├── src/
  │   ├── services/
  │   │   ├── zohoMailEnhanced.js         [MODIFIED] +82 lines
  │   │   └── emailInboxSync.js           [MODIFIED] +68 lines
  │   └── routes/
  │       └── tickets.js                  [MODIFIED] +92 lines
  └── storage/
      └── email_attachments/              [NEW] Storage directory
          └── {timestamp}_{filename}      Attachment files

admin/
  └── src/
      └── pages/
          └── EmailThread.jsx             [MODIFIED] +68 lines
```

---

## API Documentation

### Serve Attachment File
```
GET /api/tickets/attachments/:attachmentId

Response: Binary file data
Headers:
  Content-Type: {mime_type}
  Content-Disposition: inline; filename="{original_filename}"
  Cache-Control: public, max-age=86400

Error Responses:
  404 - Attachment not found
  404 - File not found on server
  500 - Server error
```

### List Ticket Attachments
```
GET /api/tickets/:ticketId/attachments?shop={shop}

Response:
{
  "success": true,
  "attachments": [
    {
      "id": number,
      "email_id": number,
      "filename": string,
      "original_filename": string,
      "file_size": number,
      "mime_type": string,
      "is_inline": 0 | 1,
      "content_id": string | null,
      "created_at": string,
      "email_subject": string,
      "direction": "inbound" | "outbound",
      "url": string
    }
  ]
}

Error Responses:
  500 - Server error
```

---

## Testing Checklist

### Backend Testing
- [ ] Start server and check for syntax errors
- [ ] Test attachment endpoint: `GET /api/tickets/attachments/1` (will 404 until attachments exist)
- [ ] Test attachment list: `GET /api/tickets/1/attachments`
- [ ] Trigger email sync manually to fetch new emails with images
- [ ] Check `server/storage/email_attachments/` for downloaded files
- [ ] Check database: `SELECT * FROM email_attachments;`

### Frontend Testing
- [ ] Open email thread with images
- [ ] Verify images display inline (not broken)
- [ ] Check browser console for errors
- [ ] Verify reply attachments still work
- [ ] Test with different image formats (JPEG, PNG, GIF)

### Integration Testing
- [ ] Send test email with embedded images to sales@tfswheels.com
- [ ] Wait for email sync (runs every minute)
- [ ] Check Railway logs for attachment processing
- [ ] Open ticket in frontend
- [ ] Verify images display correctly

---

## How It Works - Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Email arrives at sales@tfswheels.com or support@tfswheels.com │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Email sync runs (every minute)                                │
│    - fetchInbox() gets email list from Zoho                      │
│    - fetchEmailDetails() gets full email content                 │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. saveEmail() stores email in database                          │
│    - Returns email_id                                            │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. processAndSaveAttachments(emailId, messageId)                 │
│    ├─ fetchEmailAttachments() → Get attachment metadata          │
│    ├─ For each attachment:                                       │
│    │   ├─ downloadAttachment() → Download file from Zoho        │
│    │   ├─ Save file to: server/storage/email_attachments/       │
│    │   └─ INSERT INTO email_attachments → Save metadata         │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. User opens email thread in frontend                           │
│    - fetchConversation() → Get ticket & messages                 │
│    - fetchAttachments() → Get all attachments                    │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. processInlineImages(html, attachments)                        │
│    - Find cid: references in HTML                                │
│    - Match with attachment content_id                            │
│    - Replace with: /api/tickets/attachments/{id}                 │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Render HTML with real image URLs                              │
│    - Browser loads images from attachment endpoint               │
│    - Images display inline in email thread                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### File Storage
- ✅ Files stored outside web root (`server/storage/`)
- ✅ Unique filenames prevent collisions
- ✅ No direct file access (must go through API)
- ✅ MIME type validation from Zoho

### API Endpoints
- ⚠️ **TODO**: Add authentication check (currently public)
- ✅ File path validation (database lookup prevents directory traversal)
- ✅ Content-Type headers prevent XSS
- ✅ `Content-Disposition: inline` allows browser security

### HTML Rendering
- ⚠️ Uses `dangerouslySetInnerHTML` (existing issue, not introduced by this change)
- ✅ Only processes `cid:` references (doesn't modify other content)
- 📝 **Future**: Add HTML sanitization with DOMPurify

---

## Performance Considerations

### Storage
- Local disk storage (fast access)
- Future: Can migrate to cloud storage (S3, GCS) using `file_url` column
- Cache headers reduce repeated requests

### Email Sync
- Attachments processed after email saved (non-blocking)
- Errors don't fail email sync
- Only downloads new attachments (checks for existing)

### Frontend
- Attachments fetched once per ticket view
- Images cached by browser (24 hours)
- `cid:` processing is client-side (minimal overhead)

---

## Known Limitations

1. **No Authentication on Attachment Endpoint**
   - Currently public (anyone with ID can access)
   - TODO: Add shop verification

2. **HTML Sanitization**
   - Still uses `dangerouslySetInnerHTML` without sanitization
   - TODO: Add DOMPurify or similar

3. **Storage Cleanup**
   - No automatic deletion of old attachments
   - TODO: Add cleanup job for deleted emails

4. **File Size Limits**
   - No explicit limit (relies on Zoho's limits)
   - TODO: Add server-side size checks

---

## Future Enhancements

### Short Term
1. Add authentication to attachment endpoints
2. Add HTML sanitization with DOMPurify
3. Add attachment size limits and validation

### Medium Term
1. Migrate to cloud storage (S3/GCS) for scalability
2. Add attachment preview/thumbnails for large images
3. Add download statistics/tracking

### Long Term
1. Support for other attachment types (PDFs, etc.)
2. In-line PDF viewer
3. Image optimization (resize, compress)
4. Attachment search functionality

---

## Debugging

### Check if attachments are being downloaded:
```bash
# SSH into server
ls -la server/storage/email_attachments/

# Check database
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager \
  -e "SELECT * FROM email_attachments ORDER BY created_at DESC LIMIT 5;"
```

### Check API responses:
```bash
# List attachments for ticket
curl https://tfs-manager-server-production.up.railway.app/api/tickets/1/attachments?shop=2f3d7a-2.myshopify.com

# Get specific attachment
curl https://tfs-manager-server-production.up.railway.app/api/tickets/attachments/1
```

### Frontend debugging:
```javascript
// In browser console on email thread page
console.log('Email Attachments:', emailAttachments);
console.log('Processed HTML:', processInlineImages(message.body_html, emailAttachments));
```

---

## Deployment Checklist

- [ ] Commit changes to Git
- [ ] Push to GitHub (triggers Railway deployment)
- [ ] Verify storage directory exists on Railway
- [ ] Monitor Railway logs during deployment
- [ ] Test with existing emails
- [ ] Force email sync to test with new emails
- [ ] Verify images display correctly in frontend

---

## Git Commit Message

```
Add embedded email images support

- Add Zoho API functions to fetch and download attachments
- Automatically download attachments during email sync
- Store attachments in server/storage/email_attachments/
- Add API endpoints to serve attachment files
- Process HTML to replace cid: references with URLs
- Display inline images in email thread view

Fixes: Embedded images showing as <imageX.jpeg> placeholders
Database: Uses existing email_attachments table
Storage: Local file system (future: cloud storage)

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

---

**Implementation Complete**: 2026-01-28
**Ready for Testing and Deployment**
