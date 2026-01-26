# TFS Manager - Server

Backend server for TFS Wheels Manager application.

## Email Communications System

### Overview
Comprehensive email communications system for managing customer interactions, order communications, and automated responses using Zoho Mail and Claude AI.

---

## ✅ Phase 1: Backend Infrastructure (COMPLETED)

### 1.1 Zoho Mail Integration ✅
- **OAuth 2.0 Authentication** - Secure token management with auto-refresh
- **Email Sending** - HTML + plain text emails with signatures
- **Inbox Synchronization** - Automatic polling every 60 seconds
- **Account Management** - Multi-mailbox support (sales@, support@)
- **Deliverability Tracking** - Open/click tracking pixels and webhook endpoints

**Status**: ✅ Fully functional
- OAuth tokens refreshing automatically
- Inbox sync working for both sales@ and support@
- Email sending operational with signature injection
- Tracking infrastructure in place

**Files**:
- `/src/services/zohoMailEnhanced.js` - Zoho Mail API integration
- `/src/services/emailInboxSync.js` - Automatic inbox polling
- `/src/routes/zohoAuth.js` - OAuth authorization flow
- `/src/routes/webhooks.js` - Deliverability webhooks

---

### 1.2 Email Threading & Conversation Management ✅
- **RFC-compliant Threading** - Using Message-ID, In-Reply-To, References headers
- **Conversation Grouping** - Emails automatically grouped into threads
- **Order Association** - Emails linked to orders by customer email
- **Thread Summaries** - AI-powered summaries of email conversations

**Status**: ✅ Fully functional
- Emails correctly threaded
- Conversations persisted in database
- Order associations working

**Files**:
- `/src/services/emailThreading.js` - Threading logic and conversation management

---

### 1.3 AI-Powered Email Generation (Claude) ✅
- **Claude Opus 4 Integration** - Latest model with function calling
- **Brand Voice Customization** - Multiple voice profiles (friendly, professional, formal)
- **Context-Aware Responses** - Reads thread history before generating
- **Dynamic Placeholders** - Smart insertion of customer data, order details, vehicle info
- **Temperature Control** - Adjustable creativity (0.0-1.0)
- **Token Usage Tracking** - Cost monitoring per generation

**Status**: ✅ Fully functional
- AI generating high-quality, brand-appropriate responses
- Placeholder system working ({{customer_name}}, {{order_number}}, etc.)
- Thread-aware generation
- Cost: ~$0.026 per email generation

**API Endpoint**: `POST /api/emails/ai/generate`

**Example Request**:
```json
{
  "prompt": "Write a thank you email for a customer who just purchased wheels",
  "customerName": "John Doe",
  "conversationId": 123,
  "orderId": 456,
  "voiceName": "friendly"
}
```

**Files**:
- `/src/services/claudeAI.js` - Claude AI integration and prompt engineering
- `/src/routes/emails.js` - Email generation API endpoints

---

### 1.4 Database Schema ✅
- `email_conversations` - Thread/conversation records
- `customer_emails` - Individual email messages
- `ai_brand_voice` - Brand voice configurations
- `shop_settings` - Zoho OAuth tokens, AI settings
- `email_logs` - Deliverability tracking (opens, clicks, bounces)

**Status**: ✅ All tables created and operational

---

### 1.5 Email Templates & Placeholders ✅
**Dynamic Placeholder System**:
- `{{customer_name}}` / `{{customer_first_name}}`
- `{{order_number}}`
- `{{vehicle_full}}` / `{{vehicle_year}}`, `{{vehicle_make}}`, `{{vehicle_model}}`
- `{{wheel_brand}}`, `{{wheel_model}}`
- `{{tracking_number}}`

**Status**: ✅ Placeholder system functional in AI generation

**Reference Templates** (from TFS Wheels App):
- Order confirmation
- Vehicle information request
- Feedback request
- Auto-response (out of office, received confirmation)

**Next**: Port these to structured database templates

---

## 🚧 Phase 2: Frontend UI (IN PROGRESS)

