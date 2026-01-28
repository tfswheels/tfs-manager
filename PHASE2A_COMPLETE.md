# Phase 2A Complete: Ticket Status Management APIs ✅

## Summary

Phase 2A is complete! We've built a comprehensive backend API for managing tickets, including status changes, staff assignment, internal notes, priority management, and activity tracking.

---

## What Was Built

### 1. ✅ Activity Tracking Service

**File:** `server/src/services/ticketActivities.js`

**Core Functions:**
- `logActivity()` - Generic activity logger with metadata support
- `logStatusChange()` - Log status transitions
- `logAssignment()` - Log ticket assignments
- `logReply()` - Log email replies
- `logNote()` - Log internal notes
- `logPriorityChange()` - Log priority changes
- `logTagAdd()` / `logTagRemove()` - Log tag modifications
- `logMerge()` - Log ticket merges
- `logOrderLink()` - Log order associations

**Timeline Functions:**
- `getActivityTimeline(conversationId, limit)` - Get full activity history for a ticket
- `getActivityCount(conversationId)` - Count activities
- `getRecentActivities(shopId, limit)` - Get recent activities across all tickets (dashboard)

**Features:**
- Automatic staff name resolution
- Metadata support (JSON)
- Email ID linking
- Timestamp tracking

---

### 2. ✅ Ticket Management API

**File:** `server/src/routes/tickets.js`

#### **Core Ticket Endpoints:**

##### `GET /api/tickets`
**List all tickets with advanced filtering**

Query Parameters:
- `shop` - Shop domain (required)
- `status` - Filter by status (open, assigned, in_progress, pending_customer, resolved, closed, archived)
- `assignedTo` - Filter by staff ID or "unassigned"
- `priority` - Filter by priority (urgent, high, normal, low)
- `category` - Filter by category
- `unreadOnly` - Show only unread tickets (boolean)
- `limit` - Results per page (default: 50)
- `offset` - Pagination offset (default: 0)

Returns:
```json
{
  "success": true,
  "tickets": [...],
  "total": 550,
  "limit": 50,
  "offset": 0
}
```

Each ticket includes:
- Full ticket details
- Assigned staff name & avatar
- Last reply staff name
- Linked order info
- Parsed JSON fields (participants, tags)

---

##### `GET /api/tickets/:id`
**Get full ticket details with timeline**

Returns:
```json
{
  "success": true,
  "ticket": {...},
  "messages": [...],  // All email messages
  "activities": [...]  // Full activity timeline
}
```

---

##### `PUT /api/tickets/:id/status`
**Change ticket status**

Request Body:
```json
{
  "status": "in_progress",
  "staffId": 1,
  "note": "Optional note about status change"
}
```

Valid statuses: `open`, `assigned`, `in_progress`, `pending_customer`, `resolved`, `closed`, `archived`

Features:
- Prevents duplicate status changes
- Auto-calculates resolution time when resolving/closing
- Logs activity
- Supports optional note

---

##### `PUT /api/tickets/:id/assign`
**Assign ticket to staff member**

Request Body:
```json
{
  "assignToId": 1,  // Staff ID or null to unassign
  "staffId": 1,     // Who is making the assignment
  "note": "Optional note"
}
```

Features:
- Auto-changes status from `open` → `assigned` when assigning
- Prevents duplicate assignments
- Validates staff exists and is active
- Logs activity with staff names

---

##### `POST /api/tickets/:id/note`
**Add internal note to ticket**

Request Body:
```json
{
  "staffId": 1,
  "note": "Customer called, investigating the issue..."
}
```

Features:
- Creates internal email record (`is_internal_note = TRUE`)
- Logs as activity
- Note is NOT sent to customer
- Staff name attached

---

##### `PUT /api/tickets/:id/priority`
**Change ticket priority**

Request Body:
```json
{
  "priority": "high",
  "staffId": 1
}
```

Valid priorities: `urgent`, `high`, `normal`, `low`

Features:
- Prevents duplicate priority changes
- Logs activity

---

##### `GET /api/tickets/:id/activities`
**Get activity timeline for a ticket**

Query Parameters:
- `limit` - Max activities to return (default: 100)

Returns full activity history with staff info.

---

##### `GET /api/tickets/stats/summary`
**Get ticket statistics**

Query Parameters:
- `shop` - Shop domain

Returns:
```json
{
  "success": true,
  "stats": {
    "total": 550,
    "unassigned": 450,
    "urgent": 12,
    "has_unread": 200,
    "avg_resolution_minutes": 45,
    "byStatus": {
      "open": { "count": 400, "unread": 150 },
      "in_progress": { "count": 50, "unread": 20 },
      ...
    },
    "byCategory": [
      { "category": "Order Inquiry", "count": 120 },
      ...
    ]
  }
}
```

---

##### `GET /api/tickets/activities/recent`
**Get recent activities across all tickets (dashboard)**

Query Parameters:
- `shop` - Shop domain
- `limit` - Max activities (default: 50)

Returns recent activity stream with ticket context.

---

## Activity Types Supported

| Type | Description | Example |
|------|-------------|---------|
| `status_change` | Status transition | open → in_progress |
| `assignment` | Staff assignment change | Unassigned → John Doe |
| `reply` | Email reply sent/received | Staff replied to customer |
| `note` | Internal note added | "Customer called..." |
| `priority_change` | Priority updated | normal → high |
| `tag_add` | Tag added | Added "refund" tag |
| `tag_remove` | Tag removed | Removed "pending" tag |
| `merge` | Ticket merged | Merged into #123 |
| `link_order` | Order linked | Linked to order #1234 |

