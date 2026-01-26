import express from 'express';
import { shopify } from '../config/shopify.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Installation endpoint - Initiates OAuth flow
 */
router.get('/install', async (req, res) => {
  try {
    const { shop } = req.query;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const shopDomain = shop.includes('.myshopify.com')
      ? shop
      : `${shop}.myshopify.com`;

    console.log('🔵 Starting OAuth flow for:', shopDomain);

    await shopify.auth.begin({
      shop: shopDomain,
      callbackPath: '/auth/callback',
      isOnline: false, // Offline access token (permanent)
      rawRequest: req,
      rawResponse: res
    });

  } catch (error) {
    console.error('OAuth begin error:', error);
    res.status(500).json({
      error: 'Failed to start installation',
      message: error.message
    });
  }
});

/**
 * OAuth callback endpoint - Receives access token
 */
router.get('/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res
    });

    const { session } = callback;
    const { shop, accessToken } = session;

    console.log('🎫 OAuth callback successful for:', shop);
    console.log('📋 Token preview: shpat_***' + accessToken.slice(-4));

    // Store shop credentials
    await db.execute(
      `INSERT INTO shops (shop_name, access_token, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       updated_at = NOW()`,
      [shop, accessToken]
    );

    console.log(`✅ Shop installed and token stored: ${shop}`);

    // Register webhooks
    await registerWebhooks(shop, accessToken);

    // Redirect to embedded app
    const apiKey = process.env.SHOPIFY_API_KEY;
    const redirectUrl = `https://${shop}/admin/apps/${apiKey}`;

    console.log(`🔀 Redirecting to: ${redirectUrl}`);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Installation failed. Please try again.');
  }
});

/**
 * Register webhooks for the shop
 */
async function registerWebhooks(shop, accessToken) {
  const client = new shopify.clients.Rest({
    session: { shop, accessToken }
  });

  const appUrl = process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app';

  const webhooks = [
    {
      topic: 'orders/create',
      address: `${appUrl}/webhooks/orders/create`,
      format: 'json'
    },
    {
      topic: 'orders/updated',
      address: `${appUrl}/webhooks/orders/updated`,
      format: 'json'
    },
    {
      topic: 'products/create',
      address: `${appUrl}/webhooks/orders/products/create`,
      format: 'json'
    },
    {
      topic: 'products/update',
      address: `${appUrl}/webhooks/orders/products/update`,
      format: 'json'
    }
  ];

  try {
    for (const webhook of webhooks) {
      try {
        await client.post({
          path: 'webhooks',
          data: { webhook }
        });
        console.log(`✅ Registered webhook: ${webhook.topic}`);
      } catch (webhookError) {
        console.error(`⚠️ Failed to register webhook ${webhook.topic}:`, webhookError.message);
      }
    }
    console.log(`✅ Webhooks registered for ${shop}`);
  } catch (error) {
    console.error('Webhook registration error:', error);
  }
}

/**
 * Get shop info
 */
router.get('/shop', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    if (!shop) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing shop parameter'
      });
    }

    const [rows] = await db.execute(
      'SELECT id, shop_name, access_token, created_at, updated_at FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Shop not installed. Please install the app.'
      });
    }

    const shopData = rows[0];
    const hasAccessToken = !!shopData.access_token;

    res.json({
      shop: {
        id: shopData.id,
        shop_name: shopData.shop_name,
        created_at: shopData.created_at,
        updated_at: shopData.updated_at,
        has_access_token: hasAccessToken,
        token_preview: shopData.access_token ? `${shopData.access_token.substring(0, 10)}...${shopData.access_token.slice(-4)}` : null
      },
      installed: true
    });

  } catch (error) {
    console.error('Get shop error:', error);
    res.status(500).json({
      error: 'Failed to retrieve shop',
      message: error.message
    });
  }
});

export default router;
