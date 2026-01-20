import express from 'express';
import axios from 'axios';
import db from '../config/database.js';

const router = express.Router();

const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.com';
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REDIRECT_URI = process.env.APP_URL + '/auth/zoho/callback';

/**
 * Step 1: Generate authorization URL
 * Visit this endpoint to start OAuth flow
 */
router.get('/authorize', (req, res) => {
  const shop = req.query.shop || '2f3d7a-2.myshopify.com';

  // Zoho OAuth authorization URL
  const authUrl = `${ZOHO_ACCOUNTS_BASE}/oauth/v2/auth?` +
    `scope=ZohoMail.messages.ALL,ZohoMail.accounts.READ&` +
    `client_id=${ZOHO_CLIENT_ID}&` +
    `response_type=code&` +
    `access_type=offline&` +
    `redirect_uri=${encodeURIComponent(ZOHO_REDIRECT_URI)}&` +
    `state=${shop}`;

  console.log('🔐 Zoho OAuth Authorization URL generated');
  console.log('Redirect URI:', ZOHO_REDIRECT_URI);

  // Redirect user to Zoho authorization page
  res.redirect(authUrl);
});

/**
 * Step 2: OAuth callback endpoint
 * Zoho redirects here after user authorizes
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const shop = state || '2f3d7a-2.myshopify.com';

    if (!code) {
      return res.status(400).send('Authorization code not provided');
    }

    console.log('🔐 Received authorization code from Zoho');
    console.log('Shop:', shop);

    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(
      `${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`,
      null,
      {
        params: {
          code: code,
          client_id: ZOHO_CLIENT_ID,
          client_secret: ZOHO_CLIENT_SECRET,
          redirect_uri: ZOHO_REDIRECT_URI,
          grant_type: 'authorization_code'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!refresh_token) {
      console.error('❌ No refresh token received. Make sure access_type=offline was set.');
      return res.status(500).send('Failed to get refresh token. Please try again.');
    }

    console.log('✅ Received tokens from Zoho');

    // Calculate token expiration time
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).send('Shop not found');
    }

    const shopId = shops[0].id;

    // Check if shop_settings exists
    const [settings] = await db.execute(
      'SELECT id FROM shop_settings WHERE shop_id = ?',
      [shopId]
    );

    if (settings.length === 0) {
      // Create shop_settings if it doesn't exist
      await db.execute(
        `INSERT INTO shop_settings (
          shop_id,
          zoho_client_id,
          zoho_client_secret,
          zoho_refresh_token,
          zoho_access_token,
          zoho_token_expires_at,
          email_from_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'TFS Wheels', NOW(), NOW())`,
        [
          shopId,
          ZOHO_CLIENT_ID,
          ZOHO_CLIENT_SECRET,
          refresh_token,
          access_token,
          expiresAt
        ]
      );
      console.log('✅ Created shop_settings with Zoho credentials');
    } else {
      // Update existing shop_settings
      await db.execute(
        `UPDATE shop_settings
         SET zoho_client_id = ?,
             zoho_client_secret = ?,
             zoho_refresh_token = ?,
             zoho_access_token = ?,
             zoho_token_expires_at = ?,
             updated_at = NOW()
         WHERE shop_id = ?`,
        [
          ZOHO_CLIENT_ID,
          ZOHO_CLIENT_SECRET,
          refresh_token,
          access_token,
          expiresAt,
          shopId
        ]
      );
      console.log('✅ Updated shop_settings with Zoho credentials');
    }

    // Success page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Zoho Authorization Success</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 500px;
            }
            .success-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              color: #2d3748;
              margin-bottom: 10px;
            }
            p {
              color: #4a5568;
              line-height: 1.6;
              margin-bottom: 20px;
            }
            .info-box {
              background: #f7fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 20px;
              margin-top: 20px;
              text-align: left;
            }
            .info-box code {
              background: #edf2f7;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 13px;
            }
            .button {
              display: inline-block;
              background: #667eea;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              margin-top: 20px;
              transition: background 0.2s;
            }
            .button:hover {
              background: #5a67d8;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Zoho Mail Connected!</h1>
            <p>Your Zoho Mail account has been successfully connected to TFS Manager.</p>

            <div class="info-box">
              <p><strong>What was configured:</strong></p>
              <ul style="text-align: left; color: #4a5568;">
                <li>✓ Zoho OAuth credentials saved</li>
                <li>✓ Refresh token stored securely</li>
                <li>✓ Access token generated (expires in ${Math.floor(expires_in / 3600)} hours)</li>
                <li>✓ Email sending is now enabled</li>
              </ul>
            </div>

            <p style="margin-top: 20px;">
              You can now send emails from the <strong>Orders</strong> page and manage incoming emails from the <strong>Customer Emails</strong> page.
            </p>

            <a href="${process.env.FRONTEND_URL || 'https://tfs-manager-admin.vercel.app'}" class="button">
              Go to TFS Manager →
            </a>
          </div>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Zoho OAuth callback error:', error);
    console.error('Error details:', error.response?.data || error.message);

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Zoho Authorization Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f7fafc;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
            }
            .error-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              color: #e53e3e;
              margin-bottom: 10px;
            }
            pre {
              background: #f7fafc;
              padding: 12px;
              border-radius: 6px;
              text-align: left;
              overflow-x: auto;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authorization Failed</h1>
            <p>There was an error connecting to Zoho Mail.</p>
            <pre>${error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message}</pre>
            <p style="margin-top: 20px;">
              <a href="/auth/zoho/authorize">Try Again</a>
            </p>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * Test endpoint to verify Zoho connection
 */
router.get('/test', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [shops] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shops[0].id;

    // Get Zoho settings
    const [settings] = await db.execute(
      `SELECT zoho_client_id, zoho_refresh_token, zoho_access_token, zoho_token_expires_at
       FROM shop_settings
       WHERE shop_id = ?`,
      [shopId]
    );

    if (settings.length === 0 || !settings[0].zoho_refresh_token) {
      return res.json({
        configured: false,
        message: 'Zoho OAuth not configured. Visit /auth/zoho/authorize to set up.'
      });
    }

    const setting = settings[0];
    const now = new Date();
    const expiresAt = new Date(setting.zoho_token_expires_at);

    res.json({
      configured: true,
      clientId: setting.zoho_client_id,
      hasRefreshToken: !!setting.zoho_refresh_token,
      hasAccessToken: !!setting.zoho_access_token,
      tokenExpired: expiresAt <= now,
      tokenExpiresAt: setting.zoho_token_expires_at,
      message: 'Zoho OAuth is configured and ready to use!'
    });

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
