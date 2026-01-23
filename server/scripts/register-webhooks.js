// scripts/register-webhooks.js
import { shopify } from '../src/config/shopify.js';
import db from '../src/config/database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Manually register webhooks for TFS Manager
 * Usage: node scripts/register-webhooks.js <shop-domain>
 * Example: node scripts/register-webhooks.js 2f3d7a-2.myshopify.com
 */
async function registerWebhooks(shopDomain) {
  try {
    console.log(`\n🔧 Registering webhooks for: ${shopDomain}\n`);

    if (!process.env.APP_URL) {
      console.error('❌ APP_URL not set in environment variables');
      console.log('💡 Set APP_URL in .env file (e.g., APP_URL=https://tfs-manager-server-production.up.railway.app)');
      process.exit(1);
    }

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

    const webhooks = [
      {
        topic: 'orders/create',
        address: `${process.env.APP_URL}/webhooks/orders/create`,
        format: 'json'
      },
      {
        topic: 'orders/updated',
        address: `${process.env.APP_URL}/webhooks/orders/updated`,
        format: 'json'
      },
      // GDPR webhooks (required for Shopify app store compliance)
      {
        topic: 'customers/data_request',
        address: `${process.env.APP_URL}/webhooks/gdpr/customers/data_request`,
        format: 'json'
      },
      {
        topic: 'customers/redact',
        address: `${process.env.APP_URL}/webhooks/gdpr/customers/redact`,
        format: 'json'
      },
      {
        topic: 'shop/redact',
        address: `${process.env.APP_URL}/webhooks/gdpr/shop/redact`,
        format: 'json'
      }
    ];

    console.log(`📍 Using APP_URL: ${process.env.APP_URL}\n`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const webhook of webhooks) {
      try {
        await client.post({
          path: 'webhooks',
          data: { webhook }
        });
        console.log(`✅ Registered: ${webhook.topic}`);
        console.log(`   → ${webhook.address}\n`);
        successCount++;
      } catch (webhookError) {
        // Check if webhook already exists (409 conflict)
        if (webhookError.response?.code === 409 || webhookError.message?.includes('already exists')) {
          console.log(`ℹ️  Already exists: ${webhook.topic}`);
          console.log(`   → ${webhook.address}\n`);
          successCount++; // Count as success
        } else {
          console.error(`❌ Failed: ${webhook.topic}`);
          console.error(`   Error: ${webhookError.message}\n`);
          errorCount++;
          errors.push({ topic: webhook.topic, error: webhookError.message });
        }
      }
    }

    console.log('\n📊 Summary:\n');
    console.log(`✅ Successfully registered: ${successCount}/${webhooks.length}`);
    if (errorCount > 0) {
      console.log(`❌ Failed: ${errorCount}/${webhooks.length}`);
      console.log('\nErrors:');
      errors.forEach(e => console.log(`  - ${e.topic}: ${e.error}`));
    }

    console.log('\n💡 Next steps:');
    console.log('1. Verify webhooks are registered correctly');
    console.log('2. Test webhooks by creating a test order in Shopify');
    console.log('3. Check server logs for incoming webhook requests');

    await db.end();
    process.exit(errorCount > 0 ? 1 : 0);

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
  console.error('❌ Usage: node scripts/register-webhooks.js <shop-domain>');
  console.error('📝 Example: node scripts/register-webhooks.js 2f3d7a-2.myshopify.com');
  process.exit(1);
}

registerWebhooks(shopDomain);
