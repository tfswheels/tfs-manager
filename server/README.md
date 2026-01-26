# TFS Manager - Server

Backend server for TFS Wheels Manager application.

## Recent Fixes (Jan 2026)

### MySQL 8.0 Compatibility ✅
- **Fixed**: LIMIT/OFFSET parameter binding issue (errno 1210)
- **Fixed**: Reserved keyword `read` escaping in stats queries
- **Fixed**: Missing `vehicle_full` column references
- **Impact**: All email conversation queries now work correctly with MySQL 8.0.31
- **Testing**: All queries validated against production database before deployment

### Customer Emails UI ✅
- **Fixed**: Order column now shows order number (#62423844) instead of database ID
- **Fixed**: Order navigation - clicking order number navigates to order detail page
- **Fixed**: Navigation highlighting - only active page highlighted (not multiple)
- **Impact**: Fully functional email inbox with proper order linking

---

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

## 📋 Email Filtering Rules

### Inbox Filtering Logic:
- **sales@tfswheels.com**: ALL customer emails are synced and displayed (no filtering)
  - Purpose: Main customer communication channel
  - All inquiries, questions, and general communication
  - Shows all emails regardless of order association

- **support@tfswheels.com**: ONLY emails from customers with existing orders
  - Purpose: Order-specific support
  - Automatically linked to customer's order(s)
  - Emails from non-customers are skipped during sync

**Implementation**: `src/services/emailInboxSync.js` (lines 54-70)

---

## ✅ Phase 2: Frontend UI (COMPLETED)

### 2.1 Email Inbox Page ✅
**Created**: `admin/src/pages/CustomerEmails.jsx`

**Features Implemented**:
- ✅ Conversation-based list view (not individual emails)
- ✅ Message count badges (shows "3 messages, 1 new")
- ✅ Unread count indicators
- ✅ Stats cards (Total, Unread, Replied)
- ✅ "New Email" button for composing
- ✅ Conversation click opens full thread view
- ✅ Tab filtering (All, Unread, Read, Replied, Archived)
- ✅ Pagination

**API Endpoints Used**:
- `GET /api/emails/conversations` - List conversations
- `GET /api/emails/stats` - Stats for dashboard cards

---

### 2.2 Email Composer ✅
**Created**: `admin/src/components/EmailComposer.jsx`

**Features Implemented**:
- ✅ **AI Email Generation** - One-click Claude-powered writing
- ✅ **Dynamic Placeholder Picker** - Dropdown to insert {{customer_name}}, {{order_number}}, etc.
- ✅ **Cost Display** - Shows AI generation cost (~$0.03)
- ✅ **Reply Threading** - Automatically handles "Re:" subjects and In-Reply-To headers
- ✅ **Success/Error Feedback** - User-friendly status messages
- ✅ **Original Message Display** - Shows context when replying

**AI Generation Flow**:
1. User clicks "Generate with AI"
2. Enters prompt: "Thank customer and offer discount"
3. Claude generates professional email with placeholders
4. User reviews/edits
5. One-click send

**API Endpoints Used**:
- `POST /api/emails/ai/generate` - Generate AI response
- `POST /api/emails/send` - Send email via Zoho

---

### 2.3 Email Thread View ✅
**Created**: `admin/src/components/EmailThreadView.jsx`

**Features Implemented**:
- ✅ **AI Thread Summary** - Shows AI-generated summary with "Regenerate" button
- ✅ **Chronological Message History** - All messages in thread
- ✅ **Customer/Order Sidebar** - Shows customer details, order info, vehicle
- ✅ **Direction Badges** - "From Customer" vs "From Us"
- ✅ **Deliverability Tracking** - Shows "Opened" and "Link Clicked" status
- ✅ **Inline Reply** - Opens composer with full context

**API Endpoints Used**:
- `GET /api/emails/conversations/:id` - Get full thread
- `POST /api/emails/conversations/:id/summary` - Generate/regenerate summary

---

## 🚧 Phase 2 (Continued): Frontend UI (IN PROGRESS)

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

## 🎫 Phase 4: Ticketing System (PLANNED)

### Overview
Transform the email system into a full-fledged ticketing system for customer support. Every email conversation becomes a ticket with status tracking, auto-responses, and workflow automation.

---

### 4.1 Ticket Status Management

**Ticket States**:
- **Open** - New email received, awaiting response
- **Pending** - Waiting for customer reply (we responded)
- **Resolved** - Issue resolved, ticket closed
- **Closed** - Manually closed (no response needed)

**Status Transitions**:
```
New Email → Open
   ↓
We Reply → Pending
   ↓
Customer Replies → Open
   ↓
We Resolve → Resolved
   ↓
Time Passes (X days) → Closed

Manual Close → Closed (any state)
```

**Database Changes Needed**:
```sql
ALTER TABLE email_conversations ADD COLUMN ticket_status ENUM('open', 'pending', 'resolved', 'closed') DEFAULT 'open';
ALTER TABLE email_conversations ADD COLUMN ticket_number VARCHAR(20) UNIQUE; -- e.g., TICK-1234
ALTER TABLE email_conversations ADD COLUMN priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium';
ALTER TABLE email_conversations ADD COLUMN assigned_to INT NULL; -- user_id
ALTER TABLE email_conversations ADD COLUMN last_reply_at DATETIME;
ALTER TABLE email_conversations ADD COLUMN last_reply_from ENUM('customer', 'agent');
ALTER TABLE email_conversations ADD COLUMN resolved_at DATETIME NULL;
ALTER TABLE email_conversations ADD COLUMN closed_at DATETIME NULL;
```

**Implementation Files**:
- `src/services/ticketSystem.js` - Ticket status management
- `src/routes/tickets.js` - Ticket API endpoints

---

### 4.2 Auto-Response System

**Trigger Conditions**:
1. **New Ticket Created** (first email from customer)
   - Send: "We received your message and will respond within 24 hours"

2. **Outside Business Hours**
   - Business Hours: Mon-Fri 9am-6pm EST
   - Send: "Thanks for contacting us! We're currently out of office..."

3. **Ticket Resolved**
   - Send: "Your issue has been resolved. Reply if you need further help."

4. **No Response Auto-Close** (X days after last reply)
   - If customer doesn't respond in 7 days → auto-close
   - Send: "We haven't heard from you. Closing this ticket..."

**Auto-Response Configuration**:
```javascript
{
  name: "New Ticket Received",
  trigger: "ticket_created",
  enabled: true,
  delay: 0, // Send immediately
  template: "auto-response-received",
  conditions: {
    firstEmail: true
  }
}
```

**Database Schema**:
```sql
CREATE TABLE auto_response_rules (
  id INT PRIMARY KEY AUTO_INCREMENT,
  shop_id INT NOT NULL,
  name VARCHAR(255),
  trigger_type ENUM('ticket_created', 'outside_hours', 'ticket_resolved', 'no_response_autoclose'),
  enabled BOOLEAN DEFAULT TRUE,
  template_id INT NULL,
  delay_minutes INT DEFAULT 0,
  conditions JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Implementation Files**:
- `src/services/autoResponse.js` - Auto-response logic
- `src/workers/autoResponseWorker.js` - Background job for checking triggers
- `src/routes/autoResponses.js` - API for managing rules

---

### 4.3 Ticket Dashboard & Metrics

**Dashboard Widgets**:
1. **Open Tickets** - Count of unresolved tickets
2. **Average Response Time** - How long to first reply
3. **Average Resolution Time** - How long to close ticket
4. **Tickets by Priority** - Breakdown by low/medium/high/urgent
5. **Tickets by Status** - Open vs Pending vs Resolved
6. **Unanswered Tickets** - Tickets with no agent reply yet
7. **SLA Breaches** - Tickets exceeding response time targets

**Metrics Calculations**:
```javascript
// Response Time: Time from ticket creation to first agent reply
responseTime = first_agent_reply_at - created_at

// Resolution Time: Time from ticket creation to resolution
resolutionTime = resolved_at - created_at

// SLA Breach: Tickets older than X hours without reply
slaBreach = (NOW() - created_at) > sla_target_hours
```

**Database Views**:
```sql
CREATE VIEW ticket_metrics AS
SELECT
  shop_id,
  COUNT(*) as total_tickets,
  SUM(CASE WHEN ticket_status = 'open' THEN 1 ELSE 0 END) as open_tickets,
  SUM(CASE WHEN ticket_status = 'pending' THEN 1 ELSE 0 END) as pending_tickets,
  AVG(TIMESTAMPDIFF(MINUTE, created_at, first_reply_at)) as avg_response_minutes,
  AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) as avg_resolution_minutes
