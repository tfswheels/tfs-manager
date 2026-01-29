# Claude Code Session Instructions

## ⚠️ CRITICAL: localStorage Routing (DO NOT REMOVE)

**THIS HAS BEEN BROKEN AND FIXED 3 TIMES - DO NOT BREAK IT AGAIN!**

### The Problem

The TFS Manager frontend is embedded in a Shopify admin iframe. When users refresh the page, Shopify strips URL parameters and resets the iframe to `/`, causing users to lose their place and get sent back to the Orders page.

### The Solution (admin/src/App.jsx)

The `RouteManager` component uses **localStorage** to persist the last visited path:

1. **When route changes**: Store path in `localStorage.setItem('tfs_last_path', pathname)`
2. **On app mount**: If at `/` but localStorage has a saved path, navigate to it
3. **localStorage survives**: Shopify iframe refresh, URL param stripping, etc.

### ⛔ NEVER DO THIS:
- ❌ Remove the `RouteManager` component
- ❌ Remove the localStorage logic from `App.jsx`
- ❌ Try to use URL parameters instead (Shopify strips them)
- ❌ Try to use `window.history.replaceState` on parent window (doesn't work in iframe)
- ❌ Assume default React Router behavior works in Shopify embedded apps

### ✅ ALWAYS DO THIS:
- ✅ Keep the `RouteManager` wrapper around `<Layout>` in `App.jsx`
- ✅ Keep the localStorage get/set logic intact
- ✅ Test that refreshing on `/products` keeps you on `/products`, not Orders
- ✅ Read the inline comments in `App.jsx` before modifying routing

**Location:** `admin/src/App.jsx` - Look for `RouteManager` component
**Console logs:** Look for 🔵 emoji logs when testing

---

## ⚠️ CRITICAL: Database Connection

**READ THIS FIRST BEFORE ANY DATABASE OPERATIONS:**

### External Database - NOT Local, NOT on Railway

The TFS Manager database is **EXTERNAL** and hosted on **Google Cloud SQL**.

**� ALWAYS read credentials from `server/.env` and connect to the remote database.**

**Connection Command:**
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "YOUR_QUERY"
```

**=� Full details:** See `DATABASE_CONNECTION.md` for complete instructions.

### Key Rules for Database Access

1.  **ALWAYS read `server/.env`** to get current credentials
2.  **Connect to remote host** (34.67.162.140)
3.  **Use correct credentials** (user: tfs, password from .env)
4.  **Test Python MySQL code** with direct connection before deployment
5. L **NEVER assume localhost, root, or default passwords**
6. L **NEVER guess credentials**

---

## Project Overview

**TFS Manager** is a Shopify app for managing wheel orders, inventory, customer communication, and support tickets.

### Technology Stack
- **Frontend:** React + Vite + Shopify Polaris
- **Backend:** Node.js + Express
- **Database:** MySQL (Google Cloud SQL - External)
- **Deployment:** Railway (backend), Vercel (frontend)
- **Email:** Zoho Mail API
- **AI:** Claude (Anthropic API)

### Key Features
- Order processing with SDW automation
- Email/ticket management system
- Inventory scraping (CWO, ATD)
- AI-powered email summaries and replies
- Rich text email editing with TipTap

---

## Important Files to Review

### Configuration
- `server/.env` - **Database credentials and API keys**
- `DATABASE_CONNECTION.md` - **How to connect to external database**
- `DATABASE_SETUP.md` - Database schema and setup

### Documentation
- `README.md` - Project overview
- `DEPLOYMENT_GUIDE.md` - Deployment instructions
- `EMAIL_SYSTEM_IMPROVEMENTS.md` - Email system changes
- `TICKETING_COMPLETE_SUMMARY.md` - Ticketing system overview

### Backend Core
- `server/src/index.js` - Main Express server
- `server/src/config/database.js` - MySQL connection pool
- `server/src/services/emailInboxSync.js` - Email sync service
- `server/src/services/zohoMailEnhanced.js` - Zoho API integration
- `server/src/services/claudeAI.js` - AI integration

### Frontend Core
- `admin/src/App.jsx` - React Router setup
- `admin/src/pages/SupportTickets.jsx` - Main ticket list
- `admin/src/pages/EmailThread.jsx` - Email thread view
- `admin/src/components/RichTextEditor.jsx` - TipTap editor

---

## Database Access Examples

### View customer emails table structure:
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "DESCRIBE customer_emails;"
```

### Count emails with attachments:
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "SELECT COUNT(*) FROM customer_emails WHERE has_attachments = 1;"
```

### View all tables:
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "SHOW TABLES;"
```

---

## Development Workflow

### Before Making Changes
1. Read relevant documentation files
2. Understand existing architecture
3. Test database connections if needed
4. Review recent git commits for context

### When Writing Code
1. Use TodoWrite to track tasks
2. Follow existing code patterns
3. Test locally before deployment
4. Update documentation if architecture changes

### For Python/MySQL Code
1. **Test connection directly first** using credentials from .env
2. Run test queries to verify access
3. Only deploy after successful testing
4. See `DATABASE_CONNECTION.md` for examples

---

## Common Pitfalls to Avoid

L Assuming database is on localhost
L Assuming database is on Railway with server
L Guessing database credentials
L Using root user or default passwords
L Skipping database connection testing

 Always read server/.env for credentials
 Always connect to 34.67.162.140
 Always test Python MySQL connections first
 Always verify queries work before deploying

---

**Last Updated:** 2026-01-29
