# Customer Email → Ticketing System Revamp

## Overview
Complete transformation of the email system into a modern, full-featured ticketing system with better UI/UX, rich text editing, bulk actions, and staff tracking.

---

## Phase 1: Database Schema Updates

### New Tables

#### 1. `staff_users` (Basic staff tracking)
```sql
CREATE TABLE staff_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shop_id INT DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'agent' COMMENT 'admin, agent',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_staff_email (shop_id, email),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);
```

#### 2. `ticket_activities` (Track all ticket actions)
```sql
CREATE TABLE ticket_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  staff_id INT NULL,
  action_type VARCHAR(50) NOT NULL COMMENT 'status_change, reply, assignment, note, merge',
  from_value VARCHAR(255) NULL,
  to_value VARCHAR(255) NULL,
  note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation (conversation_id),
  INDEX idx_staff (staff_id),
  INDEX idx_action_type (action_type),
  FOREIGN KEY (conversation_id) REFERENCES email_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL
);
```

### Table Modifications

#### Update `email_conversations`
```sql
ALTER TABLE email_conversations
  -- Replace 'status' with ticket statuses
  MODIFY COLUMN status VARCHAR(50) DEFAULT 'open'
    COMMENT 'open, assigned, in_progress, pending_customer, resolved, closed',

  -- Add staff tracking
  ADD COLUMN assigned_to INT NULL COMMENT 'Staff member assigned to this ticket',
  ADD COLUMN last_reply_by INT NULL COMMENT 'Last staff member who replied',
  ADD COLUMN first_response_at TIMESTAMP NULL COMMENT 'When first staff reply was sent',
  ADD COLUMN resolution_time INT NULL COMMENT 'Minutes from open to resolved',

  -- Add metadata
  ADD COLUMN ticket_number VARCHAR(50) UNIQUE COMMENT 'Human-friendly ticket number (e.g., TFS-12345)',
  ADD COLUMN merged_into INT NULL COMMENT 'If merged, ID of parent ticket',
  ADD COLUMN is_merged BOOLEAN DEFAULT FALSE,

  ADD INDEX idx_assigned_to (assigned_to),
  ADD INDEX idx_last_reply_by (last_reply_by),
  ADD INDEX idx_ticket_number (ticket_number),
  ADD FOREIGN KEY (assigned_to) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (last_reply_by) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (merged_into) REFERENCES email_conversations(id) ON DELETE SET NULL;
```

#### Update `customer_emails`
```sql
ALTER TABLE customer_emails
  ADD COLUMN staff_id INT NULL COMMENT 'Staff member who sent this email (if outbound)',
  ADD COLUMN template_id INT NULL COMMENT 'Template used (if applicable)',
  ADD INDEX idx_staff (staff_id),
  ADD FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL;
```

#### Update `email_attachments`
```sql
-- Already exists, just verify structure
-- file_name, file_size, mime_type, storage_path, is_inline
```

---

## Phase 2: Backend API Enhancements

### New Routes

#### Staff Management (`/api/staff`)
- `GET /api/staff` - List all staff members
- `POST /api/staff` - Create new staff member
- `PUT /api/staff/:id` - Update staff member
- `DELETE /api/staff/:id` - Deactivate staff member

#### Ticket Management (`/api/tickets`)
- `GET /api/tickets` - List tickets with filtering (status, assigned_to, priority, tags)
- `GET /api/tickets/:id` - Get full ticket details
- `PUT /api/tickets/:id/status` - Update ticket status
- `PUT /api/tickets/:id/assign` - Assign ticket to staff
- `POST /api/tickets/:id/note` - Add internal note
- `POST /api/tickets/merge` - Merge multiple tickets
- `GET /api/tickets/stats` - Dashboard stats by status

#### Bulk Actions (`/api/tickets/bulk`)
- `POST /api/tickets/bulk/status` - Update status for multiple tickets
- `POST /api/tickets/bulk/assign` - Bulk assign to staff
- `POST /api/tickets/bulk/tags` - Bulk add/remove tags
- `POST /api/tickets/bulk/priority` - Bulk update priority
- `POST /api/tickets/bulk/template` - Send template to multiple tickets
- `POST /api/tickets/bulk/close` - Bulk close tickets

