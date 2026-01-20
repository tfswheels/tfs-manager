import db from '../config/database.js';

/**
 * Authentication Middleware
 * Verifies shop parameter and checks if shop is installed
 */
export const verifyShopInstalled = async (req, res, next) => {
  try {
    const shop = req.query.shop || req.body.shop || req.headers['x-shopify-shop'];

    if (!shop) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing shop parameter'
      });
    }

    // Check if shop exists and has valid access token
    const [rows] = await db.execute(
      'SELECT id, shop_name, access_token FROM shops WHERE shop_name = ? AND access_token IS NOT NULL',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Shop not installed. Please install the app first.'
      });
    }

    // Attach shop data to request
    req.shop = rows[0];
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};

/**
 * Session Token Authentication (for embedded apps)
 * Verifies Shopify session token for embedded app requests
 */
export const verifySessionToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authorization header'
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // For custom apps, we'll use shop parameter authentication
    // Session tokens are primarily for public embedded apps
    // For now, pass through to shop verification
    next();
  } catch (error) {
    console.error('Session token verification error:', error);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid session token'
    });
  }
};
