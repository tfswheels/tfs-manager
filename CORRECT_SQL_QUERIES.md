# Correct SQL Queries for Zoho OAuth

## The tokens are in `shop_settings` table, NOT `zoho_oauth_tokens`

### 1. View Current Zoho OAuth Tokens

```sql
SELECT
  shop_id,
  zoho_client_id,
  LEFT(zoho_client_secret, 20) as client_secret_preview,
  LEFT(zoho_refresh_token, 30) as refresh_token_preview,
  LEFT(zoho_access_token, 30) as access_token_preview,
  zoho_token_expires_at,
  email_from_name
FROM shop_settings
WHERE shop_id = 1;
```

### 2. Delete Zoho OAuth Tokens (for fresh reconnection)

```sql
UPDATE shop_settings
SET
  zoho_refresh_token = NULL,
  zoho_access_token = NULL,
  zoho_token_expires_at = NULL
WHERE shop_id = 1;
```

### 3. View All Shop Settings (to verify)

```sql
SELECT * FROM shop_settings WHERE shop_id = 1;
```

### 4. Check If Tokens Exist

```sql
SELECT
  shop_id,
  zoho_refresh_token IS NOT NULL as has_refresh_token,
  zoho_access_token IS NOT NULL as has_access_token,
  zoho_token_expires_at,
  CASE
    WHEN zoho_token_expires_at IS NULL THEN 'No expiration set'
    WHEN zoho_token_expires_at < NOW() THEN 'EXPIRED'
    ELSE 'Valid'
  END as token_status
FROM shop_settings
WHERE shop_id = 1;
```

---

## To Clear Tokens and Reconnect:

**Step 1:** Clear the tokens
```sql
UPDATE shop_settings
SET
  zoho_refresh_token = NULL,
  zoho_access_token = NULL,
  zoho_token_expires_at = NULL
WHERE shop_id = 1;
```

**Step 2:** Visit OAuth URL
```
https://tfs-manager-server-production.up.railway.app/auth/zoho/authorize
```

---

## Quick Commands for Terminal

If you want to run from command line (avoids MySQL auth plugin issues):

```bash
# View tokens
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "
SELECT shop_id,
       zoho_refresh_token IS NOT NULL as has_refresh,
       zoho_access_token IS NOT NULL as has_access,
       zoho_token_expires_at
FROM shop_settings WHERE shop_id = 1;"

# Clear tokens
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "
UPDATE shop_settings
SET zoho_refresh_token = NULL,
    zoho_access_token = NULL,
    zoho_token_expires_at = NULL
WHERE shop_id = 1;"
```

---

## Note About Table Name

The code used to reference `zoho_oauth_tokens` in documentation/examples, but the **actual implementation** stores everything in `shop_settings` table with these columns:

- `zoho_client_id` - OAuth client ID
- `zoho_client_secret` - OAuth client secret
- `zoho_refresh_token` - Refresh token (long-lived)
- `zoho_access_token` - Access token (expires)
- `zoho_token_expires_at` - Token expiration timestamp
- `email_from_name` - Display name for emails
- `email_signature` - HTML email signature
- `email_signature_plain` - Plain text signature

This is a simpler design - one row per shop with all settings together.
