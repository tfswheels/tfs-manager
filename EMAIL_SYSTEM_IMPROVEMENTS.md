# Email System Improvements

## Summary of Changes

This document outlines the major improvements made to the TFS Manager email system to address sync issues, UI/UX problems, and AI functionality.

---

## 1. Zoho API Reliability Improvements

### Problem
- Zoho API was returning 500 Internal Server Error for sales@tfswheels.com inbox
- No retry logic for transient failures
- Limited error information

### Solution
**File**: `server/src/services/zohoMailEnhanced.js`

- Added retry logic with exponential backoff (3 attempts)
- Improved error logging with detailed status information
- Added 30-second timeout for API requests
- Smart retry logic that skips 4xx errors (except rate limits)

```javascript
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  // Retry with exponential backoff
  const delay = retryDelay * attempt;
}
```

---

## 2. Email Sync Optimization

### Problem
- Fetching 50 emails per sync was potentially causing API issues
- support@ inbox was synced before sales@ inbox
- No limit control

### Solution
**File**: `server/src/services/emailInboxSync.js`

- Reduced default fetch limit from 50 to 20 emails per sync
- Prioritized sales@ inbox to sync FIRST
- Made limit configurable via options
- Added clear comments about priority

```javascript
// IMPORTANT: Sync sales@ FIRST (higher priority, limit to 20 emails per sync)
const salesResult = await syncInbox(shopId, 'sales@tfswheels.com', { limit: 20 });

// Sync support@ SECOND (only emails linked to orders, limit to 20 emails per sync)
const supportResult = await syncInbox(shopId, 'support@tfswheels.com', { limit: 20 });
```

---

## 3. Data Consistency Fixes

### Problem
- Conversation `message_count` field showed 24 messages
- Only 1 actual email record existed in database
- UI displayed incorrect counts

### Solution
**File**: `server/src/services/emailThreading.js`

- Added automatic message count repair in `getConversationWithEmails()`
- Counts actual emails and updates conversation if mismatch detected
- Added `vehicle_full` column to conversation queries (from recent git commit)

```javascript
// Fix message count if inconsistent
const actualCount = emails.length;
if (conversation.message_count !== actualCount) {
  console.log(`⚠️  Fixing message count for conversation #${conversationId}: ${conversation.message_count} -> ${actualCount}`);
  await db.execute(
    `UPDATE email_conversations SET message_count = ? WHERE id = ?`,
    [actualCount, conversationId]
  );
}
```

---

## 4. Complete UI/UX Redesign

### Problem
- Emails opened in modal popup (limited space)
- Multiple buttons on each row instead of clickable rows
- No dedicated page for viewing full conversation
- Order details hidden in sidebar
- Reply interface had placeholders in dropdown

### Solution A: New Dedicated Email Thread Page
**File**: `admin/src/pages/EmailThread.jsx` (NEW)

Created a full-page email thread view with:
- **Left Sidebar (1/3 width)**:
  - AI Summary card with generate/regenerate button
  - Order details with order number link and vehicle info
  - Customer details with name, email, phone

- **Main Content (2/3 width)**:
  - Full email thread showing all messages
  - Reply box with visible placeholder buttons above message box
  - Clear speaker distinction (Customer vs TFS Wheels)
  - Message timestamps and read status

### Solution B: Updated Email List
**File**: `admin/src/pages/CustomerEmails.jsx`

- **Entire row now clickable** - navigates to dedicated page
- Removed modal popup
- Removed EmailThreadView component import
- Order number buttons still clickable (with stopPropagation)
- Cleaner, more intuitive interface

### Solution C: Added Route
**File**: `admin/src/App.jsx`

```javascript
<Route path="/emails/:conversationId" element={<EmailThread />} />
```

---

## 5. AI Summary Improvements

### Problem
- AI summaries didn't clearly distinguish between customer and company messages
- Generic prompts didn't emphasize speaker identification

### Solution
**File**: `server/src/services/claudeAI.js`

Enhanced `formatThreadForContext()`:
```javascript
const speaker = isFromCustomer ? '**CUSTOMER**' : '**TFS WHEELS (US)**';
context += `### Message ${index + 1} - ${speaker}\n`;
context += `**Direction:** ${isFromCustomer ? 'Inbound (from customer)' : 'Outbound (from us)'}\n\n`;
```

Enhanced summary prompt:
- Explicitly asks to distinguish CUSTOMER vs TFS WHEELS
- Structured to show: What customer said → What we responded → What needs doing
- Increased length to 4-6 sentences for better clarity

---

## 6. AI Reply Auto-Suggestion

### Problem
- AI Reply button asked "what do you wish to say"
- Didn't automatically read conversation and suggest response
- Required manual prompt every time

### Solution
**File**: `server/src/services/claudeAI.js`

Added auto-suggestion logic in `generateEmailResponse()`:
```javascript
// If no specific prompt provided and we have thread history, auto-suggest a response
if (!userPrompt && threadEmails && threadEmails.length > 0) {
  const lastEmail = threadEmails[threadEmails.length - 1];
  const isLastFromCustomer = lastEmail.direction === 'inbound';

  if (isLastFromCustomer) {
    userPrompt = `Based on the entire conversation history below, generate an appropriate response...
    Key instructions:
    1. Read and understand the FULL conversation history
    2. Address all points raised by the customer in their latest message
    3. Maintain consistency with our previous responses
    4. Use a natural, helpful tone
    5. Include relevant placeholders...`;
  }
}
```

**UI Update**: `admin/src/pages/EmailThread.jsx`
- Removed manual prompt from AI reply button
- Now passes no prompt, letting backend auto-generate

---

## 7. Placeholder System Improvements

### Problem
- Placeholders were hidden in dropdown
- Not visible while composing
- Hard to discover and use

### Solution
**File**: `admin/src/pages/EmailThread.jsx`

New placeholder UI:
```javascript
<Box padding="200" background="bg-surface-secondary">
  <BlockStack gap="200">
    <Text variant="bodyMd" as="p" fontWeight="semibold">
      Quick Insert:
    </Text>
    <InlineStack gap="200" wrap>
      {availablePlaceholders.slice(0, 10).map((ph) => (
        <Button
          key={ph.key}
          size="slim"
          onClick={() => insertPlaceholder(ph.key)}
        >
          {ph.label}
        </Button>
      ))}
    </InlineStack>
  </BlockStack>
