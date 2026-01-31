# Database Schema Reference

**CRITICAL: Always check this file before writing SQL queries to avoid column name errors!**

Last verified: 2026-01-30

---

## email_delivery_stats

**Purpose**: Track email opens, clicks, bounces, and engagement metrics.

### Columns

```sql
- id (int, PRIMARY KEY, auto_increment)
- email_log_id (int, NOT NULL, INDEXED) - FK to email_logs table
- opened_at (timestamp, NULL, INDEXED) - First open timestamp
- open_count (int, DEFAULT 0) - Number of times opened
- clicked_at (timestamp, NULL) - First click timestamp
- click_count (int, DEFAULT 0) - Number of link clicks
- bounced_at (timestamp, NULL, INDEXED)
- bounce_type (varchar(50), NULL)
- bounce_reason (text, NULL)
- spam_reported_at (timestamp, NULL, INDEXED)
- unsubscribed_at (timestamp, NULL)
- user_agent (text, NULL)
- ip_address (varchar(45), NULL)
- location (varchar(255), NULL)
- tracking_pixel_url (varchar(500), NULL)
- click_tracking_enabled (tinyint(1), DEFAULT 1)
- created_at (timestamp, DEFAULT CURRENT_TIMESTAMP)
- updated_at (timestamp, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)
```

### ⚠️ Columns That DO NOT Exist

**NEVER use these columns in queries - they don't exist!**

- ❌ `last_opened_at` (use `opened_at` instead - it stores first open only)
- ❌ `last_clicked_at` (use `clicked_at` instead - it stores first click only)
- ❌ `last_clicked_url` (not tracked - only count is stored)

### Usage Notes

**Email Opens:**
- `opened_at` = timestamp of FIRST open
- `open_count` = total number of opens
- Increment `open_count` on subsequent opens, don't update `opened_at`

**Link Clicks:**
- `clicked_at` = timestamp of FIRST click
- `click_count` = total number of clicks
- Increment `click_count` on subsequent clicks, don't update `clicked_at`

### Example Queries

**Insert first open:**
```sql
INSERT INTO email_delivery_stats (
  email_log_id, opened_at, open_count, user_agent, ip_address
) VALUES (?, NOW(), 1, ?, ?)
```

**Update subsequent opens:**
```sql
UPDATE email_delivery_stats
SET open_count = open_count + 1,
    user_agent = ?,
    ip_address = ?
WHERE email_log_id = ?
```

**Insert first click:**
```sql
INSERT INTO email_delivery_stats (
  email_log_id, clicked_at, click_count, user_agent, ip_address
) VALUES (?, NOW(), 1, ?, ?)
```

**Update subsequent clicks:**
```sql
UPDATE email_delivery_stats
SET clicked_at = COALESCE(clicked_at, NOW()),
    click_count = click_count + 1,
    user_agent = ?,
    ip_address = ?
WHERE email_log_id = ?
```

---

## How to Verify Schema

**Before making database changes, always verify the current schema:**

1. Create a script:
```javascript
import db from './src/config/database.js';
const [columns] = await db.execute('DESCRIBE table_name');
console.table(columns);
process.exit(0);
```

2. Run it:
```bash
node verify_schema.mjs
```

3. Update this documentation if schema has changed

---

## Common Pitfalls

1. ❌ **Assuming columns exist** - Always check schema first
2. ❌ **Using `last_*` columns** - They don't exist in this table
3. ❌ **Not checking error messages** - SQL errors usually indicate wrong column names
4. ❌ **Copy-pasting queries** - Verify column names match actual schema

✅ **Always verify column names against this reference before writing queries!**

---

**This documentation was created after fixing SQL errors in webhooks.js (2026-01-30)**
