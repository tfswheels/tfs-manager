import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function checkShopsTable() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Check shops table structure
    console.log('📋 Shops table columns:');
    const [columns] = await connection.query('SHOW COLUMNS FROM shops');
    columns.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type})`);
    });

    // Show sample data
    console.log('\n📋 Sample shops data:');
    const [shops] = await connection.query('SELECT * FROM shops LIMIT 3');
    console.log(JSON.stringify(shops, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

checkShopsTable();
