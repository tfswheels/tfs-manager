import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES?.split(',') || [
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
  ],
  hostName: process.env.SHOPIFY_REDIRECT_URI?.replace('https://', '').split('/')[0] || 'api.tfswheels.com',
  hostScheme: 'https',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  isCustomStoreApp: true, // Single shop custom app
});

console.log('🛍️ Shopify API initialized');
console.log(`📌 API Version: ${LATEST_API_VERSION}`);
console.log(`🔐 Scopes:`, shopify.config.scopes);

export default shopify;
