# TFS Manager

TFS Manager is a comprehensive Shopify management application for TFS Wheels that consolidates order processing, customer communication via Zoho Mail, and inventory management with automated web scraping.

## 🎯 Project Overview

TFS Manager provides an all-in-one solution for managing TFS Wheels' Shopify store operations, including:
- **Order Management** with vehicle information tracking
- **Customer Email Communication** via Zoho Mail API with templated responses
- **Email Inbox** for sales@tfswheels.com with auto-order association
- **Automated Inventory Scraping** from CWO (Custom Wheel Offset)
- **Product Management** with Shopify API integration

## 🏗️ Architecture

### Tech Stack

**Backend (Node.js/Express)**
- Express.js API server
- MySQL database (dual database architecture)
- Shopify GraphQL & REST APIs
- Zoho Mail API integration
- OAuth authentication & webhooks

**Frontend (React/Vite)**
- React 18 with Vite
- Shopify Polaris UI components
- Axios for API communication

**Workers (Python)**
- SeleniumBase for web scraping
- Async/await with aiomysql
- Google Cloud Storage integration
- Tesseract OCR for image processing

**Infrastructure**
- Railway (Backend & Python workers)
- Vercel (Frontend)
- Google Cloud Platform (Image storage)
- MySQL on dedicated server

### Database Architecture

**Two-Database System:**

1. **`tfs-manager`** - App database for orders, emails, templates
   - `shops` - Shopify shop configurations
   - `orders` - Order data with vehicle info
   - `order_items` - Line items for orders
   - `email_templates` - Email templates with variables
   - `email_logs` - Sent email tracking
   - `customer_emails` - Incoming emails from customers
   - `email_conversations` - Email threading
   - `shop_settings` - Zoho OAuth & email settings
   - `zoho_webhook_logs` - Webhook event tracking
   - `scraping_jobs` - Scraping job status
   - `processing_logs` - Order processing history
   - `gdpr_requests` - GDPR compliance tracking

2. **`tfs-db`** - Product database (shared with other systems)
   - `shopify_products` - Product catalog from scraping
   - Product images and metadata

## ✅ Implemented Features

### 📦 Orders Management

**Enhanced Orders Page:**
- **Columns**: Order #, Date, Customer, Email, Vehicle Info, Tags, Total
- **Search**: By order number, customer name, or email
- **Pagination**: Dropdown selector (50, 100, 150, 200, 250, 500)
- **Bulk Selection**: Select multiple orders with checkboxes
- **Sync from Shopify**: Manual sync button to populate database
- **Send Emails**: Individual or bulk email sending

**Vehicle Information Tracking:**
- Year, Make, Model, Trim fields
- Notes field for additional info
- Displayed in orders table and emails

**Backend API** (`/api/orders`):
- `GET /` - List orders with search & pagination
- `POST /sync` - Sync orders from Shopify to database
- `PATCH /:orderId/vehicle` - Update vehicle information

### 📧 Email Communication System

**Email Templates** (`/email-templates` page):
- Full CRUD operations (Create, Read, Update, Delete)
- Template variables: `{{customer_name}}`, `{{order_number}}`, `{{vehicle_year}}`, etc.
- Categories: General, Order Update, Customer Service, Vehicle Info
- Types: Custom, Vehicle Request, Incorrect Fitment, Order Ready
- Live preview with variable substitution
- Variable insertion buttons

**Send Email Modal** (Orders page):
- Template selection dropdown with preview
- Displays recipients with order & vehicle info
- Send to individual or multiple orders
- Success/error feedback with detailed results

**Customer Emails Inbox** (`/customer-emails` page):
- Tabbed interface: All, Unread, Read, Replied, Archived
- Auto-association with orders by customer email
- Email stats dashboard (Unread, Total, Replied)
- Click email to view full details with order information
- Reply functionality with subject & body
- Status management (Mark as read/unread, Archive)
- Pagination support

**Zoho Mail API Integration:**
- OAuth 2.0 token management with auto-refresh
- Send templated emails via Zoho Mail API
- Template variable replacement
- Email logging to database
- Error tracking and reporting

**Zoho Webhooks** (`/webhooks/zoho/email-received`):
- Receive incoming emails from sales@tfswheels.com
- Auto-link emails to orders by customer email
- Email conversation threading
- Webhook event logging
- Test endpoint for development

