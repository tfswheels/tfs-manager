import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function testLimitIssue() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    const shopId = 1;
    const limit = 50;
    const offset = 0;

    // Test 1: Without LIMIT/OFFSET
    console.log('Test 1: Without LIMIT/OFFSET');
    try {
      const [rows1] = await connection.execute(
        'SELECT id, subject FROM email_conversations WHERE shop_id = ?',
        [shopId]
      );
      console.log('✅ SUCCESS - Found', rows1.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 2: With hardcoded LIMIT
    console.log('Test 2: With hardcoded LIMIT');
    try {
      const [rows2] = await connection.execute(
        'SELECT id, subject FROM email_conversations WHERE shop_id = ? LIMIT 5',
        [shopId]
      );
      console.log('✅ SUCCESS - Found', rows2.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 3: With LIMIT as string interpolation (using query instead of execute)
    console.log('Test 3: With LIMIT using query() method');
    try {
      const [rows3] = await connection.query(
        'SELECT id, subject FROM email_conversations WHERE shop_id = ? LIMIT ? OFFSET ?',
        [shopId, limit, offset]
      );
      console.log('✅ SUCCESS - Found', rows3.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 4: With LIMIT placeholder and integer values
    console.log('Test 4: With LIMIT using parseInt()');
    try {
      const [rows4] = await connection.execute(
        'SELECT id, subject FROM email_conversations WHERE shop_id = ? LIMIT ? OFFSET ?',
        [shopId, parseInt(limit), parseInt(offset)]
      );
      console.log('✅ SUCCESS - Found', rows4.length, 'rows\n');
    } catch (error) {
      console.log('❌ FAILED:', error.message, '\n');
    }

    // Test 5: Check parameter types
    console.log('Test 5: Parameter types check');
    console.log('  shopId type:', typeof shopId, '=', shopId);
    console.log('  limit type:', typeof limit, '=', limit);
    console.log('  offset type:', typeof offset, '=', offset);
    console.log('  parseInt(limit) type:', typeof parseInt(limit), '=', parseInt(limit));

  } catch (error) {
    console.error('❌ Connection error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

testLimitIssue();
