# TFS Manager Support Ticketing System - Complete Overhaul
## Comprehensive Implementation Plan

**Version:** 2.0
**Date:** 2026-01-30
**Status:** ✅ Planning Complete - Ready for Implementation

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [New System Architecture](#new-system-architecture)
4. [Database Schema](#database-schema)
5. [Backend API Design](#backend-api-design)
6. [Frontend Architecture](#frontend-architecture)
7. [Automation Engine](#automation-engine)
8. [Settings & Customization](#settings--customization)
9. [Implementation Phases](#implementation-phases)
10. [Critical Preservation Rules](#critical-preservation-rules)

---

## 🎯 Executive Summary

The TFS Manager support ticketing system is being overhauled to transform the existing email management system into a comprehensive, enterprise-grade support ticket platform with full automation, staff management, and customizable workflows.

### Goals

✅ **Transform** email conversations into full-featured support tickets
✅ **Automate** customer engagement with smart reminders and escalation
✅ **Empower** staff with role-based assignments and activity tracking
✅ **Customize** every aspect via a comprehensive settings interface
✅ **Preserve** all existing functionality (EmailThread.jsx, inline images, threading)
✅ **Scale** for potential multi-shop deployment in the future

### Key Features

- **Ticket Lifecycle Management:** Open → Assigned → In Progress → Pending Customer → Closed
- **Intelligent Auto-Tagging:** Customer, Potential Customer, Visitor (based on Shopify data)
- **Smart Priority Assignment:** High, Normal, Low (based on customer type)
- **Automated Reminders:** Configurable 24-hour reminders for pending tickets
- **Auto-Close After 3 Reminders:** Automatic ticket closure with customer notification
- **Staff Assignment & Tracking:** Multi-staff support with default assignment rules
- **SLA Monitoring:** Track first response time and resolution time
- **Business Hours Management:** Configurable hours with different auto-responses
- **Canned Responses:** Quick reply templates for common scenarios
- **Email Customization:** Custom footers with logo, social links, close ticket links
- **Comprehensive Settings:** Per-shop configuration for all features

---

## 📊 Implementation Progress Tracker

### Overall Status: **Phase 1 Complete ✅**

| Phase | Task | Implemented | Tested | Notes |
|-------|------|:-----------:|:------:|-------|
| **PHASE 1: Database & Backend** | | | | **✅ COMPLETE** |
| 1.1 | Database Migration 014 | ✅ | ✅ | 6 tables + 4 columns created |
| 1.2 | settingsManager.js service | ✅ | ✅ | All CRUD operations working |
| 1.3 | autoTagging.js service | ✅ | ✅ | Shopify GraphQL integration |
| 1.4 | automationScheduler.js service | ✅ | ✅ | 4 cron jobs configured |
| 1.5 | /api/settings/* routes | ✅ | ✅ | All endpoints working |
| 1.6 | /api/canned-responses/* routes | ✅ | ✅ | CRUD + usage tracking |
| 1.7 | /api/automation/* routes | ✅ | ✅ | Manual triggers working |
| 1.8 | Customer close ticket webhook | ✅ | ✅ | Secure tokens + HTML pages |
| 1.9 | Auto-tag integration in emailThreading | ✅ | ✅ | Auto-response working |
| 1.10 | Server integration & deployment | ✅ | ✅ | Deployed to Railway |
| **PHASE 2: Settings Frontend** | | | | **🔄 PENDING** |
| 2.1 | Create /tickets route structure | ⬜ | ⬜ | Nested routing setup |
| 2.2 | TicketSettings.jsx main page | ⬜ | ⬜ | 9 subsections container |
| 2.3 | Settings: General & Automation | ⬜ | ⬜ | Auto-response toggles |
| 2.4 | Settings: Business Hours | ⬜ | ⬜ | 7-day schedule editor |
| 2.5 | Settings: Email Templates | ⬜ | ⬜ | 6 template editors |
| 2.6 | Settings: Email Footer | ⬜ | ⬜ | Logo upload + social links |
| 2.7 | Settings: SLA & Escalation | ⬜ | ⬜ | Hour inputs + toggles |
| 2.8 | Settings: Assignment Rules | ⬜ | ⬜ | Default assignee picker |
| 2.9 | Settings: Notifications | ⬜ | ⬜ | Email notification toggles |
| **PHASE 3A: Staff & Canned Responses** | | | | **🔄 PENDING** |
| 3A.1 | StaffManagement.jsx page | ⬜ | ⬜ | Staff list + stats |
| 3A.2 | Staff assignment UI | ⬜ | ⬜ | Drag-and-drop assignment |
| 3A.3 | CannedResponses.jsx page | ⬜ | ⬜ | Template list + CRUD |
| 3A.4 | Canned response editor | ⬜ | ⬜ | Rich text editor |
| 3A.5 | Shortcut insertion UI | ⬜ | ⬜ | /shortcut autocomplete |
| 3A.6 | Usage stats tracking | ⬜ | ⬜ | Most-used templates |
| **PHASE 3B: Enhanced Dashboard** | | | | **🔄 PENDING** |
| 3B.1 | TicketDashboard.jsx page | ⬜ | ⬜ | Replace SupportTickets.jsx |
| 3B.2 | Enhanced filters | ⬜ | ⬜ | Tags, priority, date range |
| 3B.3 | Ticket stats cards | ⬜ | ⬜ | Open, pending, SLA breach |
| 3B.4 | Bulk actions UI | ⬜ | ⬜ | Assign, tag, close, archive |
| 3B.5 | Auto-tag display | ⬜ | ⬜ | Show tags in ticket list |
| 3B.6 | SLA indicators | ⬜ | ⬜ | Red/yellow/green badges |
| **PHASE 3C: EmailThread Enhancements** | | | | **🔄 PENDING** |
| 3C.1 | Ticket sidebar improvements | ⬜ | ⬜ | Show automation history |
| 3C.2 | Close ticket link display | ⬜ | ⬜ | Show in email footer |
| 3C.3 | Canned response picker | ⬜ | ⬜ | Insert button in editor |
| 3C.4 | Activity timeline | ⬜ | ⬜ | Show reminders, escalations |
| 3C.5 | Auto-response preview | ⬜ | ⬜ | Preview before send |
| **PHASE 4: Testing & Polish** | | | | **🔄 PENDING** |
| 4.1 | End-to-end automation testing | ⬜ | ⬜ | Test all 4 cron jobs |
| 4.2 | Customer journey testing | ⬜ | ⬜ | Email → ticket → close |
| 4.3 | Staff workflow testing | ⬜ | ⬜ | Assign → reply → resolve |
| 4.4 | Settings persistence testing | ⬜ | ⬜ | All 9 settings sections |
| 4.5 | Mobile responsiveness | ⬜ | ⬜ | Test on mobile devices |
| 4.6 | Performance optimization | ⬜ | ⬜ | Load time, query optimization |
| 4.7 | Documentation update | ⬜ | ⬜ | User guide + API docs |

**Legend:**
- ✅ = Complete and tested
- ⬜ = Not started
- 🔄 = In progress
- ⚠️ = Blocked/needs attention

**Last Updated:** 2026-01-31 (Phase 1 deployment)

---

## 🔍 Current State Analysis

### Existing Infrastructure (Migration 012 Complete)

Our current database already includes robust ticketing infrastructure from migration 012:

#### ✅ Core Tables (Already Exist)

**`email_conversations`** - The ticket table
- Fields: `id`, `ticket_number`, `shop_id`, `order_id`, `thread_id`, `subject`, `customer_email`, `customer_name`, `participants`, `status`, `priority`, `category`, `assigned_to`, `last_reply_by`, `first_response_at`, `resolution_time`, `message_count`, `unread_count`, `tags`, `is_merged`, `merged_into`, `ai_summary`
- Status values: `open`, `assigned`, `in_progress`, `pending_customer`, `resolved`, `closed`, `archived`
- Foreign keys: Links to shops, orders, staff_users

**`staff_users`** - Shopify staff management
- Fields: `id`, `shop_id`, `shopify_staff_id`, `email`, `first_name`, `last_name`, `full_name`, `role`, `is_active`, `total_tickets_handled`, `avg_response_time_minutes`
- Synced from Shopify automatically

**`ticket_activities`** - Complete audit trail
- Fields: `id`, `conversation_id`, `staff_id`, `action_type`, `from_value`, `to_value`, `note`, `metadata`, `email_id`
- Action types: `status_change`, `reply`, `assignment`, `note`, `tag_add`, `tag_remove`, `priority_change`, `merge`, `link_order`

**`customer_emails`** - Email messages
- Fields: `id`, `conversation_id`, `zoho_message_id`, `direction`, `from_email`, `to_email`, `subject`, `body_html`, `body_text`, `staff_id`, `is_internal_note`, `has_attachments`

**`email_attachments`** - Files and inline images
- Fields: `id`, `email_id`, `filename`, `file_path`, `is_inline`, `content_id`, `zoho_message_id` (for re-download)

**`email_templates`** - Email templates
- Fields: `id`, `shop_id`, `name`, `subject`, `body`, `template_type`, `category`, `is_active`

#### ✅ Existing Services (Working in Production)

- **emailInboxSync.js** - Polls Zoho every 1 minute, syncs emails
- **emailThreading.js** - Thread management (threadId, In-Reply-To, References, subject fallback)
- **zohoMailEnhanced.js** - Zoho OAuth, send email, download attachments/inline images
- **ticketActivities.js** - Log all ticket actions
- **claudeAI.js** - AI-powered email generation and summaries

#### ✅ Existing Frontend (Working in Production)

- **SupportTickets.jsx** - Dashboard with tabs, search, bulk actions
- **EmailThread.jsx** - **CRITICAL: DO NOT MODIFY** - Email thread view with:
  - Inline image processing (`processInlineImages()`)
  - AI reply generation
  - Rich text editor (TipTap)
  - Attachment upload/download
  - Order/customer context sidebar

### ⚠️ What's Missing (To Be Implemented)

❌ **Automation Engine**
- No automated reminders for pending_customer status
- No auto-escalation for unresponded tickets
- No auto-close after 3 reminders
- No scheduled jobs infrastructure

❌ **Settings Management**
- No settings table or UI
- No business hours configuration
- No customizable auto-response templates
- No email footer customization

❌ **Enhanced Staff Management**
- No default assignment configuration
- No staff notification system
- No staff performance tracking UI

❌ **Canned Responses**
- No quick reply templates
- No template categories or shortcuts

❌ **Auto-Tagging & Priority**
- Tags exist but not auto-assigned based on Shopify data
- Priority exists but not auto-set based on customer type

❌ **Customer Close Ticket Link**
- No public endpoint for customers to close tickets
- No close confirmation emails

❌ **Nested Frontend Structure**
- Current structure: `/tickets` → SupportTickets.jsx, `/tickets/:id` → EmailThread.jsx
- Needed structure: `/tickets/dashboard`, `/tickets/staff`, `/tickets/settings`, etc.

---

## 🏗️ New System Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Vercel)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Dashboard   │  │    Staff     │  │   Reports    │          │
│  │   (Main)     │  │ Management   │  │  Analytics   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────────────────────────┐    │
│  │  Settings    │  │    EmailThread.jsx (PRESERVED)       │    │
│  │ (All Config) │  │    - Inline images                   │    │
│  └──────────────┘  │    - Rich text editor                │    │
│                    │    - AI generation                    │    │
│                    └──────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API (Railway)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    REST API Routes                       │   │
│  │                                                          │   │
│  │  /api/tickets/*        - Ticket CRUD & bulk actions     │   │
│  │  /api/staff/*          - Staff management               │   │
│  │  /api/settings/*       - All settings CRUD              │   │
│  │  /api/canned-responses/* - Quick reply templates        │   │
│  │  /api/automation/*     - Manual trigger automation      │   │
│  │  /api/webhooks/close-ticket/:id/:token - Customer close │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Background Services                     │   │
│  │                                                          │   │
│  │  emailInboxSync.js     - Zoho polling (1 min)           │   │
│  │  automationScheduler.js - Cron jobs (NEW)               │   │
│  │    ├─ Pending reminders (daily @ 10am EST)              │   │
│  │    ├─ Auto-escalation (every 15 min)                    │   │
│  │    ├─ Auto-close (daily @ 10am EST)                     │   │
│  │    └─ SLA monitoring (every 5 min)                      │   │
│  │                                                          │   │
│  │  autoTagging.js        - Shopify data lookup (NEW)      │   │
│  │  settingsManager.js    - Settings CRUD service (NEW)    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              DATABASE (Google Cloud MySQL 8.4)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EXISTING TABLES (From Migration 012):                         │
│  ├─ email_conversations (tickets)                              │
│  ├─ staff_users                                                │
│  ├─ ticket_activities                                          │
│  ├─ customer_emails                                            │
│  ├─ email_attachments                                          │
│  └─ email_templates                                            │
│                                                                 │
│  NEW TABLES (Migration 014):                                   │
│  ├─ ticket_settings (per-shop configuration)                   │
│  ├─ business_hours (Mon-Sun schedules)                         │
│  ├─ canned_responses (quick replies)                           │
│  ├─ email_footer_settings (logo, social links)                 │
│  ├─ ticket_reminders (track pending_customer reminders)        │
│  └─ close_ticket_tokens (secure customer close links)          │
│                                                                 │
│  EXTENDED TABLES (ALTER existing):                             │
│  └─ email_conversations:                                       │
│      └─ ADD reminder_count, last_reminder_at, is_escalated    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  EXTERNAL INTEGRATIONS                          │
├─────────────────────────────────────────────────────────────────┤
│  - Zoho Mail API (OAuth)                                       │
│  - Shopify Admin API (customer/cart/order lookup)              │
│  - Claude API (AI generation)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema

### Migration 014: Ticketing System Overhaul

#### NEW TABLE: `ticket_settings`

Stores per-shop configuration for all ticketing features.

```sql
CREATE TABLE ticket_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT NOT NULL,

  -- Auto-Response Settings
  auto_response_enabled BOOLEAN DEFAULT TRUE COMMENT 'Enable/disable auto-responses',
  auto_response_business_hours TEXT COMMENT 'Auto-response template during business hours',
  auto_response_after_hours TEXT COMMENT 'Auto-response template outside business hours',
  auto_response_delay_minutes INT DEFAULT 5 COMMENT 'Minutes to wait before sending auto-response',

  -- Pending Customer Reminder Settings
  pending_reminder_enabled BOOLEAN DEFAULT TRUE COMMENT 'Enable 24-hour reminders',
  pending_reminder_send_time TIME DEFAULT '10:00:00' COMMENT 'Daily send time (EST)',
  pending_reminder_template_1 TEXT COMMENT '1st reminder template',
  pending_reminder_template_2 TEXT COMMENT '2nd reminder template',
  pending_reminder_template_3 TEXT COMMENT '3rd reminder template',
  pending_reminder_max_count INT DEFAULT 3 COMMENT 'Max reminders before auto-close',

  -- Auto-Close Settings
  auto_close_enabled BOOLEAN DEFAULT TRUE COMMENT 'Enable auto-close after max reminders',
  auto_close_template TEXT COMMENT '4th email template (closes ticket)',

  -- Ticket Closed Confirmation
  ticket_closed_confirmation_enabled BOOLEAN DEFAULT TRUE COMMENT 'Send confirmation when customer closes ticket',
  ticket_closed_confirmation_template TEXT COMMENT 'Confirmation email template',

  -- Escalation Settings
  escalation_enabled BOOLEAN DEFAULT TRUE COMMENT 'Enable auto-escalation',
  escalation_hours INT DEFAULT 24 COMMENT 'Hours until escalation',
  escalation_notify_all_staff BOOLEAN DEFAULT TRUE COMMENT 'Notify all staff on escalation',

  -- SLA Settings
  sla_first_response_hours INT DEFAULT 4 COMMENT 'Target first response time',
  sla_resolution_hours INT DEFAULT 48 COMMENT 'Target resolution time',

  -- Default Assignment
  default_assignee_id INT NULL COMMENT 'Default staff for new tickets',

  -- Notifications
  notify_on_new_ticket BOOLEAN DEFAULT TRUE COMMENT 'Notify assigned staff on new ticket',
  notify_on_escalation BOOLEAN DEFAULT TRUE COMMENT 'Notify all staff on escalation',
  notify_on_customer_reply BOOLEAN DEFAULT TRUE COMMENT 'Notify assigned staff on reply',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_shop_settings (shop_id),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (default_assignee_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### NEW TABLE: `business_hours`

Defines per-shop business hours for auto-response logic.

```sql
CREATE TABLE business_hours (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT NOT NULL,

  day_of_week INT NOT NULL COMMENT '0=Sunday, 1=Monday, ..., 6=Saturday',
  is_open BOOLEAN DEFAULT TRUE COMMENT 'Is business open this day?',
  open_time TIME NULL COMMENT 'Opening time (e.g., 09:00:00)',
  close_time TIME NULL COMMENT 'Closing time (e.g., 17:00:00)',
  timezone VARCHAR(50) DEFAULT 'America/New_York' COMMENT 'Timezone for this shop',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_shop_day (shop_id, day_of_week),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### NEW TABLE: `canned_responses`

Quick reply templates for staff.

```sql
CREATE TABLE canned_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT NOT NULL,

  title VARCHAR(255) NOT NULL COMMENT 'Template title (e.g., "Refund Process")',
  shortcut VARCHAR(50) NULL COMMENT 'Quick access shortcut (e.g., "/refund")',
  category VARCHAR(100) NULL COMMENT 'Template category (Orders, Shipping, Returns)',

  body_html TEXT NOT NULL COMMENT 'HTML template body',
  body_text TEXT NULL COMMENT 'Plain text version',

  usage_count INT DEFAULT 0 COMMENT 'How many times used',
  is_active BOOLEAN DEFAULT TRUE,

  created_by INT NULL COMMENT 'Staff member who created',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_shop_id (shop_id),
  INDEX idx_shortcut (shortcut),
  INDEX idx_category (category),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### NEW TABLE: `email_footer_settings`

Customizable email footer for all outgoing emails.

```sql
CREATE TABLE email_footer_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT NOT NULL,

  -- Logo
  logo_url VARCHAR(500) NULL COMMENT 'Footer logo URL',
  logo_alt_text VARCHAR(255) DEFAULT 'Company Logo',

  -- Company Info
  company_name VARCHAR(255) NOT NULL DEFAULT 'TFS Wheels',
  address_line1 VARCHAR(255) NULL,
  address_line2 VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(50) NULL,
  zip VARCHAR(20) NULL,
  country VARCHAR(100) DEFAULT 'USA',

  -- Contact
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  website_url VARCHAR(500) NULL,

  -- Social Media
  facebook_url VARCHAR(500) NULL,
  instagram_url VARCHAR(500) NULL,
  twitter_url VARCHAR(500) NULL,
  linkedin_url VARCHAR(500) NULL,

  -- Reviews
  google_review_url VARCHAR(500) NULL,
  trustpilot_url VARCHAR(500) NULL,

  -- Close Ticket Link
  show_close_ticket_link BOOLEAN DEFAULT TRUE COMMENT 'Include close ticket link in footer',
  close_ticket_link_text VARCHAR(100) DEFAULT 'Close this ticket',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_shop_footer (shop_id),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### NEW TABLE: `ticket_reminders`

Tracks pending_customer reminder counts and history.

```sql
CREATE TABLE ticket_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,

  reminder_number INT NOT NULL COMMENT '1, 2, 3, or 4 (4 = auto-close)',
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  template_used TEXT COMMENT 'Template content at time of send',

  INDEX idx_conversation_id (conversation_id),
  INDEX idx_sent_at (sent_at),
  FOREIGN KEY (conversation_id) REFERENCES email_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### NEW TABLE: `close_ticket_tokens`

Secure tokens for customer close ticket links.

```sql
CREATE TABLE close_ticket_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,

  token VARCHAR(64) UNIQUE NOT NULL COMMENT 'Secure random token',
  expires_at TIMESTAMP NULL COMMENT 'Optional expiration (NULL = never)',
  used_at TIMESTAMP NULL COMMENT 'When customer used this link',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_token (token),
  INDEX idx_conversation_id (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES email_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

#### ALTER EXISTING: `email_conversations`

Add fields for reminder tracking and escalation.

```sql
ALTER TABLE email_conversations
  ADD COLUMN reminder_count INT DEFAULT 0 COMMENT 'Number of pending_customer reminders sent',
  ADD COLUMN last_reminder_at TIMESTAMP NULL COMMENT 'When last reminder was sent',
  ADD COLUMN is_escalated BOOLEAN DEFAULT FALSE COMMENT 'Has this ticket been escalated?',
  ADD COLUMN escalated_at TIMESTAMP NULL COMMENT 'When ticket was escalated',

  ADD INDEX idx_is_escalated (is_escalated),
  ADD INDEX idx_reminder_count (reminder_count),
  ADD INDEX idx_last_reminder_at (last_reminder_at);
```

---

## 🔌 Backend API Design

### New Routes

#### `/api/settings/*` - Settings Management

**GET /api/settings/:shopId**
- Get all settings for shop
- Returns: `{ ticketSettings, businessHours[], footerSettings }`

**PUT /api/settings/:shopId/ticket**
- Update ticket settings
- Body: Partial `ticket_settings` fields
- Returns: Updated settings

**GET /api/settings/:shopId/business-hours**
- Get business hours for all 7 days
- Returns: Array of 7 business_hours objects

**PUT /api/settings/:shopId/business-hours**
- Update business hours (all days at once)
- Body: `{ hours: [{ day_of_week, is_open, open_time, close_time }] }`
- Returns: Updated hours

**GET /api/settings/:shopId/footer**
- Get email footer settings
- Returns: `email_footer_settings` object

**PUT /api/settings/:shopId/footer**
- Update email footer settings
- Body: Partial `email_footer_settings` fields
- Returns: Updated footer settings

**POST /api/settings/:shopId/footer/logo-upload**
- Upload footer logo image
- Body: FormData with file
- Returns: `{ logoUrl }`

#### `/api/canned-responses/*` - Quick Replies

**GET /api/canned-responses/:shopId**
- List all canned responses for shop
- Query: `?category=Orders` (optional filter)
- Returns: Array of canned_responses

**POST /api/canned-responses/:shopId**
- Create new canned response
- Body: `{ title, shortcut, category, body_html, body_text, created_by }`
- Returns: Created response

**PUT /api/canned-responses/:id**
- Update canned response
- Body: Partial fields
- Returns: Updated response

**DELETE /api/canned-responses/:id**
- Delete canned response
- Returns: Success message

**POST /api/canned-responses/:id/use**
- Increment usage_count
- Returns: Updated usage_count

#### `/api/automation/*` - Manual Triggers

**POST /api/automation/:shopId/trigger-reminders**
- Manually trigger pending_customer reminders check
- Returns: `{ sent: number, failed: number }`

**POST /api/automation/:shopId/trigger-escalation**
- Manually trigger escalation check
- Returns: `{ escalated: number }`

**POST /api/automation/:shopId/trigger-auto-close**
- Manually trigger auto-close check
- Returns: `{ closed: number }`

#### `/api/webhooks/close-ticket/:conversationId/:token` - Customer Close

**GET /api/webhooks/close-ticket/:conversationId/:token**
- Public endpoint for customer to close ticket via email link
- Validates token, closes ticket, sends confirmation
- Returns: HTML page "Your ticket has been closed. Reply to reopen."

#### Extended: `/api/tickets/*` - Bulk Actions

**POST /api/tickets/bulk/delete**
- Bulk delete tickets (with confirmation)
- Body: `{ ticketIds[], staffId, confirmDelete: true }`
- Returns: `{ deleted: number }`

**POST /api/tickets/bulk/tag**
- Bulk add/remove tags
- Body: `{ ticketIds[], tags[], action: 'add' | 'remove', staffId }`
- Returns: `{ updated: number }`

#### Extended: `/api/staff/*` - Staff Management

**POST /api/staff/:shopId/sync**
- Sync staff from Shopify (already exists, verify)
- Returns: `{ synced: number, created: number, updated: number }`

**PUT /api/staff/:id**
- Update staff member (role, is_active, etc.)
- Body: Partial staff_users fields
- Returns: Updated staff

**DELETE /api/staff/:id**
- Deactivate staff member (set is_active = false)
- Returns: Success message

---

## 🎨 Frontend Architecture

### New Routing Structure

```jsx
// admin/src/App.jsx

<Routes>
  {/* Existing routes */}
  <Route path="/" element={<Orders />} />
  <Route path="/products" element={<Products />} />
  <Route path="/email" element={<EmailTemplates />} />
  <Route path="/settings" element={<Settings />} />

  {/* NEW: Nested Support Tickets Routes */}
  <Route path="/tickets" element={<TicketsLayout />}>
    <Route index element={<Navigate to="/tickets/dashboard" replace />} />
    <Route path="dashboard" element={<TicketDashboard />} />
    <Route path="staff" element={<StaffManagement />} />
    <Route path="reports" element={<Reports />} />
    <Route path="settings" element={<TicketSettings />}>
      <Route index element={<Navigate to="/tickets/settings/general" replace />} />
      <Route path="general" element={<GeneralSettings />} />
      <Route path="email-footer" element={<EmailFooterSettings />} />
      <Route path="business-hours" element={<BusinessHoursSettings />} />
      <Route path="assignment" element={<AssignmentSettings />} />
      <Route path="automation" element={<AutomationSettings />} />
      <Route path="email-templates" element={<EmailTemplatesSettings />} />
      <Route path="canned-responses" element={<CannedResponsesSettings />} />
      <Route path="staff-management" element={<StaffManagementSettings />} />
      <Route path="tags" element={<TagsSettings />} />
      <Route path="notifications" element={<NotificationsSettings />} />
    </Route>
  </Route>

  {/* PRESERVED: EmailThread.jsx (DO NOT MODIFY) */}
  <Route path="/tickets/:conversationId" element={<EmailThread />} />
</Routes>
```

### New Components

#### `TicketsLayout.jsx` - Shared Layout

```jsx
// Wrapper component for all /tickets/* routes
// - Sidebar navigation (Dashboard, Staff, Reports, Settings)
// - Breadcrumbs
// - Shared state/context for ticket data
```

#### `TicketDashboard.jsx` - Main Dashboard

**Replaces:** SupportTickets.jsx (complete redesign)

**Features:**
- Stats cards: Open, In Progress, Escalated, Avg Response Time
- Tabbed filters: All, Open, Assigned, In Progress, Pending Customer, Closed
- Search: ticket #, email, name, subject, category
- Table columns: Ticket #, Subject/Customer, Status, Priority, Tag, Assigned To, Last Activity
- Status badges with colors (matching AI design)
- Priority indicators: ↑↑ High, — Normal, ↓ Low
- Tag badges: Customer (green), Potential (purple), Visitor (gray)
- Escalation alert icon for escalated tickets
- Bulk actions bar: Assign, Close, Tag, Merge, Delete (with confirmation)
- Pagination: 50 per page
- Real-time badge counts

#### `StaffManagement.jsx` - Staff Page

**Features:**
- List all staff members with avatars, roles, stats
- Add/edit/deactivate staff
- Set default assignee
- View performance metrics (tickets handled, avg response time)
- Sync from Shopify button

#### `Reports.jsx` - Analytics (Placeholder)

**Future Features:**
- Ticket trends over time
- Staff performance reports
- SLA compliance metrics
- Resolution rate charts

#### `TicketSettings.jsx` - Settings Container

**Features:**
- Sidebar navigation for settings sections
- Nested routing for each section
- Save/Cancel buttons (sticky footer)
- Unsaved changes warning

#### Settings Subsections

**`EmailFooterSettings.jsx`**
- Logo upload (with preview)
- Company name, address, phone, email, website
- Social media links (Facebook, Instagram, Twitter, LinkedIn)
- Review links (Google, Trustpilot)
- Close ticket link toggle
- Live preview of footer

**`BusinessHoursSettings.jsx`**
- Timezone selector
- 7-day grid (Mon-Sun)
- Toggle open/closed for each day
- Time pickers for open/close times
- Visual indicator (Open/Closed badge)

**`AssignmentSettings.jsx`**
- Default assignee dropdown (list of active staff)
- Future: Round-robin toggle (disabled with "Coming Soon" label)

**`AutomationSettings.jsx`**
- **Pending Customer Reminders**
  - Enable/disable toggle
  - Daily send time picker (default 10:00 AM EST)
  - Max reminders before auto-close (2, 3, 4, 5)

- **Escalation Rules**
  - Enable/disable toggle
  - Hours until escalation (4, 8, 12, 24, 48)
  - Notify all staff toggle

- **SLA Targets**
  - First response time target (1h, 2h, 4h, 8h, 24h)
  - Resolution time target (24h, 48h, 72h, 1 week)

**`EmailTemplatesSettings.jsx`**
- List of 8 email templates:
  1. Auto-Response (Business Hours)
  2. Auto-Response (After Hours)
  3. Pending Reminder #1
  4. Pending Reminder #2
  5. Pending Reminder #3
  6. Auto-Close Message (4th Email)
  7. Ticket Closed Confirmation
  8. Staff Assignment Notification

- Each template has:
  - Template name
  - Template key
  - Edit button → Modal with rich text editor
  - Available placeholders dropdown
  - Subject line editor
  - Preview button

**`CannedResponsesSettings.jsx`**
- Add Response button
- List of responses with:
  - Title
  - Shortcut (e.g., `/refund`)
  - Category
  - Edit/Delete buttons
- Create/edit modal with rich text editor

**`StaffManagementSettings.jsx`**
- Same as StaffManagement.jsx (could be shared component)

**`TagsSettings.jsx`**
- List of tags with color pickers:
  - customer (green) - System tag, auto-assigned
  - potential-customer (purple) - System tag, auto-assigned
  - visitor (gray) - System tag, auto-assigned
  - Custom tags (user-created) - Can edit/delete
- Add Tag button
- Edit tag modal (name, color picker)

**`NotificationsSettings.jsx`**
- Toggle switches for:
  - New Ticket Assignment (notify assigned staff)
  - Ticket Escalation (notify all staff)
  - Customer Reply (notify assigned staff)

---

## ⚙️ Automation Engine

### Service: `automationScheduler.js`

Uses `node-cron` to schedule automated tasks.

```javascript
// server/src/services/automationScheduler.js

import cron from 'node-cron';
import db from '../config/database.js';
import { sendEmail } from './zohoMailEnhanced.js';
import { getSettings } from './settingsManager.js';

// =====================================================
// 1. PENDING CUSTOMER REMINDERS
// =====================================================
// Runs daily at 10:00 AM EST
// Checks all tickets with status='pending_customer'
// Sends reminder if 24 hours since last_message_at or last_reminder_at
// Increments reminder_count
// Auto-closes if reminder_count >= max_reminders

cron.schedule('0 10 * * *', async () => {
  console.log('[AUTOMATION] Running pending customer reminders check...');

  const shops = await db.execute('SELECT id FROM shops');

  for (const shop of shops[0]) {
    const settings = await getSettings(shop.id);

    if (!settings.pending_reminder_enabled) continue;

    // Find tickets needing reminders
    const [tickets] = await db.execute(`
      SELECT * FROM email_conversations
      WHERE shop_id = ?
        AND status = 'pending_customer'
        AND reminder_count < ?
        AND (
          (last_reminder_at IS NULL AND last_message_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
          OR (last_reminder_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
        )
    `, [shop.id, settings.pending_reminder_max_count]);

    for (const ticket of tickets) {
      const reminderNumber = ticket.reminder_count + 1;
      const template = settings[`pending_reminder_template_${reminderNumber}`];

      // Send reminder email
      await sendEmail(shop.id, {
        to: ticket.customer_email,
        subject: `Re: ${ticket.subject}`,
        bodyHtml: template,
        conversationId: ticket.id,
        inReplyTo: ticket.thread_id
      });

      // Update ticket
      await db.execute(`
        UPDATE email_conversations
        SET reminder_count = reminder_count + 1,
            last_reminder_at = NOW()
        WHERE id = ?
      `, [ticket.id]);

      // Log reminder
      await db.execute(`
        INSERT INTO ticket_reminders (conversation_id, reminder_number, template_used)
        VALUES (?, ?, ?)
      `, [ticket.id, reminderNumber, template]);
    }
  }
});

// =====================================================
// 2. AUTO-CLOSE AFTER MAX REMINDERS
// =====================================================
// Runs daily at 10:00 AM EST
// Finds tickets with reminder_count >= max_reminders
// Sends final auto-close email
// Changes status to 'closed'

cron.schedule('0 10 * * *', async () => {
  console.log('[AUTOMATION] Running auto-close check...');

  const shops = await db.execute('SELECT id FROM shops');

  for (const shop of shops[0]) {
    const settings = await getSettings(shop.id);

    if (!settings.auto_close_enabled) continue;

    // Find tickets to auto-close
    const [tickets] = await db.execute(`
      SELECT * FROM email_conversations
      WHERE shop_id = ?
        AND status = 'pending_customer'
        AND reminder_count >= ?
        AND last_reminder_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `, [shop.id, settings.pending_reminder_max_count]);

    for (const ticket of tickets) {
      // Send auto-close email
      await sendEmail(shop.id, {
        to: ticket.customer_email,
        subject: `Re: ${ticket.subject}`,
        bodyHtml: settings.auto_close_template,
        conversationId: ticket.id,
        inReplyTo: ticket.thread_id
      });

      // Close ticket
      await db.execute(`
        UPDATE email_conversations
        SET status = 'closed',
            resolved_at = NOW(),
            resolution_time = TIMESTAMPDIFF(MINUTE, created_at, NOW())
        WHERE id = ?
      `, [ticket.id]);

      // Log auto-close
      await db.execute(`
        INSERT INTO ticket_reminders (conversation_id, reminder_number, template_used)
        VALUES (?, 4, ?)
      `, [ticket.id, settings.auto_close_template]);

      await db.execute(`
        INSERT INTO ticket_activities (conversation_id, action_type, note)
        VALUES (?, 'status_change', 'Auto-closed after max reminders')
      `, [ticket.id]);
    }
  }
});

// =====================================================
// 3. ESCALATION CHECK
// =====================================================
// Runs every 15 minutes
// Finds tickets in 'open' or 'assigned' status
// No activity for X hours (configurable)
// Marks as escalated, notifies all staff

cron.schedule('*/15 * * * *', async () => {
  console.log('[AUTOMATION] Running escalation check...');

  const shops = await db.execute('SELECT id FROM shops');

  for (const shop of shops[0]) {
    const settings = await getSettings(shop.id);

    if (!settings.escalation_enabled) continue;

    // Find tickets to escalate
    const [tickets] = await db.execute(`
      SELECT * FROM email_conversations
      WHERE shop_id = ?
        AND status IN ('open', 'assigned')
        AND is_escalated = FALSE
        AND last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [shop.id, settings.escalation_hours]);

    for (const ticket of tickets) {
      // Mark as escalated
      await db.execute(`
        UPDATE email_conversations
        SET is_escalated = TRUE,
            escalated_at = NOW()
        WHERE id = ?
      `, [ticket.id]);

      // Log escalation
      await db.execute(`
        INSERT INTO ticket_activities (conversation_id, action_type, note)
        VALUES (?, 'escalation', ?)
      `, [ticket.id, `Auto-escalated after ${settings.escalation_hours} hours of inactivity`]);

      // Notify all staff if enabled
      if (settings.escalation_notify_all_staff) {
        const [staff] = await db.execute(`
          SELECT email FROM staff_users
          WHERE shop_id = ? AND is_active = TRUE
        `, [shop.id]);

        for (const member of staff) {
          // Send notification email
          await sendEmail(shop.id, {
            to: member.email,
            subject: `⚠️ Ticket Escalated: ${ticket.ticket_number}`,
            bodyHtml: `Ticket ${ticket.ticket_number} has been escalated...`
          });
        }
      }
    }
  }
});

// =====================================================
// 4. SLA MONITORING
// =====================================================
// Runs every 5 minutes
// Tracks first response time and resolution time
// Updates ticket_activities with SLA breaches

cron.schedule('*/5 * * * *', async () => {
  console.log('[AUTOMATION] Running SLA monitoring...');

  const shops = await db.execute('SELECT id FROM shops');

  for (const shop of shops[0]) {
    const settings = await getSettings(shop.id);

    // Check first response SLA
    const [noResponse] = await db.execute(`
      SELECT * FROM email_conversations
      WHERE shop_id = ?
        AND status IN ('open', 'assigned')
        AND first_response_at IS NULL
        AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [shop.id, settings.sla_first_response_hours]);

    for (const ticket of noResponse) {
      // Log SLA breach
      await db.execute(`
        INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
        VALUES (?, 'sla_breach', 'First response SLA breached', ?)
      `, [ticket.id, JSON.stringify({ sla_type: 'first_response' })]);
    }

    // Check resolution SLA
    const [unresolved] = await db.execute(`
      SELECT * FROM email_conversations
      WHERE shop_id = ?
        AND status NOT IN ('resolved', 'closed')
        AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [shop.id, settings.sla_resolution_hours]);

    for (const ticket of unresolved) {
      // Log SLA breach
      await db.execute(`
        INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
        VALUES (?, 'sla_breach', 'Resolution SLA breached', ?)
      `, [ticket.id, JSON.stringify({ sla_type: 'resolution' })]);
    }
  }
});

export default {
  // Manual trigger functions (for API endpoints)
  async triggerReminders(shopId) { /* ... */ },
  async triggerEscalation(shopId) { /* ... */ },
  async triggerAutoClose(shopId) { /* ... */ }
};
```

### Service: `autoTagging.js`

Auto-tags tickets based on Shopify customer data.

```javascript
// server/src/services/autoTagging.js

import { shopifyGraphQL } from './shopifyAPI.js';
import db from '../config/database.js';

/**
 * Auto-tag and auto-prioritize ticket based on Shopify customer data
 *
 * Rules:
 * - Customer with orders → 'customer' tag, 'normal' priority
 * - Customer with cart/abandoned checkout → 'potential-customer' tag, 'high' priority
 * - Neither → 'visitor' tag, 'low' priority
 */
export async function autoTagTicket(shopId, conversationId, customerEmail) {
  try {
    // Query Shopify for customer data
    const query = `
      query ($email: String!) {
        customers(first: 1, query: $email) {
          edges {
            node {
              id
              email
              ordersCount
              checkouts(first: 5) {
                edges {
                  node {
                    id
                    completedAt
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await shopifyGraphQL(shopId, query, { email: customerEmail });
    const customer = result.data?.customers?.edges[0]?.node;

    let tag = 'visitor';
    let priority = 'low';

    if (customer) {
      const hasOrders = customer.ordersCount > 0;
      const hasCheckouts = customer.checkouts.edges.some(e => !e.node.completedAt);

      if (hasOrders) {
        tag = 'customer';
        priority = 'normal';
      } else if (hasCheckouts) {
        tag = 'potential-customer';
        priority = 'high';
      }
    }

    // Update ticket
    const [existing] = await db.execute(
      'SELECT tags FROM email_conversations WHERE id = ?',
      [conversationId]
    );

    const tags = existing[0]?.tags ? JSON.parse(existing[0].tags) : [];
    if (!tags.includes(tag)) {
      tags.push(tag);
    }

    await db.execute(`
      UPDATE email_conversations
      SET tags = ?,
          priority = ?
      WHERE id = ?
    `, [JSON.stringify(tags), priority, conversationId]);

    // Log activity
    await db.execute(`
      INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
      VALUES (?, 'tag_add', 'Auto-tagged based on Shopify data', ?)
    `, [conversationId, JSON.stringify({ tag, priority, auto: true })]);

    return { tag, priority };

  } catch (error) {
    console.error('[AUTO-TAG] Error auto-tagging ticket:', error);
    // Fallback to visitor/low if error
    return { tag: 'visitor', priority: 'low' };
  }
}
```

**Integration Point:** Call `autoTagTicket()` in `emailThreading.js` → `findOrCreateConversation()` immediately after creating new conversation.

---

## 🎛️ Settings & Customization

### Settings Categories

#### 1. **Email & Footer**
- Footer logo upload
- Company name, address, contact info
- Social media links (Facebook, Instagram, Twitter, LinkedIn)
- Review links (Google, Trustpilot)
- Close ticket link toggle + custom text

#### 2. **Business Hours**
- Timezone selector (America/New_York default)
- 7-day schedule (Mon-Sun)
- Toggle open/closed for each day
- Time pickers (open/close times)
- Visual preview of current status

#### 3. **Assignment Rules**
- Default assignee dropdown (active staff list)
- Fallback behavior (if default unavailable)
- Future: Round-robin toggle (disabled for now)

#### 4. **Automation**

**Pending Customer Reminders:**
- Enable/disable toggle
- Daily send time (default 10:00 AM EST)
- Max reminders before auto-close (2, 3, 4, 5)

**Escalation:**
- Enable/disable toggle
- Hours until escalation (4, 8, 12, 24, 48)
- Notify all staff on escalation toggle

**SLA Targets:**
- First response time target (1h, 2h, 4h, 8h, 24h)
- Resolution time target (24h, 48h, 72h, 1 week)

#### 5. **Email Templates**

8 customizable templates:
1. Auto-Response (Business Hours)
2. Auto-Response (After Hours)
3. Pending Reminder #1
4. Pending Reminder #2
5. Pending Reminder #3
6. Auto-Close Message (4th Email)
7. Ticket Closed Confirmation
8. Staff Assignment Notification

Each template has:
- Subject line editor
- Rich text body editor (TipTap)
- Available placeholders dropdown
- Preview mode

**Available Placeholders:**
- `{{customer_name}}` - Full customer name
- `{{customer_first_name}}` - First name only
- `{{customer_email}}` - Customer email
- `{{ticket_number}}` - Ticket # (e.g., TFS-1-00123)
- `{{subject}}` - Ticket subject
- `{{order_number}}` - Shopify order # (if linked)
- `{{vehicle_full}}` - Full vehicle (if available in order)
- `{{company_name}}` - TFS Wheels
- `{{company_email}}` - sales@tfswheels.com

#### 6. **Canned Responses**

- Add/edit/delete quick reply templates
- Fields:
  - Title (e.g., "Refund Process")
  - Shortcut (e.g., "/refund")
  - Category (Orders, Shipping, Returns, etc.)
  - Body (HTML + plain text)
- Usage count tracking
- Rich text editor with placeholders

#### 7. **Staff Management**

- List all staff (synced from Shopify)
- Add/edit/deactivate staff
- Fields:
  - Name, email, role (admin/agent/viewer)
  - Avatar, phone, locale
  - is_active toggle
- Set default assignee
- View stats (tickets handled, avg response time)
- Sync from Shopify button

#### 8. **Tags**

**System Tags (Auto-assigned):**
- customer (green) - Has Shopify orders
- potential-customer (purple) - Has cart/abandoned checkout
- visitor (gray) - Neither orders nor cart

**Custom Tags:**
- Add custom tags with color picker
- Edit/delete custom tags
- Cannot edit/delete system tags

#### 9. **Notifications**

Toggle switches for:
- **New Ticket Assignment** - Notify assigned staff when ticket is assigned to them
- **Ticket Escalation** - Notify all staff when ticket is escalated
- **Customer Reply** - Notify assigned staff when customer replies

---

## 📅 Implementation Phases

### PHASE 1: Database & Backend (Week 1)

**Tasks:**
1. ✅ Create migration 014 SQL file
2. ✅ Test all SQL queries directly on Google Cloud MySQL
3. ✅ Run migration and verify all tables created
4. ✅ Create `settingsManager.js` service
5. ✅ Create `autoTagging.js` service
6. ✅ Create `automationScheduler.js` service
7. ✅ Implement all `/api/settings/*` routes
8. ✅ Implement `/api/canned-responses/*` routes
9. ✅ Implement `/api/automation/*` routes
10. ✅ Implement `/api/webhooks/close-ticket/*` route
11. ✅ Extend `/api/tickets/*` with bulk delete and bulk tag
12. ✅ Integrate `autoTagTicket()` into `emailThreading.js`
13. ✅ Test all APIs with Postman/Insomnia

**Deliverables:**
- Migration 014 SQL file
- 3 new service files
- 4 new route files
- Updated emailThreading.js
- API test documentation

### PHASE 2: Frontend - Dashboard & Staff (Week 2)

**Tasks:**
1. ✅ Create `TicketsLayout.jsx` wrapper component
2. ✅ Build `TicketDashboard.jsx` (redesigned SupportTickets.jsx)
   - Stats cards
   - Tabbed filters
   - Search bar
   - Tickets table with new columns
   - Status/priority/tag badges
   - Bulk actions bar
3. ✅ Build `StaffManagement.jsx` page
4. ✅ Create placeholder `Reports.jsx` page
5. ✅ Update routing in `App.jsx` with nested /tickets routes
6. ✅ Test localStorage persistence (RouteManager compatibility)
7. ✅ Verify EmailThread.jsx still works (DO NOT MODIFY IT)

**Deliverables:**
- 4 new page components
- Updated App.jsx routing
- Functioning dashboard with all features

### PHASE 3: Frontend - Settings (Week 2-3)

**Tasks:**
1. ✅ Create `TicketSettings.jsx` container with sidebar navigation
2. ✅ Build all 9 settings subsection components:
   - EmailFooterSettings.jsx
   - BusinessHoursSettings.jsx
   - AssignmentSettings.jsx
   - AutomationSettings.jsx
   - EmailTemplatesSettings.jsx
   - CannedResponsesSettings.jsx
   - StaffManagementSettings.jsx (reuse StaffManagement.jsx)
   - TagsSettings.jsx
   - NotificationsSettings.jsx
3. ✅ Implement logo upload functionality
4. ✅ Build rich text editor for templates (TipTap)
5. ✅ Implement placeholder insertion dropdown
6. ✅ Add unsaved changes warning
7. ✅ Test save/cancel for all sections

**Deliverables:**
- 9 settings subsection components
- Logo upload endpoint + UI
- Rich text editor integration
- Complete settings workflow

### PHASE 4: Automation & Testing (Week 3-4)

**Tasks:**
1. ✅ Start `automationScheduler.js` on server boot
2. ✅ Test pending customer reminders (manually trigger + wait 24h)
3. ✅ Test auto-close after 3 reminders
4. ✅ Test escalation logic
5. ✅ Test SLA monitoring
6. ✅ Test auto-tagging on new tickets
7. ✅ Test customer close ticket link
8. ✅ Test staff notifications (new assignment, escalation, reply)
9. ✅ End-to-end testing:
   - Create new ticket → auto-tagged → assigned → reply → pending customer → 3 reminders → auto-close → customer reopens
10. ✅ Deploy to Railway + Vercel
11. ✅ Monitor logs for 1 week

**Deliverables:**
- Working automation scheduler
- Tested reminder flow
- Tested auto-close flow
- Tested escalation flow
- Production deployment
- Monitoring dashboard

### PHASE 5: Polish & Documentation (Week 4)

**Tasks:**
1. ✅ Update CLAUDE.md with new ticketing system overview
2. ✅ Create USER_GUIDE.md for staff users
3. ✅ Add loading states to all pages
4. ✅ Add error handling + user-friendly error messages
5. ✅ Add success toasts for all actions
6. ✅ Optimize database queries (add missing indexes)
7. ✅ Add analytics tracking (optional)
8. ✅ Final QA pass

**Deliverables:**
- Updated documentation
- User guide
- Polished UI with proper feedback
- Optimized performance
- Production-ready system

---

## ⚠️ Critical Preservation Rules

### DO NOT MODIFY

1. **EmailThread.jsx** - Complete email thread view
   - `processInlineImages()` function
   - Attachment handling logic
   - AI reply generation
   - Rich text editor (TipTap)
   - Order/customer sidebar

2. **Email Threading Logic** (`emailThreading.js`)
   - `generateThreadId()` function
   - Subject-based fallback
   - In-Reply-To / References headers
   - Thread matching logic

3. **Inline Image Processing** (`emailInboxSync.js`)
   - `downloadInlineImage()` calls
   - HTML replacement logic (ImageDisplay URLs)
   - CID mapping
   - Smart serving fallback (disk → Zoho)

4. **Zoho OAuth Integration** (`zohoMailEnhanced.js`)
   - Token refresh logic
   - Access token storage
   - API retry logic

5. **RouteManager** (`App.jsx`)
   - localStorage persistence
   - Shopify iframe compatibility

### SAFE TO EXTEND

✅ `email_conversations` table - Add columns (reminder_count, is_escalated, etc.)
✅ `customer_emails` table - Add columns (staff_id already added in migration 012)
✅ API routes - Add new endpoints
✅ Services - Create new service files
✅ Frontend components - Create new pages
✅ Database tables - Create new tables (ticket_settings, business_hours, etc.)

### INTEGRATION POINTS

When new email arrives:
1. **emailInboxSync.js** → `processNewEmail()`
2. **emailThreading.js** → `findOrCreateConversation()`
3. **🆕 autoTagging.js** → `autoTagTicket()` ← INSERT HERE
4. **🆕 Check business hours** → Send auto-response if enabled
5. **🆕 Assign default staff** if status = 'open' and no assignment

When ticket status changes:
1. **tickets.js** → `PUT /api/tickets/:id/status`
2. **🆕 Check if status = 'pending_customer'** → Reset reminder_count = 0
3. **ticketActivities.js** → `logStatusChange()`
4. **🆕 If status = 'closed'** → Send ticket_closed_confirmation email (if enabled)

When customer replies to closed ticket:
1. **emailThreading.js** → `findOrCreateConversation()`
2. **🆕 Check if status = 'closed'** → Change status to 'in_progress'
3. **🆕 Notify assigned staff** (if enabled)

---

## 📊 Database Schema Summary

### New Tables (7)
1. `ticket_settings` - Per-shop configuration
2. `business_hours` - Mon-Sun schedules (7 rows per shop)
3. `canned_responses` - Quick reply templates
4. `email_footer_settings` - Footer customization
5. `ticket_reminders` - Reminder history
6. `close_ticket_tokens` - Secure close links

### Altered Tables (1)
1. `email_conversations` - Add `reminder_count`, `last_reminder_at`, `is_escalated`, `escalated_at`

### Existing Tables (Unchanged)
- `email_conversations` (core ticket table)
- `staff_users` (Shopify staff)
- `ticket_activities` (audit trail)
- `customer_emails` (messages)
- `email_attachments` (files)
- `email_templates` (templates)
- `shops`, `orders` (existing)

---

## 🚀 Success Metrics

### Before Launch
- [ ] All 6 new tables created successfully
- [ ] All 4 new API route groups working
- [ ] All 3 new services implemented
- [ ] Dashboard loads in < 2 seconds
- [ ] Settings page saves successfully
- [ ] EmailThread.jsx unchanged and working
- [ ] Automation scheduler running without errors

### Post-Launch (Week 1)
- [ ] 0 errors in Railway logs related to ticketing
- [ ] Auto-responses sent successfully (check Zoho)
- [ ] Pending reminders sent on schedule
- [ ] Auto-close working (after 3 reminders)
- [ ] Escalation alerts working
- [ ] Staff receiving notifications
- [ ] Customer close ticket links working

### Post-Launch (Month 1)
- [ ] Average first response time < 4 hours
- [ ] Ticket resolution rate > 90%
- [ ] Staff satisfaction with new system
- [ ] Customer satisfaction maintained/improved
- [ ] No ticket threading issues
- [ ] No inline image display issues

---

## 📝 Notes

**Per-Shop vs Global:**
All settings are per-shop (`shop_id` foreign key) to support future multi-shop deployment.

**Timing Flexibility:**
All automation timings are configurable via settings table, not hardcoded.

**Email Template Placeholders:**
Templates support `{{placeholder}}` syntax. Backend replaces with actual values before sending.

**Security:**
- Close ticket tokens are 64-char random strings (cryptographically secure)
- Optional expiration (default: never)
- Single-use tokens (marked `used_at` after use)

**Shopify Integration:**
Auto-tagging requires Shopify Admin API access. Uses existing `shopifyGraphQL()` helper.

**Railway Deployment:**
Automation scheduler starts automatically on server boot. No manual cron configuration needed.

**Future Enhancements (Not in Scope):**
- Round-robin staff assignment
- Customer portal (web view of tickets)
- Slack notifications
- Custom SLA rules per category
- Merge ticket UI
- Advanced reporting/analytics

---

## ✅ Ready to Implement

This plan is comprehensive, tested, and ready for execution. All questions have been answered, all design decisions made, and all technical details documented.

**Estimated Timeline:** 3-4 weeks for complete implementation and testing.

**Next Steps:**
1. Create migration 014 SQL file
2. Test SQL queries directly on Google Cloud MySQL
3. Run migration
4. Begin backend implementation (services + routes)
5. Begin frontend implementation (pages + components)
6. Deploy and test automation
7. Final QA and polish

---

**Document Version:** 2.0
**Last Updated:** 2026-01-30
**Author:** TFS Manager Development Team
**Status:** ✅ Approved - Ready for Implementation
