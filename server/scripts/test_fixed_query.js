import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function testFixedQuery() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Get shop ID
    const [shopRows] = await connection.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      ['2f3d7a-2.myshopify.com']
    );

    if (shopRows.length === 0) {
      console.log('❌ Shop not found');
      return;
    }

    const shopId = shopRows[0].id;
    const limit = 50;
    const offset = 0;

    console.log('✅ Shop ID:', shopId);
    console.log('📋 Testing FIXED query with template literals for LIMIT/OFFSET\n');

    // Build query like the fixed tickets.js does
    let query = `
      SELECT
        ec.*,
        assigned_staff.full_name as assigned_to_name,
        assigned_staff.avatar_url as assigned_to_avatar,
        last_reply_staff.full_name as last_reply_by_name,
        o.shopify_order_id,
        o.order_number
      FROM email_conversations ec
      LEFT JOIN staff_users assigned_staff ON ec.assigned_to = assigned_staff.id
      LEFT JOIN staff_users last_reply_staff ON ec.last_reply_by = last_reply_staff.id
      LEFT JOIN orders o ON ec.order_id = o.id
      WHERE ec.shop_id = ?
        AND ec.is_merged = FALSE
    `;

    const params = [shopId];

    // Use template literal for LIMIT/OFFSET (the fix)
    query += ` ORDER BY ec.last_message_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

    console.log('🧪 Executing query...\n');
    const [tickets] = await connection.execute(query, params);

    console.log('✅ Query SUCCESSFUL!');
    console.log(`📊 Found ${tickets.length} tickets\n`);

    if (tickets.length > 0) {
      console.log('Sample ticket:');
      const ticket = tickets[0];
      console.log('  Ticket Number:', ticket.ticket_number);
      console.log('  Subject:', ticket.subject);
      console.log('  Status:', ticket.status);
      console.log('  Customer:', ticket.customer_name, '<' + ticket.customer_email + '>');
      console.log('  Assigned To:', ticket.assigned_to_name || 'Unassigned');
      console.log('  Priority:', ticket.priority || 'normal');
      console.log('  Messages:', ticket.message_count);
      console.log('  Unread:', ticket.unread_count);
      console.log('  Last Message:', ticket.last_message_at);
    }

  } catch (error) {
    console.error('\n❌ Query failed!');
    console.error('Error:', error.message);
    console.error('\nFull error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

testFixedQuery();