#### Attachments (`/api/attachments`)
- `POST /api/attachments/upload` - Upload attachment
- `GET /api/attachments/:id/download` - Download attachment
- `DELETE /api/attachments/:id` - Delete attachment

---

## Phase 3: Frontend UI/UX Revamp

### Design System

#### Color Palette (Modern & Professional)
```css
:root {
  /* Status Colors */
  --status-open: #3b82f6;        /* Blue */
  --status-assigned: #8b5cf6;    /* Purple */
  --status-in-progress: #f59e0b; /* Amber */
  --status-pending: #ef4444;     /* Red */
  --status-resolved: #10b981;    /* Green */
  --status-closed: #6b7280;      /* Gray */

  /* Priority Colors */
  --priority-urgent: #dc2626;
  --priority-high: #f59e0b;
  --priority-normal: #3b82f6;
  --priority-low: #6b7280;

  /* UI Colors */
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --bg-hover: #f3f4f6;
  --border-color: #e5e7eb;
  --text-primary: #111827;
  --text-secondary: #6b7280;
}
```

#### Layout Structure
```
┌─────────────────────────────────────────────────────────┐
│ Header: Support Tickets | Stats | New Ticket           │
├─────────────────────────────────────────────────────────┤
│ ┌─────────┬─────────┬─────────┬─────────┬─────────┐   │
│ │  Open   │Assigned │Progress │ Pending │ Closed  │   │
│ │   45    │   12    │   8     │   3     │  1,234  │   │
│ └─────────┴─────────┴─────────┴─────────┴─────────┘   │
├─────────────────────────────────────────────────────────┤
│ [Bulk Actions] [Filters ▾] [Search...]          [Grid] │
├─────────────────────────────────────────────────────────┤
│ ┌───┬────────────┬─────────┬──────┬────────┬─────────┐│
│ │☐ │ Ticket#    │Customer │Status│Assigned│Last Act ││
│ ├───┼────────────┼─────────┼──────┼────────┼─────────┤│
│ │☐ │ TFS-12345  │John Doe │Open  │Sarah   │2h ago   ││
│ │☐ │ TFS-12346  │Jane Sm. │Prog. │Mike    │5m ago   ││
│ └───┴────────────┴─────────┴──────┴────────┴─────────┘│
└─────────────────────────────────────────────────────────┘
```

### Component Structure

#### 1. TicketListView.jsx (Replaces CustomerEmails.jsx)
- Responsive table with checkbox column
- Status badges with colors
- Priority indicators
- Assigned staff avatars
- Clickable rows to open ticket
- Bulk action toolbar (appears when items selected)
- Advanced filters panel

#### 2. TicketDetailView.jsx (Enhanced EmailThread.jsx)
- **Left Sidebar**: Ticket metadata
  - Status dropdown
  - Priority selector
  - Assigned staff selector
  - Tags editor
  - Linked order
  - Customer info
  - Activity timeline

- **Main Content**: Email thread + reply
  - All messages in thread
  - Rich text reply editor
  - Template selector
  - Attachment uploader
  - Internal notes section

- **Right Sidebar** (collapsible):
  - Suggested responses (AI)
  - Related tickets
  - Quick actions

#### 3. RichTextEditor.jsx
**Library Choice**: TipTap (modern, extensible, Vue-like for React)

**Features**:
- Bold, Italic, Underline, Strikethrough
- Headings (H1-H6)
- Bullet lists, Numbered lists
- Links (with URL validation)
- Images (upload + embed)
- Tables
- Code blocks (syntax highlighting)
- Blockquotes
- Horizontal rule
- Text alignment
- Text color & highlight
- @Mentions (for staff)
- Emoji picker
- Undo/Redo
- Keyboard shortcuts

**Template Integration**:
- Dropdown above editor: "Insert Template ▾"
- Shows template list with previews
- Click to insert at cursor or replace all
- Placeholders auto-resolved

