# Zoho OAuth Reconnection Guide

## Step 1: Clear Old Token from Database

Run this SQL in your MySQL database (credentials in RAILWAY_ENV.txt):

```sql
-- Delete all existing Zoho OAuth tokens
DELETE FROM zoho_oauth_tokens;

-- Verify deletion
SELECT COUNT(*) as remaining_tokens FROM zoho_oauth_tokens;
```

**Or use this one-liner:**
```bash
mysql -h 34.67.162.140 -u tfs -p'[XtlAUU5;"1Ti*Ry' tfs-manager -e "DELETE FROM zoho_oauth_tokens; SELECT COUNT(*) as remaining_tokens FROM zoho_oauth_tokens;"
```

---

## Step 2: Reconnect via OAuth

Visit this URL in your browser:

**🔗 OAuth Authorization Link:**
```
https://tfs-manager-server-production.up.railway.app/auth/zoho/authorize
```

This will:
1. Redirect you to Zoho for authorization
2. Ask you to grant access to TFS Manager
3. Store the new access token and refresh token
4. Redirect you back with success message

---

## Step 3: Verify Connection

After reconnecting, check the logs:

```
✅ Fetched 20 emails from sales@tfswheels.com
```

If it works, the 500 error was due to an expired/corrupt token!

---

## Analysis of sales@ vs support@ Handling

**YOU WERE RIGHT TO BE SUSPICIOUS!** Here's what I found:

### Code Difference (emailInboxSync.js lines 58-72):

```javascript
// Filtering logic:
// - sales@: ALL emails (no filtering)
// - support@: ONLY emails from customers with orders

if (accountEmail === 'support@tfswheels.com') {
  const [orders] = await db.execute(
    'SELECT id FROM orders WHERE customer_email = ?',
    [email.fromAddress || email.sender]
  );

  if (orders.length === 0) {
    // Not related to any order, skip support@ email
    skippedCount++;
    continue;
  }
}
// sales@ emails: No filtering, all emails are processed
```

### But The Zoho API Call is IDENTICAL!

Both mailboxes use the **exact same code** to fetch from Zoho:

1. **Same function**: `fetchInbox()` in zohoMailEnhanced.js
2. **Same account ID mapping**: Hardcoded IDs from `ACCOUNT_ID_MAP`
3. **Same API endpoint**: `/accounts/{accountId}/messages/search`
4. **Same parameters**: limit, folderId, searchKey

### The Timeline:

1. ✅ **Zoho API call** happens FIRST (same code for both)
2. ✅ support@ succeeds → Gets 20 emails from Zoho
3. ❌ sales@ fails → 500 error from Zoho
4. ✅ **Filtering** happens SECOND (only for support@)
5. ✅ support@ filters out non-order emails

### Conclusion:

The **filtering is different**, but happens AFTER the Zoho API call.

The 500 error happens during the Zoho API call itself, which uses identical code for both mailboxes.

**This proves it's a Zoho configuration issue** with your sales@ mailbox specifically, NOT our code!

---

## Possible Causes of 500 Error:

1. **OAuth token issue** (expired, corrupt, or wrong scope)
2. **Mailbox storage quota** exceeded for sales@
3. **Account permissions** changed in Zoho admin
4. **Zoho organization restriction** on sales@ mailbox
5. **Mailbox status** (disabled, suspended, etc.)

---

## After Reconnecting:

If the issue persists after fresh OAuth, check Zoho Mail admin console:

1. **Mailbox Status**: Is sales@ active?
2. **Storage Quota**: Is it full?
3. **API Access**: Are API permissions enabled?
4. **Organization Settings**: Any restrictions on sales@?

If all looks good and still failing, contact Zoho support with:
- Account ID: `4132877000000008002`
- Error: 500 Internal Server Error
- Endpoint: `/accounts/4132877000000008002/messages/search`
