# Database Setup Instructions

## Creating the New Database Instance

TFS Manager uses a **separate database instance** (`tfs-manager`) to keep it isolated from the existing TFS Wheels App database (`tfs-db`).

---

## Step 1: Connect to Google Cloud SQL

Using your preferred MySQL client (MySQL Workbench, phpMyAdmin, or command line):

```bash
mysql -h 34.67.162.140 -u tfs -p
```

Enter your password when prompted.

---

## Step 2: Create the New Database

```sql
CREATE DATABASE `tfs-manager` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Verify it was created:

```sql
SHOW DATABASES;
```

You should see both:
- `tfs-db` (existing - for TFS Wheels App)
- `tfs-manager` (new - for TFS Manager)

---

## Step 3: Grant Permissions

Make sure the `tfs` user has access to the new database:

```sql
GRANT ALL PRIVILEGES ON `tfs-manager`.* TO 'tfs'@'%';
FLUSH PRIVILEGES;
```

---

## Step 4: Run Migrations

From your local machine, with the server `.env` configured:

```bash
cd server
npm install
npm run migrate
```

This will create all the necessary tables in the `tfs-manager` database.

---

## Tables Created

The migration will create these tables in `tfs-manager`:

- `shops` - Shopify shop configuration
- `orders` - Order records from Shopify
- `order_items` - Line items from orders
- `products` - Product catalog from Shopify
- `email_templates` - Email templates for customer communication
- `email_logs` - Sent email tracking
- `processing_logs` - Order processing history (SDW, selective)
- `scraping_jobs` - Inventory scraping job tracking
- `shop_settings` - App configuration settings
- `gdpr_requests` - GDPR compliance audit log

---

## Verifying the Setup

After running migrations, verify the tables:

```sql
USE `tfs-manager`;
SHOW TABLES;
```

Check that default data was inserted:

```sql
SELECT * FROM shops;
SELECT * FROM email_templates;
SELECT * FROM shop_settings;
```

---

## Database Separation

**Benefits of using a separate database:**

- ✅ Existing TFS Wheels App (`tfs-db`) remains untouched
- ✅ Clean separation of concerns
- ✅ Independent schema evolution
- ✅ Easier to manage and backup
- ✅ No risk of data conflicts

**Connection Details:**

- **Host:** 34.67.162.140
- **User:** tfs
- **TFS Wheels App DB:** tfs-db
- **TFS Manager DB:** tfs-manager
- **Port:** 3306

---

## Troubleshooting

### Can't connect to database
- Check firewall/IP whitelist includes your IP
- Verify credentials are correct
- Ensure Google Cloud SQL instance is running

### Permission denied
- Run the GRANT command from Step 3
- Verify user 'tfs' exists: `SELECT User, Host FROM mysql.user;`

### Migration fails
- Ensure database `tfs-manager` exists
- Check `.env` file has correct database name
- Verify all environment variables are set

---

**Ready?** Create the database, then run migrations!