### 2.1 Email Inbox Page 🔄
**Requirements**:
- [ ] List view of all customer emails (sales@tfswheels.com)
- [ ] Filter by: unread, order-related, customer, date range
- [ ] Search functionality
- [ ] Email preview pane
- [ ] Thread grouping/collapsing
- [ ] Order association badges (show linked order #)
- [ ] Unread count indicators

**Design Reference**: Similar to Gmail/Outlook inbox layout

**API Endpoints Needed**: Already exist
- `GET /api/emails/conversations` - List conversations
- `GET /api/emails/conversations/:id` - Get thread details
- `GET /api/emails/conversations/:id/messages` - Get all messages in thread

---

### 2.2 Email Composer / Reply Interface 🔄
**Requirements**:
- [ ] Rich text editor (TipTap or similar)
- [ ] HTML email formatting (bold, italic, lists, links)
- [ ] Signature insertion (automatic)
- [ ] Dynamic placeholder picker (dropdown to insert {{placeholders}})
- [ ] To/From/Subject fields
- [ ] CC/BCC support
- [ ] Thread reply vs new email mode

**Features**:
- [ ] **AI Response Generation Button**
  - Click to generate response
  - Show loading state
  - Insert generated content into editor
  - Allow editing before sending

- [ ] **Email Preview**
  - Preview button to see formatted email
  - Show how placeholders will render with actual customer data
  - Desktop/mobile preview toggle

- [ ] **Send Button**
  - Validate fields
  - Replace placeholders with actual values
  - Send via Zoho Mail API
  - Show success/error feedback

**API Endpoints Needed**: Already exist
- `POST /api/emails/ai/generate` - Generate AI response
- `POST /api/emails/send` - Send email via Zoho

---

### 2.3 Email Thread View 🔄
**Requirements**:
- [ ] Chronological message list (oldest to newest)
- [ ] Expand/collapse individual messages
- [ ] Show sender, timestamp, subject
- [ ] Render HTML email bodies safely
- [ ] Show attachments (if any)
- [ ] **AI Thread Summary** at top
  - Automatically generated summary of entire conversation
  - Shows: main topic, customer requests, our responses, status
  - Regenerate button
- [ ] Customer/Order info sidebar
  - Customer name, email, phone
  - Associated order(s) with links
  - Vehicle information
  - Purchase history

**API Endpoints Needed**: Already exist
- `GET /api/emails/conversations/:id/summary` - Get AI summary
- `POST /api/emails/conversations/:id/summary/regenerate` - Regenerate summary

---

### 2.4 AI Brand Voice Configuration Page 🔄
**Requirements**:
- [ ] List existing brand voices
- [ ] Create/edit/delete voice profiles
- [ ] Set default voice
- [ ] Configure per voice:
  - Name (e.g., "Friendly", "Professional", "Formal")
  - System prompt instructions
  - Tone keywords (words to use / avoid)
  - Formality level (casual → formal slider)
  - Example outputs
  - Active/inactive toggle

**Design**: Form-based with preview functionality

**API Endpoints Needed**: Need to create
- `GET /api/settings/brand-voices` - List voices
- `POST /api/settings/brand-voices` - Create voice
- `PUT /api/settings/brand-voices/:id` - Update voice
- `DELETE /api/settings/brand-voices/:id` - Delete voice
- `POST /api/settings/brand-voices/:id/test` - Test voice with sample email

---

### 2.5 Email Template Manager 🔄
**Requirements**:
- [ ] List of pre-built templates
  - Order Processing
  - Vehicle Information Request
  - Feedback Request
  - Auto-response (out of office)
  - Order Confirmation
  - Shipping Update
  - Delay/Issue Notification

- [ ] Template editor:
  - Subject line template
  - Body template (HTML + plain text)
  - Placeholder usage
  - Category/tags
  - Active/inactive toggle

- [ ] Template quick-select in composer
  - Dropdown to load template
  - Fills subject + body
  - User can edit before sending

**Database**: Need to create `email_templates` table

**API Endpoints Needed**: Need to create
- `GET /api/emails/templates` - List templates
- `GET /api/emails/templates/:id` - Get template
- `POST /api/emails/templates` - Create template
- `PUT /api/emails/templates/:id` - Update template
- `DELETE /api/emails/templates/:id` - Delete template

---

### 2.6 Deliverability Dashboard 📊
**Requirements**:
- [ ] Email stats overview
  - Total sent (today, week, month)
  - Open rate
  - Click rate
  - Bounce rate
  - Response rate

- [ ] Per-email tracking
  - Show if email was opened (timestamp)
  - Show if links were clicked (which links, when)
  - Show bounces/delivery failures

- [ ] Charts/graphs
  - Emails sent over time
  - Open rate trends
  - Response time metrics

**API Endpoints**: Already exist
- `GET /api/emails/stats` - Overall statistics
- `GET /api/emails/logs/:emailId` - Per-email tracking data

---

## 🎯 Phase 3: Advanced Features (PLANNED)

### 3.1 Automated Email Workflows
- [ ] Auto-response rules (trigger → action)
- [ ] Scheduled emails (send later)
- [ ] Email sequences (drip campaigns)
- [ ] Auto-follow-up (if no response after X days)

### 3.2 Customer Segments & Bulk Email
- [ ] Customer segmentation (by orders, vehicle, location)
- [ ] Bulk email sending to segments
- [ ] Unsubscribe management
- [ ] Compliance (CAN-SPAM, GDPR)

### 3.3 Email Performance Analytics
- [ ] A/B testing (subject lines, content)
- [ ] Best send time analysis
- [ ] Template performance comparison
- [ ] Customer engagement scoring

### 3.4 Integration Enhancements
- [ ] Shopify order sync (trigger emails on order events)
- [ ] Calendar integration (schedule calls/follow-ups)
- [ ] CRM features (notes, tags, customer timeline)

---

## 📋 Implementation Checklist

### Immediate Next Steps (Priority Order)

1. **Email Inbox Page** (Frontend)
   - [ ] Create `/emails` route in Next.js app
   - [ ] Build conversation list component
   - [ ] Add filtering/search UI
   - [ ] Implement pagination
   - [ ] Connect to existing API endpoints

2. **Email Thread View** (Frontend)
   - [ ] Thread detail page at `/emails/:conversationId`
   - [ ] Message list component
   - [ ] AI summary display
   - [ ] Customer info sidebar
   - [ ] Connect to existing APIs

3. **Email Composer** (Frontend)
   - [ ] Rich text editor integration (TipTap)
   - [ ] Placeholder picker component
   - [ ] AI generation button with loading state
   - [ ] Preview modal
   - [ ] Send functionality

4. **Email Templates** (Backend + Frontend)
   - [ ] Create `email_templates` table migration
   - [ ] Build template CRUD API endpoints
   - [ ] Create template manager UI
   - [ ] Integrate template selection into composer

5. **Brand Voice Configuration** (Frontend)
   - [ ] Brand voice management UI
   - [ ] Voice editor form
   - [ ] Test/preview functionality
   - [ ] Connect to existing brand_voice APIs

6. **Deliverability Dashboard** (Frontend)
   - [ ] Stats overview cards
   - [ ] Charts integration (Chart.js or Recharts)
   - [ ] Per-email tracking display
   - [ ] Connect to existing tracking APIs

---

## 🔧 Current System Status

### ✅ Working Components
- Zoho OAuth and token management
- Email sending via Zoho Mail API
- Inbox synchronization (sales@ and support@)
- Email threading and conversation grouping
- AI email generation with Claude Opus 4
- Brand voice customization (backend)
- Dynamic placeholder system
- Thread summaries (backend)
- Deliverability tracking infrastructure

### ⚠️ Known Issues
1. **sales@ inbox**: Occasional 500 errors from Zoho API (likely rate limiting)
   - Mitigation: Graceful error handling, retry logic
2. **Email detail fetching**: Some messages fail to fetch full details
   - Mitigation: Fallback to basic email info from list
3. **Webhook setup**: Manual configuration needed in Zoho dashboard
   - Status: Polling working fine as alternative

### 🚀 Performance Metrics
- **AI Generation**: ~$0.026 per email (~630 tokens)
- **Inbox Sync**: Every 60 seconds, <1s per sync
- **Email Sending**: <500ms per email
- **Database**: All queries optimized with indexes

---

## 🛠️ Development Guide

### Running Locally
```bash
# Install dependencies
npm install

# Set up environment variables (see RAILWAY_ENV.txt)
cp RAILWAY_ENV.txt .env

# Run migrations
npm run migrate

# Start development server
npm run dev
```

### Testing AI Generation
```bash
curl -X POST http://localhost:3000/api/emails/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a thank you email",
    "customerName": "John Doe",
    "orderId": 123
  }'
```

### Testing Email Sending
```bash
curl -X POST http://localhost:3000/api/emails/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "customer@example.com",
    "subject": "Thank you!",
    "bodyHtml": "<p>Thanks for your order!</p>",
    "bodyText": "Thanks for your order!"
  }'
```

---

## 📚 API Documentation

### Email Generation
**POST** `/api/emails/ai/generate`

Generate AI-powered email response using Claude.

**Request Body**:
```json
{
  "prompt": "Write a thank you email for a wheel purchase",
  "conversationId": 123,  // Optional - for thread context
  "orderId": 456,         // Optional - for order data
  "customerData": {       // Optional - customer info
    "customer_name": "John Doe",
    "customer_email": "john@example.com",
    "vehicle_full": "2020 Toyota Camry"
  },
  "voiceName": "friendly", // Optional - default uses shop default
  "temperature": 0.7       // Optional - creativity level (0.0-1.0)
}
```

**Response**:
```json
{
  "success": true,
  "content": "Generated email content with {{placeholders}}...",
  "metadata": {
    "model": "claude-opus-4-20250514",
    "brand_voice": "friendly",
    "tokens_used": 630,
    "cost_usd": 0.0264,
    "thread_length": 5
  }
}
```

---

### Send Email
**POST** `/api/emails/send`

Send email via Zoho Mail.

**Request Body**:
```json
{
  "to": "customer@example.com",
  "toName": "John Doe",       // Optional
  "subject": "Thank you for your order!",
  "bodyHtml": "<p>Thank you...</p>",
  "bodyText": "Thank you...", // Optional - fallback
  "fromAddress": "sales@tfswheels.com", // Optional - default sales@
  "cc": ["manager@tfswheels.com"],      // Optional
  "inReplyTo": "<message-id>",          // Optional - for threading
  "references": "<message-id-1> <message-id-2>" // Optional
}
```

**Response**:
```json
{
  "success": true,
  "messageId": "1769189011074116300",
  "tracked": true  // If tracking pixel added
}
```

---

### List Conversations
**GET** `/api/emails/conversations`

List email conversations/threads.

**Query Parameters**:
- `limit` (number) - Results per page (default: 50)
- `offset` (number) - Pagination offset (default: 0)
- `unreadOnly` (boolean) - Show only unread
- `customerId` (number) - Filter by customer
- `orderId` (number) - Filter by order

**Response**:
```json
{
  "success": true,
  "conversations": [
    {
      "id": 123,
      "subject": "Question about wheel fitment",
      "last_message_at": "2026-01-26T12:00:00Z",
      "message_count": 5,
      "unread_count": 2,
      "customer_id": 456,
      "customer_name": "John Doe",
      "customer_email": "john@example.com",
      "order_id": 789,
      "ai_summary": "Customer asking about wheel fitment for 2020 Camry..."
    }
  ],
  "total": 150
}
```

---

### Get Thread Details
**GET** `/api/emails/conversations/:id`

Get full conversation thread with all messages.

**Response**:
```json
{
  "success": true,
  "conversation": {
    "id": 123,
    "subject": "Question about wheel fitment",
    "created_at": "2026-01-20T10:00:00Z",
    "last_message_at": "2026-01-26T12:00:00Z",
    "customer": {
      "id": 456,
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890"
    },
    "order": {
      "id": 789,
      "order_number": "#1001",
      "products": [...],
      "vehicle": {
        "year": 2020,
        "make": "Toyota",
        "model": "Camry"
      }
    },
    "ai_summary": "Customer asking about wheel fitment...",
    "messages": [
      {
        "id": 1,
        "direction": "inbound",
        "from_email": "john@example.com",
        "from_name": "John Doe",
        "subject": "Question about wheel fitment",
        "body_text": "Hi, I have a question...",
        "body_html": "<p>Hi, I have a question...</p>",
        "received_at": "2026-01-20T10:00:00Z",
        "is_read": true
      },
      {
        "id": 2,
        "direction": "outbound",
        "from_email": "sales@tfswheels.com",
        "from_name": "TFS Wheels",
        "subject": "Re: Question about wheel fitment",
        "body_html": "<p>Thanks for reaching out...</p>",
        "sent_at": "2026-01-20T11:00:00Z",
        "opened_at": "2026-01-20T11:05:00Z",
        "clicked_at": "2026-01-20T11:06:00Z"
      }
    ]
  }
}
```

---

## 🔐 Environment Variables

See `RAILWAY_ENV.txt` for full list. Key variables for email system:

```bash
# Zoho Mail API
ZOHO_CLIENT_ID=1000.xxx
ZOHO_CLIENT_SECRET=xxx
# Note: Refresh tokens stored in database per shop

# Claude AI
ANTHROPIC_API_KEY=sk-ant-api03-xxx

# Application URLs
APP_URL=https://tfs-manager-server-production.up.railway.app
FRONTEND_URL=https://tfs-manager-admin.vercel.app
```

---

## 📝 Notes

### Zoho Mail API Quirks
1. Account IDs must be hardcoded (API only returns authenticated account)
2. Use `/messages/search` endpoint, not `/messages` directly
3. Folder ID `1` = Inbox
4. Rate limiting: ~100 requests per minute

### Claude AI Best Practices
1. Always include thread context for better responses
2. Use temperature 0.7 for balanced creativity
3. Limit prompt to 1000 chars for cost efficiency
4. Cache customer data to avoid repeated API calls

### Email Threading
1. Always set `In-Reply-To` and `References` headers
2. Use Zoho's `messageId` as canonical identifier
3. Subject line matching as fallback (normalize: remove Re:, Fwd:)

---

## 🤝 Contributing

When adding new email features:
1. Update this README with new endpoints/features
2. Add API documentation
3. Update checklist status
4. Test with real Zoho account

---

## 📞 Support

For issues or questions:
- **Zoho Setup**: Check `/auth/zoho/authorize` for OAuth
- **AI Generation**: Verify `ANTHROPIC_API_KEY` in Railway
- **Inbox Sync**: Check Railway logs for sync status
- **Database**: Run migrations if schema is out of date

---

Last Updated: 2026-01-26