---

## Files Created

### New Files:
- `server/src/services/ticketActivities.js` - Activity tracking service
- `server/src/routes/tickets.js` - Ticket management API
- `server/scripts/test_ticket_apis.js` - Comprehensive test suite

### Modified Files:
- `server/src/index.js` - Registered `/api/tickets` routes

---

## Testing the APIs

### Prerequisites
1. Start the server: `npm start` or `node src/index.js`
2. Ensure migration 012 has been run
3. Have at least one staff member in database

### Run Test Suite
```bash
node server/scripts/test_ticket_apis.js
```

The test suite performs 13 comprehensive tests:
1. ✅ Get ticket statistics
2. ✅ Get tickets list
3. ✅ Get single ticket details
4. ✅ Get staff members
5. ✅ Change ticket status
6. ✅ Assign ticket to staff
7. ✅ Add internal note
8. ✅ Change priority
9. ✅ Get activity timeline
10. ✅ Filter tickets by status
11. ✅ Filter tickets by assigned staff
12. ✅ Get recent activities (dashboard)
13. ✅ Close/resolve ticket

### Manual Testing Examples

#### Get All Open Tickets
```bash
curl "http://localhost:3000/api/tickets?shop=2f3d7a-2.myshopify.com&status=open&limit=10"
```

#### Change Ticket Status
```bash
curl -X PUT "http://localhost:3000/api/tickets/1/status" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in_progress",
    "staffId": 1,
    "note": "Started investigating"
  }'
```

#### Assign Ticket
```bash
curl -X PUT "http://localhost:3000/api/tickets/1/assign" \
  -H "Content-Type: application/json" \
  -d '{
    "assignToId": 1,
    "staffId": 1
  }'
```

#### Add Internal Note
```bash
curl -X POST "http://localhost:3000/api/tickets/1/note" \
  -H "Content-Type: application/json" \
  -d '{
    "staffId": 1,
    "note": "Customer called, checking inventory..."
  }'
```

#### Get Ticket Stats
```bash
curl "http://localhost:3000/api/tickets/stats/summary?shop=2f3d7a-2.myshopify.com"
```

---

## API Response Examples

### Ticket List Response
```json
{
  "success": true,
  "tickets": [
    {
      "id": 1,
      "ticket_number": "TFS-1-00001",
      "subject": "Order inquiry",
      "status": "in_progress",
      "priority": "normal",
      "category": "Order Inquiry",
      "assigned_to": 1,
      "assigned_to_name": "John Doe",
      "assigned_to_avatar": "https://...",
      "customer_name": "Jane Smith",
      "customer_email": "jane@example.com",
      "unread_count": 2,
      "message_count": 5,
      "last_message_at": "2026-01-28T10:30:00.000Z",
      "shopify_order_id": "12345678",
      "order_number": "1234"
    }
  ],
  "total": 550,
  "limit": 50,
  "offset": 0
}
```

### Activity Timeline Response
```json
{
  "success": true,
  "activities": [
    {
      "id": 45,
      "conversation_id": 1,
      "staff_id": 1,
      "action_type": "status_change",
      "from_value": "open",
      "to_value": "in_progress",
      "note": null,
      "metadata": null,
      "email_id": null,
      "created_at": "2026-01-28T10:30:00.000Z",
      "staff_name": "John Doe",
      "staff_email": "john@example.com",
      "staff_avatar": "https://...",
      "staff_role": "agent"
    },
    {
      "id": 44,
      "action_type": "assignment",
      "from_value": "Unassigned",
      "to_value": "John Doe",
      "metadata": {
        "old_assignee_id": null,
        "new_assignee_id": 1
      },
      ...
    }
  ],
  "total": 12
}
```

---

## Database Changes

All activity tracking is stored in the `ticket_activities` table created in Phase 1.

**New Activity Records Created:**
- Status changes
- Assignments
- Notes
- Priority changes

**New Email Records Created:**
- Internal notes (with `is_internal_note = TRUE`)

---

## Next Steps (Phase 2B - Bulk Actions)

### Bulk Operations API:
1. **POST /api/tickets/bulk/status** - Update status for multiple tickets
2. **POST /api/tickets/bulk/assign** - Bulk assign to staff
3. **POST /api/tickets/bulk/tags** - Bulk add/remove tags
4. **POST /api/tickets/bulk/priority** - Bulk update priority
5. **POST /api/tickets/bulk/template** - Send template to multiple tickets
6. **POST /api/tickets/bulk/close** - Bulk close tickets
7. **POST /api/tickets/merge** - Merge tickets

### Enhanced Features:
- Tag management endpoints
- Ticket merging
- Category management
- SLA tracking
- Auto-assignment rules

---

## Phase 2A Complete! 🎉

The ticket management backend is fully functional! You can now:
- ✅ List and filter tickets by status, staff, priority, category
- ✅ Change ticket statuses with validation
- ✅ Assign/unassign tickets to staff
- ✅ Add internal notes (not sent to customers)
- ✅ Change ticket priority
- ✅ View full activity timeline
- ✅ Get ticket statistics
- ✅ Track resolution times

**Ready for Phase 2B (Bulk Actions) or Phase 3 (Frontend UI)!** 🚀
