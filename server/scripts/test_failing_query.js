import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function testQuery() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // First get shop_id
    const [shopRows] = await connection.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      ['2f3d7a-2.myshopify.com']
    );

    if (shopRows.length === 0) {
      console.log('❌ Shop not found');
      return;
    }

    const shopId = shopRows[0].id;
    console.log('✅ Shop ID:', shopId);

    // Now test the failing query
    const limit = 50;
    const offset = 0;

    const query = `
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
     ORDER BY ec.last_message_at DESC LIMIT ? OFFSET ?
    `;

    const params = [shopId, limit, offset];

    console.log('\n🧪 Testing query with params:', params);
    console.log('Query:', query);

    const [tickets] = await connection.execute(query, params);

    console.log('\n✅ Query successful!');
    console.log(`Found ${tickets.length} tickets`);

    if (tickets.length > 0) {
      console.log('\nFirst ticket:');
      console.log('  ID:', tickets[0].id);
      console.log('  Ticket Number:', tickets[0].ticket_number);
      console.log('  Subject:', tickets[0].subject);
      console.log('  Status:', tickets[0].status);
    }

  } catch (error) {
    console.error('\n❌ Query failed!');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('SQL State:', error.sqlState);
    console.error('\nFull error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

testQuery();
