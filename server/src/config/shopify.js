import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import dotenv from 'dotenv';

dotenv.config();

// Define scopes for TFS Manager
const scopes = [
  'read_products',
  'write_products',
  'read_orders',
  'write_orders',
  'read_customers',
  'read_inventory',
  'write_inventory',
  'read_fulfillments',
  'write_fulfillments',
  'read_shipping',
  'read_files',
  'write_files',
  'read_order_edits',
  'write_order_edits',
  'read_product_listings',
  'write_product_listings',
  'read_locations'
];

// Initialize Shopify API with OAuth support
export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || 'temp-key',
  apiSecretKey: process.env.SHOPIFY_API_SECRET || 'temp-secret',
  scopes: scopes,
  hostName: process.env.APP_URL?.replace(/https?:\/\//, '') || 'tfs-manager-server-production.up.railway.app',
  hostScheme: 'https',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  }
});

// Check if Shopify is configured
const isConfigured = !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);

if (isConfigured) {
  console.log('🛍️ Shopify API configured for OAuth');
  console.log(`📌 API Version: ${LATEST_API_VERSION}`);
  console.log(`🔐 Embedded App: Yes`);
  console.log(`🌐 Host: ${process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app'}`);
} else {
  console.warn('⚠️ Shopify API not fully configured');
  console.warn('Missing:', [
    !process.env.SHOPIFY_API_KEY && 'SHOPIFY_API_KEY',
    !process.env.SHOPIFY_API_SECRET && 'SHOPIFY_API_SECRET'
  ].filter(Boolean).join(', '));
}

export default shopify;
