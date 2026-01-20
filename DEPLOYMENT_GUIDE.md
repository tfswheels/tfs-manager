# TFS Manager - Deployment Guide

Complete step-by-step guide for deploying TFS Manager to Railway (backend) and Vercel (frontend).

---

## Prerequisites

- ✅ Railway project created
- ✅ Vercel account
- ✅ Google Cloud MySQL database running (34.67.162.140)
- ✅ Create NEW database instance: `tfs-manager` (keeps existing `tfs-db` separate)
- ✅ Shopify store (2f3d7a-2.myshopify.com)
- ✅ Domain managed on Shopify

---

## Step 1: Database Setup

### Run Migrations

1. Create a `.env` file in the `server/` directory:
```bash
cd server
cp .env.example .env
```

2. Fill in your database credentials in `.env`:
```env
DB_HOST=34.67.162.140
DB_USER=tfs
DB_PASSWORD=your_actual_password
DB_NAME=tfs-manager
DB_PORT=3306
```

3. Run the migrations:
```bash
npm run migrate
```

You should see:
```
✅ Connected to database
📊 Database: tfs-db @ 34.67.162.140
🚀 Running migrations...
✅ Migrations completed successfully!
```

---

## Step 2: Railway Deployment (Backend API)

### 2.1 Configure Railway Project

1. **Go to your Railway project dashboard**
2. **Add all environment variables** from `server/.env.example`:

**Required Variables:**
```env
# Server
PORT=3000
NODE_ENV=production

# Database
DB_HOST=34.67.162.140
DB_USER=tfs
DB_PASSWORD=your_password
DB_NAME=tfs-manager
DB_PORT=3306

# Shopify (get these from Custom App in Step 4)
SHOPIFY_STORE_URL=https://2f3d7a-2.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxx
SHOPIFY_API_KEY=xxxxx
SHOPIFY_API_SECRET=xxxxx

# Email
GMAIL_CLIENT_ID=xxxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxxxx
GMAIL_REFRESH_TOKEN=xxxxx
SENDGRID_API_KEY=SG.xxxxx

# Scraping
ZENROWS_API_KEY=xxxxx
CAPSOLVER_API_KEY=CAP-xxxxx

# Google Cloud Storage
GCS_BUCKET_NAME=tfs-product-images
GCS_PROJECT_ID=xxxxx
GCS_CREDENTIALS={"type":"service_account",...}

# SDW Credentials
SDW_EMAIL=your_email
SDW_PASS=your_password

# Billing Info
BILLING_FIRST_NAME=Jeremiah
BILLING_LAST_NAME=Chukwu
BILLING_STREET=1309 Coffeen Avenue
BILLING_CITY=Sheridan
BILLING_STATE=Wyoming
BILLING_ZIP=82801
BILLING_EMAIL=jeremiah@autopartspalace.com

# Credit Cards
CARD_1_NAME=Business Visa
CARD_1_NUMBER=xxxx
CARD_1_EXP=12/25
CARD_1_CVV=123
CARD_1_ZIP=82801
```

### 2.2 Railway Settings

1. **Root Directory**: `server` ✅
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. **Region**: Choose closest to database (US Central recommended)

### 2.3 Deploy and Get URL

1. Click **Deploy** in Railway
2. Wait for deployment to complete
3. Railway will provide a URL like: `https://tfs-manager-production-xxxx.up.railway.app`
4. **Copy this URL** - you'll need it for:
   - Vercel frontend configuration
   - Shopify app redirect URIs
   - DNS setup

---

## Step 3: Vercel Deployment (Frontend)

### 3.1 Deploy Admin Frontend

1. **Navigate to admin directory:**
```bash
cd admin
```

2. **Create `.env` file:**
```bash
cp .env.example .env
```

3. **Add Railway URL to `.env`:**
```env
VITE_API_URL=https://your-railway-url.up.railway.app
```

4. **Install Vercel CLI (if not already installed):**
```bash
npm install -g vercel
```

5. **Deploy to Vercel:**
```bash
vercel --prod
```

6. **Follow prompts:**
   - Set up and deploy? **Y**
   - Which scope? Choose your account
   - Link to existing project? **N**
   - Project name? `tfs-manager`
   - Directory? `./`
   - Override settings? **N**

7. **Vercel will provide a URL like:** `https://tfs-manager.vercel.app`
8. **Copy this URL** - you'll need it for Shopify app configuration

### 3.2 Add Environment Variable in Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your `tfs-manager` project
3. Go to **Settings** → **Environment Variables**
4. Add:
   - **Name:** `VITE_API_URL`
   - **Value:** `https://your-railway-url.up.railway.app`
   - **Environment:** Production, Preview, Development
5. Click **Save**
6. **Redeploy** (Deployments tab → Click menu → Redeploy)

---

## Step 4: Create Shopify Custom App

### 4.1 Create Custom App

1. Go to Shopify Admin: https://admin.shopify.com/store/2f3d7a-2
2. Navigate to **Settings** → **Apps and sales channels** → **Develop apps**
3. Click **Create an app**
4. **App name:** `TFS Manager`
5. Click **Create app**

### 4.2 Configure API Scopes

