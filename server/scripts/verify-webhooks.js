// scripts/verify-webhooks.js
import { shopify } from '../src/config/shopify.js';
import db from '../src/config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Verify webhook registration for TFS Manager
 * Usage: node scripts/verify-webhooks.js <shop-domain>
 * Example: node scripts/verify-webhooks.js 2f3d7a-2.myshopify.com
 */
async function verifyWebhooks(shopDomain) {
  try {
    console.log(`\n🔍 Verifying webhooks for: ${shopDomain}\n`);

    // Get shop from database
    const [shops] = await db.execute(
      'SELECT id, shop_name, access_token FROM shops WHERE shop_name = ?',
      [shopDomain]
    );

    if (shops.length === 0) {
      console.error('❌ Shop not found in database');
      console.log('\nAvailable shops:');
      const [allShops] = await db.execute('SELECT shop_name FROM shops');
      if (allShops.length === 0) {
        console.log('  (no shops installed)');
      } else {
        allShops.forEach(s => console.log(`  - ${s.shop_name}`));
      }
      process.exit(1);
    }

    const shop = shops[0];

    if (!shop.access_token) {
      console.error('❌ Shop has no access token. Please reinstall the app.');
      process.exit(1);
    }

    const client = new shopify.clients.Rest({
      session: { shop: shop.shop_name, accessToken: shop.access_token }
    });

    // Fetch all registered webhooks
    const response = await client.get({ path: 'webhooks' });
    const webhooks = response.body.webhooks || [];

    console.log(`✅ Found ${webhooks.length} registered webhooks:\n`);

    const requiredWebhooks = [
      'orders/create',
      'orders/updated',
      'customers/data_request', // GDPR
      'customers/redact', // GDPR
      'shop/redact' // GDPR
    ];

    const optionalWebhooks = [
      'products/create',
      'products/update'
    ];

    const registeredTopics = new Set(webhooks.map(w => w.topic));

    console.log('📋 Required Webhooks:\n');

    // Check each required webhook
    requiredWebhooks.forEach(topic => {
      const isRegistered = registeredTopics.has(topic);
      const webhook = webhooks.find(w => w.topic === topic);

      if (isRegistered) {
        console.log(`✅ ${topic}`);
        console.log(`   Address: ${webhook.address}`);
        console.log(`   Format: ${webhook.format}`);
        console.log(`   ID: ${webhook.id}`);
        console.log(`   Created: ${webhook.created_at}\n`);
      } else {
        console.log(`❌ ${topic} - NOT REGISTERED\n`);
      }
    });

    console.log('📋 Optional Webhooks:\n');

    // Check optional webhooks
    optionalWebhooks.forEach(topic => {
      const isRegistered = registeredTopics.has(topic);
      const webhook = webhooks.find(w => w.topic === topic);

      if (isRegistered) {
        console.log(`✅ ${topic}`);
        console.log(`   Address: ${webhook.address}`);
        console.log(`   Format: ${webhook.format}\n`);
      } else {
        console.log(`ℹ️  ${topic} - Not registered (optional)\n`);
      }
    });

    // Check environment variables
    console.log('\n🔐 Environment Variables:\n');
    console.log(`APP_URL: ${process.env.APP_URL || '❌ NOT SET'}`);
    console.log(`SHOPIFY_API_KEY: ${process.env.SHOPIFY_API_KEY ? '✅ SET' : '❌ NOT SET'}`);
    console.log(`SHOPIFY_API_SECRET: ${process.env.SHOPIFY_API_SECRET ? '✅ SET (used for HMAC verification)' : '❌ NOT SET'}`);

    // Summary
    console.log('\n📊 Summary:\n');
    const missingRequired = requiredWebhooks.filter(topic => !registeredTopics.has(topic));
    const missingOptional = optionalWebhooks.filter(topic => !registeredTopics.has(topic));

    if (missingRequired.length === 0) {
      console.log('✅ All required webhooks are registered!');
    } else {
      console.log(`❌ Missing ${missingRequired.length} required webhooks:`);
      missingRequired.forEach(topic => console.log(`   - ${topic}`));
    }

    if (missingOptional.length > 0) {
      console.log(`\nℹ️  Missing ${missingOptional.length} optional webhooks:`);
      missingOptional.forEach(topic => console.log(`   - ${topic}`));
    }

    if (missingRequired.length > 0 || missingOptional.length > 0) {
      console.log('\n💡 To register missing webhooks, run:');
      console.log(`   node scripts/register-webhooks.js ${shopDomain}`);
    }

    // Test connectivity
    console.log('\n🌐 Testing Connectivity:\n');
    if (process.env.APP_URL) {
      const appUrl = process.env.APP_URL;
      console.log(`Server URL: ${appUrl}`);
      console.log(`Webhook endpoint: ${appUrl}/webhooks/orders/create`);
      console.log('\n💡 Make sure this URL is publicly accessible from Shopify servers');
    } else {
      console.log('⚠️  APP_URL not set - webhooks will not be reachable');
    }

    await db.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.body, null, 2));
    }
    await db.end();
    process.exit(1);
  }
}

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error('❌ Usage: node scripts/verify-webhooks.js <shop-domain>');
  console.error('📝 Example: node scripts/verify-webhooks.js 2f3d7a-2.myshopify.com');
  process.exit(1);
}

verifyWebhooks(shopDomain);
