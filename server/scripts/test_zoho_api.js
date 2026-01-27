import { fetchInbox, fetchEmailDetails } from '../src/services/zohoMailEnhanced.js';

async function testZohoAPI() {
  try {
    const shopId = 1;
    const accountEmail = 'sales@tfswheels.com';
    const folderId = '1'; // Inbox

    console.log('🧪 Testing Zoho Mail API...\n');

    // Fetch list of emails
    console.log('1. Fetching email list from Inbox...');
    const emails = await fetchInbox(shopId, {
      accountEmail,
      folderId,
      limit: 1 // Just get 1 email for testing
    });

    if (emails.length === 0) {
      console.log('❌ No emails found in inbox');
      process.exit(1);
    }

    console.log(`✅ Found ${emails.length} emails`);
    const testEmail = emails[0];
    console.log(`\nTest email: ${testEmail.subject || '(No Subject)'}`);
    console.log(`Message ID: ${testEmail.messageId}\n`);

    // Try to fetch full details
    console.log('2. Fetching full email details...');
    const fullEmail = await fetchEmailDetails(shopId, testEmail.messageId, accountEmail, folderId);

    console.log('\n✅ Successfully fetched email details!');
    console.log(`\nEmail structure:`);
    console.log(`  - From: ${fullEmail.fromAddress}`);
    console.log(`  - To: ${fullEmail.toAddress}`);
    console.log(`  - Subject: ${fullEmail.subject}`);
    console.log(`  - Content type: ${typeof fullEmail.content}`);
    console.log(`  - Content keys: ${fullEmail.content ? Object.keys(fullEmail.content).join(', ') : 'N/A'}`);

    if (fullEmail.content) {
      console.log(`\nFull content object structure:`);
      console.log(JSON.stringify(fullEmail.content, null, 2));

      const plainLength = fullEmail.content.plainContent?.length || fullEmail.content.content?.length || 0;
      const htmlLength = fullEmail.content.htmlContent?.length || 0;
      console.log(`\n  - Plain text length: ${plainLength} chars`);
      console.log(`  - HTML length: ${htmlLength} chars`);

      if (plainLength > 0) {
        const plainText = fullEmail.content.plainContent || fullEmail.content.content;
        console.log(`\nPlain text preview (first 200 chars):`);
        console.log(plainText.substring(0, 200));
      }
    }

    console.log('\n✅ Zoho Mail API is working correctly!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testZohoAPI();
