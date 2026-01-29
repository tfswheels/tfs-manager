# Database Connection Guide

## ⚠️ CRITICAL: External Database Configuration

### Database Location
**The TFS Manager database is EXTERNAL and hosted remotely on Google Cloud SQL.**

- ❌ NOT on Railway
- ❌ NOT on localhost
- ❌ NOT using default credentials
- ✅ Remote MySQL database on Google Cloud

### Connection Credentials
**ALWAYS read credentials from `server/.env` file:**

```bash
DB_HOST=34.67.162.140
DB_USER=tfs
DB_PASSWORD=[XtlAUU5;"1Ti*Ry
DB_NAME=tfs-manager
DB_PORT=3306
```

### Direct MySQL Access

**To connect from command line:**
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager
```

**To run a query directly:**
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "YOUR_QUERY_HERE"
```

**Example:**
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "SHOW TABLES;"
```

### For Claude Code Sessions

**NEVER assume credentials. ALWAYS:**

1. **Read `server/.env` file first** to get actual credentials
2. **Connect to the REMOTE database** at 34.67.162.140
3. **Test queries directly** before writing application code
4. **Never use localhost, root, or guessed passwords**

### Python MySQL Code

**Before deploying any Python code that uses MySQL:**

1. ✅ **Test the connection directly** with the exact credentials from .env
2. ✅ **Run test SELECT queries** to verify access
3. ✅ **Verify the connection string** matches the .env credentials exactly
4. ✅ **Test with a simple script** before integrating into main code

**Python connection example:**
```python
import mysql.connector
from dotenv import load_dotenv
import os

load_dotenv('server/.env')

# Test connection
connection = mysql.connector.connect(
    host=os.getenv('DB_HOST'),        # 34.67.162.140
    user=os.getenv('DB_USER'),        # tfs
    password=os.getenv('DB_PASSWORD'), # [XtlAUU5;"1Ti*Ry
    database=os.getenv('DB_NAME')     # tfs-manager
)

# Test query
cursor = connection.cursor()
cursor.execute("SELECT COUNT(*) FROM customer_emails;")
result = cursor.fetchone()
print(f"✅ Connected! Found {result[0]} emails")
cursor.close()
connection.close()
```

### Node.js MySQL Code

**The existing connection is in `server/src/config/database.js`** and uses these credentials correctly:

```javascript
const pool = mysql.createPool({
  host: process.env.DB_HOST,        // 34.67.162.140
  user: process.env.DB_USER,        // tfs
  password: process.env.DB_PASSWORD, // [XtlAUU5;"1Ti*Ry
  database: process.env.DB_NAME,    // tfs-manager
  port: process.env.DB_PORT || 3306
});
```

### Common Mistakes to Avoid

❌ **Don't use:** `mysql -u root -p'somepassword' tfs_manager`
- Wrong user (root instead of tfs)
- Wrong host (assumes localhost)
- Wrong password (guessed)

✅ **Do use:** `mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager`
- Correct user (tfs)
- Correct host (34.67.162.140)
- Correct password (from .env)

### Database Schema Access

To view table structures:
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "DESCRIBE customer_emails;"
```

To see all tables:
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "SHOW TABLES;"
```

### Security Note

- The password contains special characters: `[XtlAUU5;"1Ti*Ry`
- Always use single quotes around the password in bash commands
- The database is externally accessible, ensure firewall rules are configured properly

---

**Last Updated:** 2026-01-28
**Database Host:** Google Cloud SQL (34.67.162.140)
**Connection Type:** Direct TCP/IP (port 3306)