**Backend APIs:**
- `/api/email-templates` - CRUD for email templates
- `/api/email/send` - Send templated emails
- `/api/customer-emails` - List/view incoming emails
- `/api/customer-emails/:id/reply` - Reply to emails
- `/api/customer-emails/:id/status` - Update email status
- `/api/customer-emails/stats/summary` - Email statistics

### 🔄 Inventory Scraping

**Automated Product Scraping:**
- CWO (Custom Wheel Offset) scraping for wheels and tires
- SeleniumBase with undetectable Chrome
- CapSolver for CAPTCHA solving
- ZenRows API for enhanced scraping
- Image download and OCR processing
- Google Cloud Storage upload
- Shopify product creation via GraphQL API

**Scraping Management** (`/products` page):
- Start/stop scraping jobs
- Real-time job status monitoring
- Scraping history and logs
- Brand filtering
- Railway log viewing instructions

**Backend API** (`/api/scraping`):
- `GET /jobs` - List scraping jobs
- `POST /start` - Start new scraping job
- `POST /terminate/:jobId` - Stop running job
- `POST /schedule` - Schedule recurring jobs

### 🔐 Shopify Integration

**OAuth Flow:**
- Custom app installation
- Access token storage
- HMAC verification for webhooks

**Webhooks:**
- Order created/updated webhooks
- GDPR compliance webhooks (customer data requests, redaction, erasure)
- Webhook verification with HMAC

## 🚧 Pending Features

### High Priority
- [ ] Zoho OAuth setup UI in settings
- [ ] Rich text editor for email templates (HTML support)
- [ ] Email attachments support
- [ ] Email signature management
- [ ] Template preview with sample data

### Medium Priority
- [ ] Order processing automation (SDW integration)
- [ ] Invoice generation and tracking
- [ ] Scraping job scheduler (cron-based)
- [ ] Product sync queue management
- [ ] Analytics dashboard

### Low Priority
- [ ] User management and permissions
- [ ] Audit logs
- [ ] Export functionality (CSV, Excel)
- [ ] Advanced search filters
- [ ] Bulk operations for products

## 🛠️ Setup & Installation

### Prerequisites

- **Node.js** 22+ (using `node:22-bookworm` Docker image)
- **Python** 3.11+ (upgraded from 3.9 for GCS compatibility)
- **MySQL** database server
- **Shopify Custom App** with API credentials
- **Zoho Mail** account with API access
- **Google Cloud Storage** bucket for images

### Local Development Setup

1. **Clone the repository**
   ```bash
   cd "TFS Wheels/TFS Manager"
   ```

2. **Install Node.js dependencies**
   ```bash
   # Server
   cd server
   npm install

   # Admin frontend
   cd ../admin
   npm install
   ```

3. **Install Python dependencies**
   ```bash
   cd server/workers
   pip3 install -r requirements.txt
   ```

4. **Configure environment variables**

   Create `server/.env`:
   ```env
   # Shopify Custom App
   SHOPIFY_STORE_URL=https://your-store.myshopify.com/admin/api/2025-01/graphql.json
   SHOPIFY_ACCESS_TOKEN=shpat_xxxxx
   SHOPIFY_API_KEY=xxxxx
   SHOPIFY_API_SECRET=shpss_xxxxx

   # Database
   DB_HOST=your-db-host
   DB_USER=tfs
   DB_PASSWORD=your-password
   DB_NAME=tfs-manager
   DB_PORT=3306

   # Scraping APIs
   ZENROWS_API_KEY=xxxxx
   CAPSOLVER_API_KEY=CAP-xxxxx

   # Google Cloud Storage
   GCS_BUCKET_NAME=tfs-product-images

   # Server
   PORT=3000
   NODE_ENV=development
   APP_URL=http://localhost:3000
   FRONTEND_URL=http://localhost:5173
   ```

   Create `admin/.env`:
   ```env
   VITE_API_URL=http://localhost:3000
   ```

5. **Run database migrations**
   ```bash
   cd server
   node scripts/run-migrations.js
   ```

6. **Start development servers**
   ```bash
   # Terminal 1 - Backend
   cd server
   npm run dev

   # Terminal 2 - Frontend
   cd admin
   npm run dev
   ```

7. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000

### Zoho Mail Setup

1. **Create Zoho OAuth App**
   - Go to https://api-console.zoho.com/
   - Create new client for "Self Client"
   - Note Client ID and Client Secret

