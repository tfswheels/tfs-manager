import db from './src/config/database.js';

async function runDiagnostics() {
  try {
    console.log('\n===== EMAIL DIAGNOSTICS =====\n');

    // 1. Conversations by status
    console.log('1. CONVERSATIONS BY STATUS:');
    const [statusCounts] = await db.execute(`
      SELECT status, COUNT(*) as count
      FROM email_conversations
      WHERE shop_id = 1
      GROUP BY status
    `);
    console.table(statusCounts);

    // 2. Active conversations count
    console.log('\n2. ACTIVE CONVERSATIONS:');
    const [activeCounts] = await db.execute(`
      SELECT COUNT(*) as active_conversations
      FROM email_conversations
      WHERE shop_id = 1 AND status = 'active'
    `);
    console.log(`Active: ${activeCounts[0].active_conversations}`);

    // 3. Email direction breakdown
    console.log('\n3. EMAIL DIRECTION BREAKDOWN:');
    const [directionCounts] = await db.execute(`
      SELECT direction, COUNT(*) as count
      FROM customer_emails
      WHERE shop_id = 1
      GROUP BY direction
    `);
    console.table(directionCounts);

    // 4. Sample conversations with email counts
    console.log('\n4. RECENT CONVERSATIONS WITH MESSAGE COUNTS:');
    const [conversations] = await db.execute(`
      SELECT
        c.id,
        LEFT(c.subject, 40) as subject,
        c.status,
        c.message_count as stored_count,
        COUNT(e.id) as actual_count,
        SUM(CASE WHEN e.direction = 'inbound' THEN 1 ELSE 0 END) as inbound,
        SUM(CASE WHEN e.direction = 'outbound' THEN 1 ELSE 0 END) as outbound,
        c.last_message_at
      FROM email_conversations c
      LEFT JOIN customer_emails e ON c.id = e.conversation_id
      WHERE c.shop_id = 1
      GROUP BY c.id
      ORDER BY c.last_message_at DESC
      LIMIT 10
    `);
    console.table(conversations);

    // 5. Conversations with only outbound
    console.log('\n5. CONVERSATIONS WITH ONLY OUTBOUND EMAILS:');
    const [outboundOnly] = await db.execute(`
      SELECT
        c.id,
        LEFT(c.subject, 40) as subject,
        c.customer_email,
        COUNT(e.id) as total_emails
      FROM email_conversations c
      JOIN customer_emails e ON c.id = e.conversation_id
      WHERE c.shop_id = 1 AND c.status = 'active'
      GROUP BY c.id
      HAVING SUM(CASE WHEN e.direction = 'inbound' THEN 1 ELSE 0 END) = 0
      ORDER BY c.last_message_at DESC
      LIMIT 5
    `);
    console.table(outboundOnly);

    // 6. Recent email activity
    console.log('\n6. RECENT EMAIL ACTIVITY (LAST 7 DAYS):');
    const [recentActivity] = await db.execute(`
      SELECT
        direction,
        DATE(COALESCE(sent_at, received_at)) as email_date,
        COUNT(*) as count
      FROM customer_emails
      WHERE shop_id = 1
        AND COALESCE(sent_at, received_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY direction, DATE(COALESCE(sent_at, received_at))
      ORDER BY email_date DESC, direction
    `);
    console.table(recentActivity);

    // 7. Total email counts
    console.log('\n7. TOTAL EMAIL COUNTS:');
    const [totalEmails] = await db.execute(`
      SELECT COUNT(*) as total_emails
      FROM customer_emails
      WHERE shop_id = 1
    `);
    console.log(`Total emails in database: ${totalEmails[0].total_emails}`);

    console.log('\n===== END DIAGNOSTICS =====\n');
    process.exit(0);
  } catch (error) {
    console.error('Error running diagnostics:', error);
    process.exit(1);
  }
}

runDiagnostics();
