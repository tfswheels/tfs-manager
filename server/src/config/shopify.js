import dotenv from 'dotenv';

dotenv.config();

// Shopify configuration for custom app (single shop)
const shopifyConfig = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecret: process.env.SHOPIFY_API_SECRET,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
  storeUrl: process.env.SHOPIFY_STORE_URL || 'https://2f3d7a-2.myshopify.com',
  apiVersion: '2025-01'
};

// Check if Shopify is configured
const isConfigured = !!(shopifyConfig.apiKey && shopifyConfig.apiSecret && shopifyConfig.accessToken);

if (isConfigured) {
  console.log('🛍️ Shopify API configured');
  console.log(`📌 Store: ${shopifyConfig.storeUrl}`);
  console.log(`🔐 Access Token: ${shopifyConfig.accessToken ? 'shpat_***' + shopifyConfig.accessToken.slice(-4) : 'NOT SET'}`);
} else {
  console.warn('⚠️ Shopify API not fully configured');
  console.warn('Missing:', [
    !shopifyConfig.apiKey && 'SHOPIFY_API_KEY',
    !shopifyConfig.apiSecret && 'SHOPIFY_API_SECRET',
    !shopifyConfig.accessToken && 'SHOPIFY_ACCESS_TOKEN'
  ].filter(Boolean).join(', '));
}

export default shopifyConfig;