2. **Get Refresh Token**
   - Use Zoho OAuth flow to get authorization code
   - Exchange for refresh token
   - Store in `shop_settings.zoho_refresh_token`

3. **Configure Webhook** (for receiving emails)
   - Go to Zoho Mail Settings > Webhooks
   - Create webhook for "New Email Received" event
   - Set URL: `https://your-domain.com/webhooks/zoho/email-received`
   - Copy webhook secret to `shop_settings.zoho_webhook_secret`

4. **Update Database**
   ```sql
   UPDATE shop_settings
   SET zoho_client_id = 'your-client-id',
       zoho_client_secret = 'your-client-secret',
       zoho_refresh_token = 'your-refresh-token',
       zoho_webhook_secret = 'your-webhook-secret',
       email_from_name = 'TFS Wheels'
   WHERE shop_id = 1;
   ```

## 🚀 Deployment

### Frontend - Vercel

1. **Connect GitHub repository to Vercel**

2. **Configure build settings**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Root Directory: `admin`

3. **Set environment variables**
   - `VITE_API_URL` = Your Railway backend URL

4. **Deploy**
   ```bash
   cd admin
   vercel --prod
   ```

### Backend - Railway

1. **Create new Railway project**

2. **Add MySQL database**
   - Railway provides MySQL addon
   - Or connect to external MySQL server

3. **Configure environment variables**
   - Add all variables from `server/.env.example`
   - Set `APP_URL` to Railway-provided domain
   - Set `FRONTEND_URL` to Vercel domain

4. **Deploy**
   ```bash
   cd server
   railway up
   ```

5. **Run migrations**
   ```bash
   railway run node scripts/run-migrations.js
   ```

### Dockerfile Configuration

The Docker container includes both Node.js and Python:

```dockerfile
FROM node:22-bookworm  # Debian 12 for Python 3.11+

# Install Python, Chrome, and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    chromium \
    chromium-driver \
    tesseract-ocr

# Install Python packages (using --break-system-packages for Docker)
RUN pip3 install --break-system-packages -r workers/requirements.txt
```

## 📁 Project Structure

```
TFS Manager/
├── server/                           # Backend API
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js          # MySQL connection pool
│   │   │   └── shopify.js           # Shopify API client
│   │   ├── middleware/
│   │   │   ├── auth.js              # OAuth verification
│   │   │   └── securityHeaders.js   # Security headers
│   │   ├── routes/
│   │   │   ├── auth.js              # Shopify OAuth
│   │   │   ├── webhooks.js          # Shopify webhooks
│   │   │   ├── gdprWebhooks.js      # GDPR compliance
│   │   │   ├── zohoWebhooks.js      # Zoho Mail webhooks
│   │   │   ├── orders.js            # Order management
│   │   │   ├── products.js          # Product management
│   │   │   ├── scraping.js          # Scraping jobs
│   │   │   ├── email.js             # Email sending
│   │   │   ├── email-templates.js   # Template CRUD
│   │   │   ├── customer-emails.js   # Inbox management
│   │   │   └── brands.js            # Brand filtering
│   │   ├── services/
│   │   │   └── zohoMail.js          # Zoho Mail API service
│   │   └── index.js                 # Express app entry
│   ├── scripts/
│   │   ├── run-migrations.js        # Migration runner
│   │   ├── create-tables.sql        # Base schema
│   │   └── migrations/
│   │       ├── 002_enhance_email_system.sql
│   │       └── 003_complete_email_system.sql
│   ├── workers/
│   │   ├── scrapers/
│   │   │   ├── run_scraper.py       # Main scraper entry
│   │   │   ├── cwo_scraper.py       # CWO scraper logic
│   │   │   ├── config.py            # Scraper configuration
│   │   │   └── shopify_create_product.py
│   │   └── requirements.txt         # Python dependencies
│   ├── Dockerfile                    # Multi-stage build (Node + Python)
│   ├── package.json
│   └── .env.example
├── admin/                            # Frontend dashboard
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── Orders.jsx           # ✅ Enhanced with search, pagination, bulk
│   │   │   ├── Products.jsx         # Scraping management
│   │   │   ├── EmailTemplates.jsx   # ✅ Template CRUD
│   │   │   └── CustomerEmails.jsx   # ✅ Email inbox
│   │   ├── App.jsx                  # Main app component
│   │   └── main.jsx                 # React entry point
│   ├── package.json
│   └── vite.config.js
├── README.md                         # This file
└── package.json                      # Root package (workspace)
```