FROM email_conversations
GROUP BY shop_id;
```

**UI Component**:
- `admin/src/pages/TicketsDashboard.jsx` - Dashboard with metrics
- `admin/src/components/TicketMetrics.jsx` - Metric cards

---

### 4.4 Ticket Actions & Workflow

**Manual Actions**:
- **Assign to Me/Someone** - Assign ticket to agent
- **Change Priority** - Set to low/medium/high/urgent
- **Mark as Resolved** - Close ticket
- **Reopen Ticket** - Change resolved → open
- **Add Internal Note** - Private note (not sent to customer)
- **Merge Tickets** - Combine duplicate tickets
- **Split Thread** - Create new ticket from message

**Automated Actions**:
- **Auto-Assign by Keywords** - Route to specific agent
  - "refund" → assign to manager
  - "tracking" → assign to shipping team
- **Auto-Priority by Keywords** - Escalate important issues
  - "urgent", "broken", "asap" → high priority
- **Auto-Close Stale Tickets** - Close after X days no response
- **Auto-Escalate Old Tickets** - Escalate if no response in Y hours

**Database Schema**:
```sql
CREATE TABLE ticket_actions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  action_type ENUM('assigned', 'priority_changed', 'status_changed', 'note_added', 'merged'),
  performed_by INT NULL, -- user_id or NULL for system
  from_value VARCHAR(255),
  to_value VARCHAR(255),
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_notes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  note TEXT,
  is_internal BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Implementation Files**:
