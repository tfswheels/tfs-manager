# Phase 2B Complete: Bulk Actions APIs ✅

## Summary

Phase 2B is complete! We've built comprehensive bulk operation APIs that allow managing multiple tickets simultaneously - a critical feature for support teams handling high volumes.

---

## What Was Built

### 🎯 **6 Powerful Bulk Action Endpoints**

All endpoints handle errors gracefully, skip duplicates automatically, and log activities for full audit trail.

---

### **1. POST /api/tickets/bulk/status**
**Bulk update ticket status**

Request Body:
```json
{
  "ticketIds": [1, 2, 3, 4, 5],
  "status": "closed",
  "staffId": 1,
  "note": "Resolved via bulk action"
}
```

Valid statuses: `open`, `assigned`, `in_progress`, `pending_customer`, `resolved`, `closed`, `archived`

Features:
- ✅ Skips tickets that already have the target status
- ✅ Auto-calculates resolution time when closing/resolving
- ✅ Logs activity for each ticket
- ✅ Adds optional note to all affected tickets
- ✅ Returns error details for failed tickets

Response:
```json
{
  "success": true,
  "message": "Updated 5 ticket(s) to 'closed'",
  "updated": 5,
  "total": 5,
  "errors": null
}
```

---

### **2. POST /api/tickets/bulk/assign**
**Bulk assign tickets to staff member**

Request Body:
```json
{
  "ticketIds": [1, 2, 3],
  "assignToId": 2,  // or null to unassign
  "staffId": 1,
  "note": "Assigning to Sarah for review"
}
```

Features:
- ✅ Validates staff exists and is active
- ✅ Auto-changes status from `open` → `assigned` when assigning
- ✅ Skips tickets already assigned to target staff
- ✅ Supports unassigning (set assignToId to null)
- ✅ Logs assignment activity with staff names

Response:
```json
{
  "success": true,
  "message": "Assigned 3 ticket(s)",
  "updated": 3,
  "total": 3,
  "assignedTo": 2,
  "errors": null
}
```

---

### **3. POST /api/tickets/bulk/priority**
**Bulk update ticket priority**

Request Body:
```json
{
  "ticketIds": [1, 2, 3, 4],
  "priority": "urgent",
  "staffId": 1
}
```

Valid priorities: `urgent`, `high`, `normal`, `low`

Features:
- ✅ Validates priority value
- ✅ Skips tickets that already have target priority
- ✅ Logs priority change activity

---

### **4. POST /api/tickets/bulk/tags**
**Bulk add or remove tags**

Request Body (Add Tag):
```json
{
  "ticketIds": [1, 2, 3],
  "action": "add",
  "tag": "refund",
  "staffId": 1
}
```

Request Body (Remove Tag):
```json
{
  "ticketIds": [1, 2, 3],
  "action": "remove",
  "tag": "pending",
  "staffId": 1
}
```

Features:
- ✅ Supports `add` or `remove` actions
- ✅ Manages JSON array of tags per ticket
- ✅ Skips if tag already exists (add) or doesn't exist (remove)
- ✅ Logs tag addition/removal activity

---

### **5. POST /api/tickets/bulk/close**
**Bulk close tickets (convenience endpoint)**

Request Body:
```json
{
  "ticketIds": [1, 2, 3, 4, 5],
  "staffId": 1,
  "note": "Closing resolved tickets from last week"
}
```

Features:
- ✅ Convenience wrapper for bulk status change to "closed"
- ✅ Auto-calculates resolution time for each ticket
- ✅ Skips already-closed tickets
- ✅ Adds optional note to all closed tickets

Response:
```json
{
  "success": true,
  "message": "Closed 5 ticket(s)",
  "updated": 5,
  "total": 5,
  "errors": null
}
```

---

### **6. POST /api/tickets/merge**
**Merge multiple tickets into one**

Request Body:
```json
{
  "sourceTicketIds": [2, 3, 4],
  "targetTicketId": 1,
  "staffId": 1,
  "note": "Duplicate tickets about same order"
}
```

Features:
- ✅ Moves all emails from source tickets to target
- ✅ Moves all activities from source tickets to target
- ✅ Marks source tickets as `is_merged = TRUE`
- ✅ Closes source tickets
- ✅ Updates target ticket's message count and last_message_at
- ✅ Logs merge activity on both source and target
- ✅ Prevents merging ticket into itself

Response:
```json
{
  "success": true,
  "message": "Merged 3 ticket(s) into TFS-1-00001",
  "merged": 3,
  "total": 3,
  "targetTicket": {
    "id": 1,
    "ticket_number": "TFS-1-00001",
    "subject": "Order inquiry - Main thread"
  },
  "errors": null
}
```

**What Happens During Merge:**
1. Source tickets marked as merged & closed
2. All emails moved to target ticket
3. All activities moved to target ticket
4. Target ticket's stats updated (message count, last activity)
5. Merge logged in both source and target activity timelines

---

## Error Handling

All bulk endpoints:
- ✅ Validate input (array not empty, IDs are valid)
- ✅ Continue processing even if some tickets fail
- ✅ Return detailed error info for failed tickets
- ✅ Return count of successful operations

Example Error Response:
```json
{
  "success": true,
  "message": "Updated 3 ticket(s) to 'closed'",
  "updated": 3,
  "total": 5,
  "errors": [
    { "ticketId": 4, "error": "Ticket not found" },
    { "ticketId": 5, "error": "Ticket not found" }
  ]
}
```