## 🔌 API Endpoints

### Orders
- `GET /api/orders` - List orders (search, pagination)
- `GET /api/orders/:id` - Get single order
- `POST /api/orders/sync` - Sync from Shopify
- `PATCH /api/orders/:orderId/vehicle` - Update vehicle info

### Email Templates
- `GET /api/email-templates` - List templates
- `GET /api/email-templates/:id` - Get template
- `POST /api/email-templates` - Create template
- `PUT /api/email-templates/:id` - Update template
- `DELETE /api/email-templates/:id` - Delete template

### Email Sending
- `POST /api/email/send` - Send templated emails to orders

### Customer Emails
- `GET /api/customer-emails` - List incoming emails
- `GET /api/customer-emails/:id` - Get email details
- `POST /api/customer-emails/:id/reply` - Reply to email
- `PATCH /api/customer-emails/:id/status` - Update status
- `GET /api/customer-emails/stats/summary` - Email statistics

### Webhooks
- `POST /webhooks/orders/create` - Shopify order created
- `POST /webhooks/orders/updated` - Shopify order updated
- `POST /webhooks/gdpr/*` - GDPR compliance webhooks
- `POST /webhooks/zoho/email-received` - Zoho incoming email

### Products & Scraping
- `GET /api/products` - List products
- `GET /api/brands` - List brands
- `GET /api/scraping/jobs` - List scraping jobs
- `POST /api/scraping/start` - Start scraping
- `POST /api/scraping/terminate/:jobId` - Stop job

## 🔒 Security

**Implemented:**
- HMAC verification for Shopify webhooks
- OAuth 2.0 for Shopify and Zoho
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- SQL injection prevention (parameterized queries)
- CORS configuration
- Environment variable protection

**Recommendations:**
- Rotate API keys regularly
- Use secrets management (Railway Secrets, Vercel Env Vars)
- Enable database SSL connections
- Implement rate limiting
- Add request logging and monitoring

## 🐛 Known Issues & Fixes

### Fixed Issues

1. **Python 3.9 EOL Warnings**
   - **Problem**: Google Cloud libraries warning about Python 3.9
   - **Fix**: Upgraded Dockerfile to `node:22-bookworm` (Debian 12, Python 3.11+)

2. **PEP 668 Installation Error**
   - **Problem**: Python 3.11+ prevents system-wide pip installs
   - **Fix**: Added `--break-system-packages` flag (safe in Docker)

3. **Python Logging to stderr**
   - **Problem**: Node.js labeled all Python logs as ERROR
   - **Fix**: Custom logging handlers - INFO/DEBUG → stdout, WARNING/ERROR → stderr

4. **Polling Log Spam**
   - **Problem**: Frontend polling every 5s filled logs with "Retrieved X jobs"
   - **Fix**: Reduced to 30s, removed unnecessary console.logs

## 📝 Database Migrations

**Migration Files:**
- `create-tables.sql` - Base schema (shops, orders, products, etc.)
- `002_enhance_email_system.sql` - Email tables (templates, logs, conversations)
- `003_complete_email_system.sql` - Zoho settings and template variables

**Running Migrations:**
```bash
cd server
node scripts/run-migrations.js
```

**Migration Process:**
1. Runs `create-tables.sql` first
2. Runs all files in `migrations/` folder alphabetically
3. Displays results with ✅ for each completed migration
4. Lists all tables in database

## 📊 Monitoring & Logs

**Railway Logs:**
- View real-time logs for backend and scraping jobs
- Search by job ID: `[Scraper #123]`
- Monitor webhook events
- Track email sending results

**Database Logs:**
- `email_logs` - All sent emails with status
- `zoho_webhook_logs` - Incoming webhook events
- `scraping_jobs` - Scraping job history
- `processing_logs` - Order processing history

## 🤝 Contributing

This is a private internal application for TFS Wheels. For questions or issues:
- Check Railway logs for backend errors
- Check browser console for frontend errors
- Review database migrations for schema changes
- Consult Zoho Mail API documentation for email issues

## 📄 License

**Private - TFS Wheels Internal Use Only**

---

**Last Updated**: January 2026
**Version**: 2.0.0 (Email System Complete)
