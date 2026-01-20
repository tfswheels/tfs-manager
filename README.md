# TFS Manager

TFS Manager is a comprehensive Shopify app for TFS Wheels that consolidates order processing, customer communication, and inventory management.

## Features

### 📦 Order Management
- View and filter all Shopify orders
- Bulk select orders for processing
- Email communication directly from order view
- Processing history and logs

### 📧 Customer Communication
- Gmail integration with support@tfswheels.com
- Pre-built email templates (Incorrect Fitment, Order Ready, Vehicle Request)
- Email threads linked to orders
- Interactive decision trees for common scenarios

### 🔄 Inventory Scraping
- Automated CWO (Custom Wheel Offset) scraping for wheels and tires
- Scheduled scraping (configure intervals for different product types)
- Product discovery and creation (1000/day limit)
- Image processing and Google Cloud Storage upload
- Shopify sync queue management

### 🛠️ Order Processing
- **SDW Automation**: Automated ordering from SD Wheel Wholesale
- **Selective Processing**: Interactive PDF generation for specific order items
- Processing logs with invoice tracking

## Structure

```
TFS Manager/
├── server/              # Node.js backend (Express API)
├── admin/               # React frontend (Vite + Shopify Polaris)
├── workers/             # Python automation scripts
│   ├── customer_communication/
│   ├── inventory_scraping/
│   └── order_processing/
├── package.json         # Root package configuration
└── shopify.app.toml    # Shopify app configuration
```

## Setup

### Prerequisites
- Node.js 18+ and npm
- Python 3.7+
- MySQL database
- Shopify Custom App with API credentials

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd TFS\ Manager
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd server && npm install
   cd ../admin && npm install
   ```

3. **Configure environment variables**

   Create `.env` files in `server/` and `admin/` directories (see `.env.example`)

4. **Run database migrations**
   ```bash
   cd server
   npm run migrate
   ```

5. **Start development servers**
   ```bash
   # Terminal 1 - Backend
   npm run dev:server

   # Terminal 2 - Frontend
   npm run dev:admin
   ```

## Deployment

### Frontend (Vercel)
```bash
cd admin
vercel --prod
```

### Backend (Railway)
```bash
cd server
railway up
```

### Workers (Railway - Python)
Deploy as separate Railway service or use cron jobs.

## Environment Variables

### Server
- `SHOPIFY_STORE_URL` - Your Shopify store URL
- `SHOPIFY_ACCESS_TOKEN` - Custom app access token
- `DATABASE_URL` - MySQL connection string
- `GMAIL_CLIENT_ID` - Gmail API client ID
- `GMAIL_CLIENT_SECRET` - Gmail API client secret
- `SENDGRID_API_KEY` - SendGrid API key
- `ZENROWS_API_KEY` - ZenRows API key
- `CAPSOLVER_API_KEY` - CapSolver API key
- `GCS_CREDENTIALS` - Google Cloud Storage credentials

### Admin
- `VITE_API_URL` - Backend API URL

## License

Private - TFS Wheels Internal Use Only
