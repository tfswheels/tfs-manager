# Build Fixes Summary

## Issue
Vercel/Railway builds were failing with: `Rollup failed to resolve import "@tiptap/react"` and `@floating-ui/dom`

## Root Cause
In npm workspace monorepos, packages are hoisted to the root `node_modules`. When building the `admin` workspace:
- Vite/Rollup couldn't find packages in `../node_modules`
- TipTap has transitive dependencies (@floating-ui/dom, @tiptap/core, @tiptap/pm) that also need resolution
- The build environment didn't understand the workspace structure

## Solution Applied

### 1. Created Workspace Configuration (Commit 90639fe)
**Files:** `.npmrc`, `vercel.json`

`.npmrc`:
```
legacy-peer-deps=false
auto-install-peers=true
node-linker=hoisted
```

`vercel.json`:
```json
{
  "buildCommand": "npm run build:admin",
  "outputDirectory": "admin/dist",
  "installCommand": "npm install --legacy-peer-deps",
  "framework": null
}
```

### 2. Added Explicit Path Aliases (Commits 30f756f, d4fab21)
**File:** `admin/vite.config.js`

Added explicit aliases pointing to `../node_modules`:
- `@tiptap/react` → `../node_modules/@tiptap/react`
- `@tiptap/starter-kit` → `../node_modules/@tiptap/starter-kit`
- `@tiptap/extension-*` → `../node_modules/@tiptap/extension-*`
- `@tiptap/core` → `../node_modules/@tiptap/core` ⭐ Transitive dependency
- `@tiptap/pm` → `../node_modules/@tiptap/pm` ⭐ Transitive dependency
- `@floating-ui/dom` → `../node_modules/@floating-ui/dom` ⭐ Transitive dependency
- `@floating-ui/core` → `../node_modules/@floating-ui/core` ⭐ Transitive dependency

Added `preserveSymlinks: true` for workspace compatibility.

## Why This Works

1. **Explicit paths** - No relying on module resolution heuristics
2. **All dependencies covered** - Including transitive dependencies that TipTap imports internally
3. **Workspace-aware** - Uses `../node_modules` to access hoisted packages
4. **Build environment agnostic** - Works in any CI/CD environment

## Verification

✅ Build tested locally after each change
✅ All dependencies resolve correctly
✅ No breaking changes to existing features

## Current Status

**Latest commit:** `d4fab21` - Add @floating-ui and @tiptap/core aliases for transitive dependencies

**Railway:** Currently on commit `845d01e` (Tailwind v3 downgrade)
- Will auto-deploy when it pulls latest commits
- Already has TipTap packages in package.json (from commit 9426d49)
- Will get workspace config + aliases from latest commits

**Vercel:** Building from latest commits
- Should now successfully resolve all TipTap dependencies
- Has workspace config and all aliases

## What to Expect

Both Vercel and Railway should now:
1. Install dependencies from root (hoisted)
2. Build admin workspace successfully
3. Resolve all TipTap and floating-ui imports correctly

No further action needed - both platforms will auto-deploy on next push.
