/**
 * Test script to verify Zoho account IDs are correct
 * Run with: node test_account_ids.js
 */

import axios from 'axios';
import dotenv from 'dotenv';
import db from './src/config/database.js';

dotenv.config();

const ZOHO_API_BASE = 'https://mail.zoho.com/api';

async function testAccountIds() {
  try {
    console.log('🔍 Testing Zoho account IDs...\n');

    // Get access token from database
    const [tokens] = await db.execute(
      'SELECT access_token FROM zoho_oauth_tokens WHERE shop_id = 1 LIMIT 1'
    );

    if (tokens.length === 0) {
      console.error('❌ No OAuth token found');
      process.exit(1);
    }

    const accessToken = tokens[0].access_token;

    // Test both account IDs
    const tests = [
      { email: 'sales@tfswheels.com', id: '4132877000000008002' },
      { email: 'support@tfswheels.com', id: '4145628000000008002' }
    ];

    for (const test of tests) {
      console.log(`\n📧 Testing ${test.email} (ID: ${test.id})...`);

      try {
        const response = await axios.get(
          `${ZOHO_API_BASE}/accounts/${test.id}/messages/search`,
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

        const messageCount = response.data.data?.length || 0;
        console.log(`  ✅ SUCCESS - Fetched ${messageCount} message(s)`);
        console.log(`  Account ID ${test.id} is correct for ${test.email}`);

      } catch (error) {
        console.error(`  ❌ FAILED - Status: ${error.response?.status}`);
        console.error(`  Error: ${JSON.stringify(error.response?.data)}`);
        console.error(`  Account ID ${test.id} is WRONG for ${test.email}`);
      }
    }

    console.log('\n🔄 Now testing by listing all accounts...\n');

    // List all accounts to see correct IDs
    try {
      const response = await axios.get(`${ZOHO_API_BASE}/accounts`, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      });

      const accounts = response.data.data || [];
      console.log(`Found ${accounts.length} account(s):\n`);

      accounts.forEach(acc => {
        const email = acc.accountAddress || acc.emailAddress || acc.primaryEmailAddress;
        console.log(`  📫 ${email}`);
        console.log(`     ID: ${acc.accountId}`);
        console.log(`     Name: ${acc.accountName}`);
        console.log(`     Status: ${acc.status || 'active'}\n`);
      });

    } catch (error) {
      console.error('❌ Failed to list accounts:', error.response?.data || error.message);
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testAccountIds();