1. Click **Configure Admin API scopes**
2. Select these scopes:
   - `read_products`
   - `write_products`
   - `read_orders`
   - `write_orders`
   - `read_customers`
   - `read_inventory`
   - `write_inventory`
   - `read_fulfillments`
   - `write_fulfillments`
   - `read_shipping`
   - `read_files`
   - `write_files`
   - `read_order_edits`
   - `write_order_edits`
   - `read_product_listings`
   - `write_product_listings`
   - `read_locations`
3. Click **Save**

### 4.3 Get API Credentials

1. Click **Install app** → **Install**
2. **Copy the Admin API access token** (starts with `shpat_`)
3. Go to **API credentials** tab
4. **Copy:**
   - API key
   - API secret key

### 4.4 Configure App URLs

1. In the custom app, go to **Configuration**
2. **App URL:** `https://tfs-manager.vercel.app`
3. **Allowed redirection URL(s):**
   ```
   https://your-railway-url.up.railway.app/auth/callback
   https://tfs-manager.vercel.app
   ```
4. Click **Save**

### 4.5 Update Environment Variables

Add the credentials to both Railway and your local `.env`:

**Railway:**
```env
SHOPIFY_ACCESS_TOKEN=shpat_xxxxx (from step 4.3)
SHOPIFY_API_KEY=xxxxx (from step 4.3)
SHOPIFY_API_SECRET=xxxxx (from step 4.3)
```

**Local `.env`:**
Same as above

---

## Step 5: DNS Setup (Custom Domain)

### 5.1 Set Up api.tfswheels.com

Since your domain is managed on Shopify:

1. **Go to Shopify Admin** → **Settings** → **Domains**
2. You'll need to add DNS records. Shopify doesn't allow custom subdomain DNS records directly.

**Option A: Use Railway's Domain (Recommended for now)**
- Use the Railway URL directly: `https://your-railway-url.up.railway.app`
- Update `shopify.app.toml` and webhooks to use this URL

**Option B: Transfer DNS to Cloudflare or Similar**
1. Set up Cloudflare account
2. Add your domain to Cloudflare
3. Update nameservers on Shopify to point to Cloudflare
4. In Cloudflare, add A record:
   - **Type:** CNAME
   - **Name:** api
   - **Target:** your-railway-url.up.railway.app
   - **Proxy:** Off (DNS only)

### 5.2 Update Railway Domain (if using custom domain)

1. Go to Railway project → **Settings** → **Domains**
2. Click **Add Custom Domain**
3. Enter: `api.tfswheels.com`
4. Follow Railway's instructions for DNS configuration

---

## Step 6: Configure Webhooks in Shopify

### 6.1 Set Up Webhooks

1. Go to **Settings** → **Notifications** → **Webhooks**
2. Add these webhooks:

**Orders Created:**
- Event: `Order creation`
- Format: `JSON`
- URL: `https://your-railway-url.up.railway.app/webhooks/orders/create`
- API version: `2025-01`

**Orders Updated:**
- Event: `Order updated`
- Format: `JSON`
- URL: `https://your-railway-url.up.railway.app/webhooks/orders/updated`
- API version: `2025-01`

**Products Created:**
- Event: `Product creation`
- Format: `JSON`
- URL: `https://your-railway-url.up.railway.app/webhooks/orders/products/create`
- API version: `2025-01`

**Products Updated:**
- Event: `Product update`
- Format: `JSON`
- URL: `https://your-railway-url.up.railway.app/webhooks/orders/products/update`
- API version: `2025-01`

---

## Step 7: Test the Setup

### 7.1 Test Backend API

```bash
curl https://your-railway-url.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-19T..."
}
```

### 7.2 Test Frontend

1. Go to: `https://tfs-manager.vercel.app`
2. You should see the TFS Manager admin interface
3. Try logging in or accessing features

### 7.3 Test Webhooks

1. Create a test order in Shopify
2. Check Railway logs for webhook processing
3. Verify order appears in database

---

## URLs Summary

After deployment, you should have:

- **Backend API:** `https://your-railway-url.up.railway.app` (or `https://api.tfswheels.com`)
- **Frontend:** `https://tfs-manager.vercel.app`
- **Shopify Store:** `https://2f3d7a-2.myshopify.com`

---

## Troubleshooting

### Railway won't deploy
- Check environment variables are set correctly
- Check Railway logs for errors
- Ensure root directory is set to `server`

### Vercel won't deploy
- Check `VITE_API_URL` is set in Vercel environment variables
- Check build logs for errors
- Ensure dependencies are installed

### Webhooks not working
- Verify webhook URLs match Railway URL
- Check HMAC secret matches
- Check Railway logs for webhook errors

### Database connection errors
- Verify IP whitelist includes Railway's IP ranges
- Check database credentials
- Test connection using Railway's terminal

---

## Next Steps

1. ✅ Deploy server to Railway
2. ✅ Deploy frontend to Vercel
3. ✅ Create Shopify Custom App
4. ✅ Configure webhooks
5. ⏭️ Set up Python workers (separate Railway service)
6. ⏭️ Configure cron jobs for scraping
7. ⏭️ Test all features

---

**Need help?** Check Railway logs and Vercel deployment logs for detailed error messages.