#### 4. BulkActionsBar.jsx
Appears when ≥1 ticket selected:
```
[5 tickets selected]  [Close] [Assign to ▾] [Add Tag ▾] [Send Template ▾] [More ▾]
```

Actions:
- Change status
- Assign to staff
- Add/remove tags
- Set priority
- Send template (opens modal)
- Merge tickets
- Export to CSV
- Mark as spam

#### 5. AttachmentManager.jsx
- Drag & drop zone
- File list with preview icons
- Download/delete buttons
- File type validation
- Size limits (10MB per file)
- Supported: PDF, DOC, XLS, images, ZIP

#### 6. TemplateSelector.jsx
- Search templates
- Category filter
- Preview on hover
- Click to insert
- Recently used section

---

## Phase 4: Rich Text Editor Implementation

### TipTap Setup
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-{link,image,table,highlight,text-align,placeholder,mention,emoji}
```

### Extensions Configuration
```javascript
const extensions = [
  StarterKit,
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { class: 'email-link' }
  }),
  Image.configure({
    inline: true,
    allowBase64: true
  }),
  Table.configure({
    resizable: true
  }),
  TextAlign.configure({
    types: ['heading', 'paragraph']
  }),
  Placeholder.configure({
    placeholder: 'Write your reply...'
  }),
  Mention.configure({
    suggestion: {
      items: ({ query }) => staffMembers.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase())
      )
    }
  }),
  // Custom extension for placeholders
  TemplatePlaceholder
]
```

### Toolbar Design
```
[B] [I] [U] [S] | [H1▾] [Color▾] | [•] [1.] [Link] [Image] [Table] | [😀] [Code] | [<] [=] [>] | [Template▾]
```

---

## Phase 5: Attachment System

### Upload Flow
1. User drags file or clicks upload
2. Frontend validates file type/size
3. POST to `/api/attachments/upload` with FormData
4. Backend saves to `/uploads/attachments/{shop_id}/{conversation_id}/{filename}`
5. Database record created in `email_attachments`
6. Returns attachment ID + URL
7. Editor inserts link or inline image

### Storage Strategy
- Use local filesystem for now
- Path: `/uploads/attachments/{shop_id}/{conversation_id}/{timestamp}_{filename}`
- Later: migrate to S3/Cloud Storage

### Security
- Validate MIME types
- Scan for viruses (ClamAV integration optional)
- Generate secure download URLs with expiry
- Check permissions before download

---

## Phase 6: Bulk Actions Implementation

### Selection State Management
```javascript
const [selectedTickets, setSelectedTickets] = useState(new Set());
const [bulkMode, setBulkMode] = useState(false);

const toggleTicket = (id) => {
  const newSet = new Set(selectedTickets);
  newSet.has(id) ? newSet.delete(id) : newSet.add(id);
  setSelectedTickets(newSet);
};

const selectAll = () => {
  setSelectedTickets(new Set(tickets.map(t => t.id)));
};

const clearSelection = () => {
  setSelectedTickets(new Set());
};
```

### Bulk Action Modals

#### Bulk Status Change
```
┌─────────────────────────────┐
│ Update Status for 5 tickets │
├─────────────────────────────┤
│ New Status: [Close ▾]       │
│ Add Note (optional):        │
│ [Text area...]              │
│                             │
│         [Cancel] [Update]   │
└─────────────────────────────┘
```

#### Bulk Template Send
```
┌──────────────────────────────────┐
│ Send Template to 5 customers     │
├──────────────────────────────────┤
│ Template: [Order Confirmation ▾] │
│                                  │
│ Preview:                         │
│ ┌──────────────────────────────┐ │
│ │ Subject: Your order is ready │ │
│ │ Hi {{customer_name}},        │ │
│ │ ...                          │ │
│ └──────────────────────────────┘ │
│                                  │
│ ☑ Mark tickets as "Pending       │
│    Customer" after sending       │
│                                  │
│         [Cancel] [Send to All]   │
└──────────────────────────────────┘
```

---

## Phase 7: Staff Tracking

### Staff Reply Tracking
When staff sends a reply:
1. Record `staff_id` on the `customer_emails` record
2. Update `last_reply_by` on `email_conversations`
3. If first reply, set `first_response_at`
4. Create activity record: `action_type='reply'`

### Display in UI
- Show staff avatar next to each message
- "Replied by John Doe" badge
- Activity timeline: "Sarah assigned this ticket to Mike"

### Staff Selection
Simple dropdown in ticket sidebar:
```
Assigned To: [Unassigned ▾]
             [Sarah Johnson]
             [Mike Chen]
             [Lisa Brown]
