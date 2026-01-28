import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function checkMigrationStatus() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Check if staff_users table exists
    console.log('📋 Checking for staff_users table...');
    const [staffTables] = await connection.query(
      "SHOW TABLES LIKE 'staff_users'"
    );
    console.log('staff_users exists:', staffTables.length > 0 ? '✅ YES' : '❌ NO');

    // Check if ticket_activities table exists
    console.log('\n📋 Checking for ticket_activities table...');
    const [activityTables] = await connection.query(
      "SHOW TABLES LIKE 'ticket_activities'"
    );
    console.log('ticket_activities exists:', activityTables.length > 0 ? '✅ YES' : '❌ NO');

    // Check email_conversations columns
    console.log('\n📋 Checking email_conversations columns...');
    const [columns] = await connection.query(
      "SHOW COLUMNS FROM email_conversations"
    );

    const requiredColumns = [
      'assigned_to',
      'status',
      'priority',
      'ticket_number',
      'last_reply_by',
      'resolved_at',
      'resolution_time_minutes',
      'is_merged'
    ];

    console.log('\nRequired columns in email_conversations:');
    requiredColumns.forEach(col => {
      const exists = columns.some(c => c.Field === col);
      console.log(`  ${col}: ${exists ? '✅' : '❌'}`);
    });

    // Show current column names
    console.log('\n📋 All columns in email_conversations:');
    columns.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type})`);
    });

    // Test a simple query
    console.log('\n🧪 Testing simple query on email_conversations...');
    const [testRows] = await connection.query(
      'SELECT id, shop_id FROM email_conversations LIMIT 1'
    );
    console.log('Simple query works:', testRows.length > 0 ? '✅' : '⚠️ No rows');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

checkMigrationStatus();