</Box>
```

- Shows first 10 placeholders as buttons above message box
- One-click insertion
- Always visible when reply box is open

---

## Testing Recommendations

1. **Email Sync Test**
   - Monitor logs for sales@ sync success
   - Verify retry logic triggers on failures
   - Check that only 20 emails are fetched per sync

2. **UI Navigation Test**
   - Click on any email row in /emails
   - Verify navigation to /emails/:conversationId
   - Check all 24 messages display (if they exist in DB)
   - Verify order details sidebar shows correctly

3. **AI Features Test**
   - Click "Generate Summary" - verify it distinguishes customer vs company
   - Click "Reply with AI" - verify it auto-generates without asking for prompt
   - Check placeholder buttons appear and work

4. **Message Count Test**
   - Open conversations with mismatched counts
   - Verify they auto-fix on page load

---

## Architecture Overview

```
User clicks email row in /emails
↓
Navigate to /emails/:conversationId (EmailThread.jsx)
↓
Fetch conversation + all emails via API
↓
Auto-fix message count if needed
↓
Display in two-column layout:
  Left: AI Summary, Order Details, Customer Info
  Right: Full email thread + Reply interface
↓
AI actions:
  - Generate Summary: Reads all emails, distinguishes speakers
  - Reply with AI: Auto-suggests response based on full thread
```

---

## Performance Impact

- **Reduced API load**: 50 → 20 emails per sync (60% reduction)
- **Better UX**: Full-page view vs modal
- **Faster navigation**: Direct links vs modal state management
- **Improved reliability**: Retry logic handles transient failures

---

## Future Enhancements

1. Add filtering/search within thread page
2. Add keyboard shortcuts for quick reply
3. Add draft auto-save
4. Add real-time sync status indicator
5. Add bulk actions (archive, mark read, etc.)
6. Add email templates quick-insert on thread page

---

## Database Schema Notes

Ensure these columns exist:
- `email_conversations.vehicle_full` (added in recent commit)
- `email_conversations.message_count`
- `email_conversations.unread_count`
- `customer_emails.conversation_id`
- `customer_emails.direction` ('inbound' or 'outbound')

---

## Environment Variables Required

```bash
ANTHROPIC_API_KEY=your_claude_api_key
VITE_API_URL=your_api_url (for frontend)
```
