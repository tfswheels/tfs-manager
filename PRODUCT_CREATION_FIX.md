# Product Creation Job - Next Run Fix

## Bug Summary

The product creation job was incorrectly calculating `next_run_at` based on when the job **STARTED** instead of when it **ENDED**. This caused the next run to trigger too early, especially for long-running jobs.

### Example of the Bug

**Job #224:**
- Started: Jan 28, 01:51:03
- Completed: Jan 28, 03:13:37 (ran for 1.5 hours)
- Next Run (OLD): Jan 29, 01:51:03 ❌ (24 hours from START)
- Next Run (CORRECT): Jan 29, 03:13:37 ✅ (24 hours from COMPLETION)

**Result:** The next run would start only 22.5 hours after the previous run completed!

---

## What Was Fixed

### ✅ Bug #1: Next Run Timing (FIXED)

**Problem:** `next_run_at` was set when a job **started**, not when it **ended**.

**Solution:**
1. **Python Worker** (`create_shopify_products.py`):
   - Now sets `next_run_at = completed_at + schedule_interval` when job reaches:
     - `completed` status
     - `terminated` status
     - `failed` status
     - `cancelled` status

2. **Node.js API** (`product-creation.js`):
   - Removed premature `next_run_at` setting when creating manual jobs
   - Updated `/config` endpoint to use `next_run_at` from last ended job

3. **Job Scheduler** (`jobScheduler.js`):
   - Removed premature `next_run_at` setting when creating scheduled jobs
   - Now uses `next_run_at` from database (set by Python worker)

### ✅ Bug #2: Daily Limit Enforcement (Already Working!)

**Status:** No fix needed - this was already working correctly!

The system properly enforces the 1000 products/day limit across all runs:
- Manual run creates 200 products → Uses 200 from daily limit
- Scheduled run later that day → Only creates 800 products (remaining capacity)

The `daily_shopify_creation_limit` table tracks this correctly.

### ✅ Bug #3: Railway Deployment Triggering Jobs (Already Working!)

**Status:** No fix needed - this was already working correctly!

The scheduler checks the last **completed job's timestamp**, not the deployment time. Railway deployments will not trigger spurious job runs.

---

## Files Modified

1. **`server/workers/product-creator/create_shopify_products.py`**
   - Updated `update_job_status()` function (lines 341-444)
   - Sets `next_run_at = NOW() + schedule_interval` when job ends

2. **`server/src/routes/product-creation.js`**
   - Removed `next_run_at` from job creation in `/run-now` endpoint (lines 287-308)
   - Updated `/config` endpoint to read `next_run_at` from last ended job (lines 80-122)

3. **`server/src/services/jobScheduler.js`**
   - Removed `next_run_at` from job creation in `executeProductCreationJob()` (lines 316-343)
   - Updated `checkProductCreationJobs()` to use `next_run_at` from database (lines 253-281)

---

## Testing the Fix

### Automated Test Script

Run this command to verify the fix:

```bash
node server/scripts/test_next_run_fix.js
```

This will show:
- ✅ Jobs with correct `next_run_at` (calculated from completion time)
- ❌ Jobs with incorrect `next_run_at` (calculated from start time)

### Manual Testing

1. **Start a manual product creation run** (you can terminate it after a few seconds)
2. **Check the database:**
   ```bash
   node server/scripts/check_job_status.js
   ```
3. **Verify:**
   - While job is running: `next_run_at` should be `NULL`
   - After job ends: `next_run_at` should be `completed_at + schedule_interval`

### Expected Results

**Before the fix:**
```
Started:    2026-01-28 01:51:03
Completed:  2026-01-28 03:13:37  (ran 1.5 hours)
Next Run:   2026-01-29 01:51:03  ❌ (24 hours from START)
```

**After the fix:**
```
Started:    2026-01-28 01:51:03
Completed:  2026-01-28 03:13:37  (ran 1.5 hours)
Next Run:   2026-01-29 03:13:37  ✅ (24 hours from COMPLETION)
```

---

## Deployment Notes

### No Database Migration Required
The fix uses existing database columns - no schema changes needed.

### Backwards Compatibility
- Old jobs (with incorrect `next_run_at`) will continue to work
- New jobs will have correct `next_run_at` set when they complete
- The scheduler will automatically use the correct timing going forward

### What Happens After Deployment

1. **First job after deployment:**
   - Will run based on old (incorrect) `next_run_at` from previous job
   - But will set CORRECT `next_run_at` when it completes

2. **All subsequent jobs:**
   - Will use correct `next_run_at` timing
   - Scheduling will be accurate (24 hours from completion)

---

## Key Behaviors

### ✅ Manual Runs
- Do NOT reset the 24-hour cycle
- Respect daily limit (create only remaining capacity)
- Set `next_run_at` when completed/terminated/cancelled

### ✅ Scheduled Runs
- Trigger based on `next_run_at` from last ended job
- Respect daily limit across all runs
- Set `next_run_at` when completed/terminated/failed

### ✅ Daily Limit
- Shared across all runs (manual + scheduled)
- Tracks wheels/tires separately in `daily_shopify_creation_limit`
- Resets at midnight (new date row created)

### ✅ Railway Deployments
- Do NOT trigger new runs
- Scheduler respects last completed job's timing
- No spurious executions on restart

---

## Summary

The fix ensures that:
1. **Next run timing is calculated from job COMPLETION, not START**
2. **Daily limit is enforced across all runs** (already working)
3. **Railway deployments don't trigger spurious runs** (already working)

Run `node server/scripts/test_next_run_fix.js` after your next job completes to verify the fix! ✅