```

No complex permissions - all staff can view/reply to all tickets.

---

## Phase 8: Modern CSS & Responsive Design

### Responsive Breakpoints
```css
/* Mobile First */
.ticket-list {
  display: flex;
  flex-direction: column;
}

/* Tablet: 768px+ */
@media (min-width: 768px) {
  .ticket-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  .ticket-list {
    grid-template-columns: 1fr;
  }

  .ticket-detail {
    display: grid;
    grid-template-columns: 250px 1fr 300px;
    gap: 1.5rem;
  }
}

/* Large: 1440px+ */
@media (min-width: 1440px) {
  .ticket-list {
    max-width: 1400px;
    margin: 0 auto;
  }
}
```

### Component Styling

#### Ticket List Table
```css
.ticket-row {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
  transition: background 0.15s;
}

.ticket-row:hover {
  background: var(--bg-hover);
  cursor: pointer;
}

.ticket-row.selected {
  background: #eff6ff; /* Light blue */
  border-left: 3px solid var(--status-open);
}

.ticket-row.unread {
  font-weight: 600;
  background: #fefce8; /* Light yellow tint */
}
```

#### Status Badges
```css
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
}

.status-open {
  background: #dbeafe;
  color: #1e40af;
}

.status-in-progress {
  background: #fef3c7;
  color: #92400e;
}

.status-resolved {
  background: #d1fae5;
  color: #065f46;
}
```

---

## Migration Strategy

### Phase 1: Database (Week 1)
1. Run migration to add staff_users table
2. Seed default staff members
3. Add columns to email_conversations
4. Add ticket_activities table
5. Test with existing data

### Phase 2: Backend APIs (Week 1-2)
1. Build staff management routes
2. Add ticket status routes
3. Implement bulk action endpoints
4. Add attachment upload/download
5. Test all endpoints

### Phase 3: Frontend - Core (Week 2-3)
1. Install TipTap and dependencies
2. Build RichTextEditor component
3. Create new TicketListView layout
4. Add bulk selection logic
5. Implement status badges

### Phase 4: Frontend - Advanced (Week 3-4)
1. Build BulkActionsBar
2. Create TemplateSelector
3. Implement AttachmentManager
4. Add staff tracking UI
5. Polish responsive design

### Phase 5: Testing & Launch (Week 4)
1. End-to-end testing
2. Performance optimization
3. Mobile testing
4. Staff training
5. Production deployment

---

## Technical Stack

### Frontend
- **Framework**: React 18
- **UI Library**: Shopify Polaris (retain for consistency)
- **Rich Text**: TipTap (React)
- **State**: React Hooks + Context
- **Styling**: CSS Modules + Polaris tokens
- **HTTP**: Axios
- **File Upload**: react-dropzone

### Backend
- **Framework**: Express.js
- **Database**: MySQL 8
- **Email**: Zoho Mail API (existing)
- **File Storage**: Local filesystem → S3 (future)
- **AI**: Claude API (existing)

---

## Success Metrics

1. **Response Time**: First response within 2 hours
2. **Resolution Rate**: 90% tickets resolved within 24 hours
3. **Staff Efficiency**: 30+ tickets handled per staff per day
4. **Customer Satisfaction**: Template usage reduces reply time by 50%
5. **Organization**: 100% tickets properly tagged and categorized

---

## Next Steps

Let me know if you approve this plan, and I'll start implementation with:
1. ✅ Database migration script
2. ✅ Staff management API
3. ✅ Updated ticket list UI with status tabs
4. ✅ Rich text editor integration

Ready to build this! 🚀