---

## Activity Logging

Every bulk operation logs activities for audit trail:

| Operation | Activity Type | What's Logged |
|-----------|---------------|---------------|
| Bulk Status | `status_change` | old_status → new_status |
| Bulk Assign | `assignment` | old_staff → new_staff |
| Bulk Priority | `priority_change` | old_priority → new_priority |
| Bulk Tag Add | `tag_add` | tag name |
| Bulk Tag Remove | `tag_remove` | tag name |
| Bulk Close | `status_change` | old_status → closed |
| Merge | `merge` | source_id → target_id |

Plus optional notes attached to each operation!

---

## Files Modified

- `server/src/routes/tickets.js` - Added 6 bulk endpoints (+585 lines)

---

## Testing Bulk Operations

### Bulk Status Change
```bash
curl -X POST "http://localhost:3000/api/tickets/bulk/status" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketIds": [1, 2, 3],
    "status": "in_progress",
    "staffId": 1,
    "note": "Working on these"
  }'
```

### Bulk Assignment
```bash
curl -X POST "http://localhost:3000/api/tickets/bulk/assign" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketIds": [1, 2, 3, 4, 5],
    "assignToId": 2,
    "staffId": 1
  }'
```

### Bulk Add Tags
```bash
curl -X POST "http://localhost:3000/api/tickets/bulk/tags" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketIds": [1, 2, 3],
    "action": "add",
    "tag": "urgent-review",
    "staffId": 1
  }'
```

### Bulk Close
```bash
curl -X POST "http://localhost:3000/api/tickets/bulk/close" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketIds": [10, 11, 12],
    "staffId": 1,
    "note": "Batch closure for resolved tickets"
  }'
```

### Merge Tickets
```bash
curl -X POST "http://localhost:3000/api/tickets/merge" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceTicketIds": [2, 3],
    "targetTicketId": 1,
    "staffId": 1,
    "note": "Duplicate tickets about same order #1234"
  }'
```

---

## Use Cases

### **1. End of Day Cleanup**
```javascript
// Close all resolved tickets older than 24 hours
const resolvedTickets = await fetch('/api/tickets?status=resolved&...');
await fetch('/api/tickets/bulk/close', {
  body: JSON.stringify({
    ticketIds: resolvedTickets.map(t => t.id),
    staffId: currentStaff.id,
    note: 'End of day batch closure'
  })
});
```

### **2. Team Reassignment**
```javascript
// Reassign all of Mike's tickets to Sarah (when Mike is out)
const mikesTickets = await fetch('/api/tickets?assignedTo=3');
await fetch('/api/tickets/bulk/assign', {
  body: JSON.stringify({
    ticketIds: mikesTickets.map(t => t.id),
    assignToId: 5, // Sarah
    staffId: 1,
    note: 'Mike is out - reassigning to Sarah'
  })
});
```

### **3. Priority Escalation**
```javascript
// Mark all unassigned tickets older than 48 hours as urgent
const oldUnassigned = await fetch('/api/tickets?assignedTo=unassigned&...');
await fetch('/api/tickets/bulk/priority', {
  body: JSON.stringify({
    ticketIds: oldUnassigned.map(t => t.id),
    priority: 'urgent',
    staffId: 1
  })
});
```

### **4. Campaign Tagging**
```javascript
// Tag all tickets from a specific email campaign
const campaignTickets = await fetch('/api/tickets?category=Product%20Question');
await fetch('/api/tickets/bulk/tags', {
  body: JSON.stringify({
    ticketIds: campaignTickets.map(t => t.id),
    action: 'add',
    tag: 'summer-sale-2026',
    staffId: 1
  })
});
```

### **5. Duplicate Consolidation**
```javascript
// Merge duplicate tickets about the same order
await fetch('/api/tickets/merge', {
  body: JSON.stringify({
    sourceTicketIds: [45, 46, 47],
    targetTicketId: 44,
    staffId: 1,
    note: 'Duplicate tickets for order #12345'
  })
});
```

---

## Performance Considerations

**Current Implementation:**
- Operations are sequential (one ticket at a time)
- Good for reliability and detailed error tracking
- Suitable for batches up to ~100 tickets

**For Larger Batches (Future Enhancement):**
- Implement batch database updates
- Add job queue for async processing
- Return job ID and provide status endpoint

---

## API Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tickets/bulk/status` | POST | Change status for multiple tickets |
| `/api/tickets/bulk/assign` | POST | Assign multiple tickets to staff |
| `/api/tickets/bulk/priority` | POST | Update priority for multiple tickets |
| `/api/tickets/bulk/tags` | POST | Add/remove tags for multiple tickets |
| `/api/tickets/bulk/close` | POST | Close multiple tickets |
| `/api/tickets/merge` | POST | Merge tickets into one |

---

## Phase 2B Complete! 🎉

**Total API Endpoints Built:**
- Phase 2A: 9 endpoints (single ticket operations)
- Phase 2B: 6 endpoints (bulk operations)
- **Total: 15 comprehensive ticket management endpoints**

**Ready for Phase 3: Frontend UI!** 🚀

Next we'll build:
- Ticket list with status tabs
- Bulk selection checkboxes
- Bulk actions toolbar
- Modern, responsive design
- Activity timeline display

---

**All backend infrastructure is complete. Time to build the beautiful UI!**
