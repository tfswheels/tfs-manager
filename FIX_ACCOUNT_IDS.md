# Fix Support@ 500 Error - Account ID Investigation

## The Problem

After OAuth reconnection:
- ✅ sales@tfswheels.com **NOW WORKS** (was failing before)
- ❌ support@tfswheels.com **NOW FAILS** (was working before)

This suggests the account IDs might be swapped or OAuth token has different permissions.

## Quick Fix Option 1: Swap the Account IDs

The hardcoded IDs in `zohoMailEnhanced.js` might be backwards:

```javascript
// Current mapping (line 29-32):
const ACCOUNT_ID_MAP = {
  'sales@tfswheels.com': '4132877000000008002',
  'support@tfswheels.com': '4145628000000008002'
};

// Try swapping to:
const ACCOUNT_ID_MAP = {
  'sales@tfswheels.com': '4145628000000008002',  // SWAPPED
  'support@tfswheels.com': '4132877000000008002'  // SWAPPED
};
```

## Quick Fix Option 2: Remove Hardcoded IDs (Use API Discovery)

Comment out the hardcoded mapping and let it auto-discover from Zoho API:

```javascript
// Line 137-141 in zohoMailEnhanced.js
// Comment this out temporarily:
/*
if (ACCOUNT_ID_MAP[accountEmail]) {
  console.log(`✅ Using hardcoded account ID for ${accountEmail}: ${ACCOUNT_ID_MAP[accountEmail]}`);
  accountIdCache[accountEmail] = ACCOUNT_ID_MAP[accountEmail];
  return ACCOUNT_ID_MAP[accountEmail];
}
*/
```

This will force the code to call Zoho's `/accounts` endpoint to discover the correct IDs.

## Diagnostic Commands

### 1. Check OAuth Token in Database

```bash
cd "/Users/jeremiah/Desktop/TFS Wheels/TFS Manager/server"

# Using Node.js to query (avoids MySQL auth issues)
node -e "
import('./src/config/database.js').then(({ default: db }) => {
  db.execute('SELECT id, shop_id, LEFT(access_token, 20) as token_start, token_expires_at, created_at FROM zoho_oauth_tokens')
    .then(([rows]) => {
      console.log('OAuth Tokens:', rows);
      process.exit(0);
    });
});
"
```

### 2. Test Account IDs

I created a test script. Run it:

```bash
cd "/Users/jeremiah/Desktop/TFS Wheels/TFS Manager/server"
node ../test_account_ids.js
```

This will:
- Test both account IDs
- Show which one works for which email
- List all accounts from Zoho API
- Show the correct IDs

## What I Already Fixed

✅ **INVALID_METHOD Error** - Fixed the email details endpoint:
- Changed from: `/accounts/{accountId}/messages/{messageId}`
- Changed to: `/accounts/{accountId}/messages/view?messageId=xxx`

This should stop the 404 INVALID_METHOD errors you saw.

## Recommended Next Steps

1. **Deploy my fix first** (fixes INVALID_METHOD error)
2. **Run the test script** to see correct account IDs
3. **Either swap the IDs** or **remove hardcoded mapping** based on test results
4. **Deploy again** and check if support@ works

## Why This Happened

When you reconnected OAuth, Zoho may have:
- Used a different organization
- Changed which accounts are accessible
- Switched primary/secondary account ordering
- Required different permissions

The hardcoded IDs from before might not match the new OAuth token's account access.
