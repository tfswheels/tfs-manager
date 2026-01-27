import db from '../src/config/database.js';

async function inspectEmail() {
  try {
    // Get one email from the conversation in the screenshot
    const [emails] = await db.execute(`
      SELECT *
      FROM customer_emails
      WHERE subject LIKE '%New customer message on January 11%'
      LIMIT 1
    `);

    if (emails.length === 0) {
      console.log('No email found');
      return;
    }

    const email = emails[0];
    console.log('\n📧 Email Details:\n');
    console.log(`ID: ${email.id}`);
    console.log(`Conversation ID: ${email.conversation_id}`);
    console.log(`Direction: ${email.direction}`);
    console.log(`From: ${email.from_name} <${email.from_email}>`);
    console.log(`To: ${email.to_name} <${email.to_email}>`);
    console.log(`CC: ${email.cc_emails}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Received: ${email.received_at}`);
    console.log(`Sent: ${email.sent_at}`);
    console.log(`\nBody Text (${email.body_text?.length || 0} chars):`);
    console.log(email.body_text);
    console.log(`\nBody HTML (${email.body_html?.length || 0} chars):`);
    console.log(email.body_html ? `${email.body_html.substring(0, 200)}...` : 'NULL');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

inspectEmail();
