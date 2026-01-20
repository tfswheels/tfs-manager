import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import webhookRoutes from './routes/webhooks.js';
import gdprWebhookRoutes from './routes/gdprWebhooks.js';
import adminRoutes from './routes/admin.js';
import ordersRoutes from './routes/orders.js';
import productsRoutes from './routes/products.js';
import scrapingRoutes from './routes/scraping.js';
import emailRoutes from './routes/email.js';
import brandsRoutes from './routes/brands.js';
import { applyAllSecurityHeaders } from './middleware/securityHeaders.js';
import './config/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Apply comprehensive security headers (must be first)
app.use(applyAllSecurityHeaders);

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',  // Local development
    'https://tfs-manager-admin.vercel.app',  // Production frontend (Vercel)
    process.env.FRONTEND_URL  // Custom domain (if configured)
  ].filter(Boolean),
  credentials: true
}));

// CRITICAL: Webhook routes need raw body for HMAC verification
// Must be applied BEFORE express.json() middleware
app.use('/webhooks/orders', express.raw({ type: 'application/json' }));
app.use('/webhooks/gdpr', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes (webhooks already handled above)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/webhooks/orders', webhookRoutes);  // Shopify order webhooks
app.use('/webhooks/gdpr', gdprWebhookRoutes);  // Shopify GDPR webhooks
app.use('/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/scraping', scrapingRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/brands', brandsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'TFS Manager API',
    version: '1.0.0',
    status: 'running',
    shop: '2f3d7a-2.myshopify.com'
  });
});

// 404 handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      'GET /',
      'GET /health',
      'GET /auth/install',
      'GET /auth/callback',
      'POST /webhooks/orders/create',
      'POST /webhooks/orders/updated',
      'GET /api/admin/*'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Database connection errors
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Database Unavailable',
      message: 'Unable to connect to database. Please try again in a moment.'
    });
  }

  // Send generic error response
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TFS Manager API running on port ${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🏪 Shopify Store: 2f3d7a-2.myshopify.com`);
  console.log(`🌐 CORS enabled for:`, ['http://localhost:5173', 'https://tfs-manager.vercel.app']);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
