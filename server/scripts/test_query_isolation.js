import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function testQueries() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    const shopId = 1;
    const limit = 50;
    const offset = 0;

    // Test 1: Simple query without joins
    console.log('Test 1: Simple query without joins');
    try {
      const [rows1] = await connection.execute(
        'SELECT * FROM email_conversations WHERE shop_id = ? LIMIT ? OFFSET ?',
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows1.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 2: With is_merged check
    console.log('Test 2: With is_merged = FALSE');
    try {
      const [rows2] = await connection.execute(
        'SELECT * FROM email_conversations WHERE shop_id = ? AND is_merged = FALSE LIMIT ? OFFSET ?',
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows2.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 3: With is_merged = 0
    console.log('Test 3: With is_merged = 0');
    try {
      const [rows3] = await connection.execute(
        'SELECT * FROM email_conversations WHERE shop_id = ? AND is_merged = 0 LIMIT ? OFFSET ?',
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows3.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 4: With one LEFT JOIN
    console.log('Test 4: With staff LEFT JOIN');
    try {
      const [rows4] = await connection.execute(
        `SELECT ec.*, s.full_name
         FROM email_conversations ec
         LEFT JOIN staff_users s ON ec.assigned_to = s.id
         WHERE ec.shop_id = ? AND ec.is_merged = 0
         LIMIT ? OFFSET ?`,
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows4.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 5: With orders LEFT JOIN
    console.log('Test 5: With orders LEFT JOIN');
    try {
      const [rows5] = await connection.execute(
        `SELECT ec.*, o.order_number
         FROM email_conversations ec
         LEFT JOIN orders o ON ec.order_id = o.id
         WHERE ec.shop_id = ? AND ec.is_merged = 0
         LIMIT ? OFFSET ?`,
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows5.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 6: Full query with all JOINs
    console.log('Test 6: Full query with all JOINs');
    try {
      const [rows6] = await connection.execute(
        `SELECT
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
        WHERE ec.shop_id = ? AND ec.is_merged = 0
        ORDER BY ec.last_message_at DESC
        LIMIT ? OFFSET ?`,
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows6.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
      console.log('Full error:', error);
    }

  } catch (error) {
    console.error('❌ Connection error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Connection closed');
    }
  }
}

testQueries();
