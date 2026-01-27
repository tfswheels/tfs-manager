import express from 'express';
import { getAccessToken } from '../services/zohoMailEnhanced.js';
import axios from 'axios';

const router = express.Router();

const ZOHO_API_BASE = 'https://mail.zoho.com/api';

/**
 * Diagnostic endpoint to check Zoho account configuration
 * GET /api/zoho-diagnostics/check-accounts
 */
router.get('/check-accounts', async (req, res) => {
  try {
    const shopId = 1; // Default shop
    const accessToken = await getAccessToken(shopId);

    console.log('🔍 Checking Zoho accounts...');

    // List all accounts
    const response = await axios.get(`${ZOHO_API_BASE}/accounts`, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    const accounts = response.data.data || [];

    console.log(`📋 Found ${accounts.length} Zoho accounts`);

    const accountInfo = accounts.map(acc => ({
      accountId: acc.accountId,
      emailAddress: acc.accountAddress || acc.emailAddress || acc.primaryEmailAddress,
      accountName: acc.accountName,
      status: acc.status,
      accountType: acc.accountType,
      raw: acc
    }));

    // Test sales@ account specifically
    const salesAccount = accountInfo.find(acc =>
      acc.emailAddress?.includes('sales@tfswheels.com')
    );

    let salesTest = null;
    if (salesAccount) {
      try {
        console.log(`🧪 Testing sales@ account: ${salesAccount.accountId}`);

        const testResponse = await axios.get(
          `${ZOHO_API_BASE}/accounts/${salesAccount.accountId}/messages/search`,
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`
            },
            params: {
              searchKey: 'fid:1',
              limit: 1
            }
          }
        );

        salesTest = {
          success: true,
          messageCount: testResponse.data.data?.length || 0,
          status: 'Working'
        };
      } catch (err) {
        salesTest = {
          success: false,
          error: err.response?.data || err.message,
          status: err.response?.status,
          statusText: err.response?.statusText
        };
      }
    }

    // Test support@ account
    const supportAccount = accountInfo.find(acc =>
      acc.emailAddress?.includes('support@tfswheels.com')
    );

    let supportTest = null;
    if (supportAccount) {
      try {
        console.log(`🧪 Testing support@ account: ${supportAccount.accountId}`);

        const testResponse = await axios.get(
          `${ZOHO_API_BASE}/accounts/${supportAccount.accountId}/messages/search`,
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`
            },
            params: {
              searchKey: 'fid:1',
              limit: 1
            }
          }
        );

        supportTest = {
          success: true,
          messageCount: testResponse.data.data?.length || 0,
          status: 'Working'
        };
      } catch (err) {
        supportTest = {
          success: false,
          error: err.response?.data || err.message,
          status: err.response?.status,
          statusText: err.response?.statusText
        };
      }
    }

    res.json({
      success: true,
      accounts: accountInfo,
      hardcodedMapping: {
        'sales@tfswheels.com': '4132877000000008002',
        'support@tfswheels.com': '4145628000000008002'
      },
      tests: {
        sales: salesTest,
        support: supportTest
      }
    });

  } catch (error) {
    console.error('❌ Diagnostic check failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

export default router;
