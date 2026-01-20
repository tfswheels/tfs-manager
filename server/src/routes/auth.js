import express from 'express';
import db from '../config/database.js';
import shopifyConfig from '../config/shopify.js';

const router = express.Router();

/**
 * Installation endpoint
 * For custom apps, just redirects to frontend
 */
router.get('/install', async (req, res) => {
  try {
    const { shop } = req.query;

    if (!shop) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing shop parameter'
      });
    }

    console.log('📱 Installation request for shop:', shop);

    // For custom apps, we don't need OAuth flow
    // The shop will use the custom app access token directly
    const frontendUrl = process.env.FRONTEND_URL || 'https://tfs-manager.vercel.app';
    res.redirect(`${frontendUrl}?shop=${shop}`);

  } catch (error) {
    console.error('Installation error:', error);
    res.status(500).json({
      error: 'Installation Failed',
      message: error.message
    });
  }
});

/**
 * OAuth callback endpoint
 * For custom apps, this logs the connection
 */
router.get('/callback', async (req, res) => {
  try {
    const { shop, code } = req.query;

    if (!shop || !code) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters'
      });
    }

    console.log('🔐 OAuth callback received for shop:', shop);
    console.log('📝 Authorization code:', code);

    // For custom apps, this endpoint might not be used
    // Custom apps get a permanent access token from Shopify admin
    const frontendUrl = process.env.FRONTEND_URL || 'https://tfs-manager.vercel.app';
    res.redirect(`${frontendUrl}?shop=${shop}&installed=true`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      error: 'Authorization Failed',
      message: error.message
    });
  }
});

/**
 * Shop configuration endpoint
 * Saves shop access token (for custom apps)
 */
router.post('/configure', async (req, res) => {
  try {
    const { shop, accessToken } = req.body;

    if (!shop || !accessToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing shop or accessToken'
      });
    }

    console.log('🔑 Configuring shop:', shop);
    console.log('🎫 Access Token received:', accessToken);
    console.log('📋 Token preview: shpat_***' + accessToken.slice(-4));

    // Check if shop already exists
    const [existing] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (existing.length > 0) {
      // Update existing shop
      await db.execute(
        'UPDATE shops SET access_token = ?, updated_at = NOW() WHERE shop_name = ?',
        [accessToken, shop]
      );
      console.log('✅ Updated existing shop configuration');
    } else {
      // Insert new shop
      await db.execute(
        'INSERT INTO shops (shop_name, access_token, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [shop, accessToken]
      );
      console.log('✅ Created new shop configuration');
    }

    res.json({
      success: true,
      message: 'Shop configured successfully',
      shop
    });

  } catch (error) {
    console.error('Configuration error:', error);
    res.status(500).json({
      error: 'Configuration Failed',
      message: error.message
    });
  }
});

/**
 * Get shop info
 * Returns information about the configured shop
 */
router.get('/shop', async (req, res) => {
  try {
    const shop = req.query.shop || process.env.SHOPIFY_STORE_URL?.replace('https://', '');

    if (!shop) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing shop parameter'
      });
    }

    const [rows] = await db.execute(
      'SELECT id, shop_name, created_at, updated_at FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Shop not configured'
      });
    }

    res.json({
      shop: rows[0]
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