- `src/services/ticketActions.js` - Ticket action handlers
- `src/routes/ticketActions.js` - API endpoints
- `admin/src/components/TicketActions.jsx` - Action buttons UI

---

### 4.5 UI Enhancements for Ticket System

**Inbox Changes**:
- Replace "Status" column with "Ticket Status" (Open/Pending/Resolved/Closed)
- Add "Ticket #" column (TICK-1234)
- Add "Priority" badges (color-coded)
- Add "Assigned To" column
- Filter by ticket status, priority, assigned agent
- Sort by "Oldest First" (longest unanswered)

**Thread View Changes**:
- Add ticket header with:
  - Ticket number
  - Priority selector (dropdown)
  - Status selector (dropdown)
  - Assign button
  - "Mark as Resolved" button
  - "Add Internal Note" button
- Show ticket timeline:
  - When created
  - When first replied
  - When resolved
  - All status changes
- Show SLA timer (e.g., "Respond within: 2 hours 15 mins")

**New Pages**:
- `/tickets` - Main ticket inbox (replaces `/emails`)
- `/tickets/dashboard` - Metrics dashboard
- `/tickets/settings` - Auto-response rules, SLA targets

---

### 4.6 Implementation Roadmap

**Phase 4.1: Core Ticket Status** (1-2 days)
1. Add ticket fields to database (ticket_status, ticket_number, priority, etc.)
2. Create ticket status management service
3. Update inbox UI to show ticket status
4. Add status change actions (mark resolved, reopen)

**Phase 4.2: Auto-Response System** (2-3 days)
1. Create auto_response_rules table
2. Build auto-response trigger system
3. Implement "New Ticket" auto-response
4. Implement "Outside Hours" auto-response
5. Build UI for managing auto-response rules

**Phase 4.3: Ticket Dashboard** (1-2 days)
1. Build ticket metrics calculations
2. Create dashboard with stats cards
3. Add charts (tickets over time, by status, by priority)
4. Add filters (date range, agent, priority)

**Phase 4.4: Advanced Ticket Actions** (2-3 days)
1. Build ticket assignment system
2. Add priority management
3. Implement internal notes
4. Build ticket merge/split functionality
5. Add automated actions (auto-assign, auto-priority, auto-close)

**Phase 4.5: SLA & Escalation** (1-2 days)
1. Add SLA target configuration
2. Build SLA breach detection
3. Add escalation rules
4. Create SLA timer UI component

**Total Estimated Time: 7-12 days**

---

### 4.7 API Endpoints for Ticket System

**Ticket Management**:
```
GET    /api/tickets                - List all tickets
GET    /api/tickets/:id            - Get ticket details
PATCH  /api/tickets/:id/status     - Change ticket status
PATCH  /api/tickets/:id/priority   - Change priority
PATCH  /api/tickets/:id/assign     - Assign ticket
POST   /api/tickets/:id/notes      - Add internal note
POST   /api/tickets/:id/merge      - Merge with another ticket
```

**Ticket Dashboard**:
```
GET    /api/tickets/metrics        - Get dashboard metrics
GET    /api/tickets/stats          - Get ticket statistics
GET    /api/tickets/sla-breaches   - List SLA breaches
```

**Auto-Response Management**:
```
GET    /api/auto-responses         - List auto-response rules
POST   /api/auto-responses         - Create auto-response rule
PUT    /api/auto-responses/:id     - Update rule
DELETE /api/auto-responses/:id     - Delete rule
POST   /api/auto-responses/:id/test - Test rule
```

**Ticket Actions**:
```
GET    /api/tickets/:id/actions    - Get action history
GET    /api/tickets/:id/notes      - Get internal notes
POST   /api/tickets/:id/reopen     - Reopen closed ticket
POST   /api/tickets/:id/resolve    - Mark as resolved
```

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
