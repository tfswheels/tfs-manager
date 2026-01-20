import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkSchema() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });

    console.log('Checking orders table columns:');
    const [ordersColumns] = await connection.query('SHOW COLUMNS FROM orders');
    ordersColumns.forEach(col => console.log(`  ${col.Field}: ${col.Type}`));

    console.log('\nChecking email_templates table columns:');
    const [templateColumns] = await connection.query('SHOW COLUMNS FROM email_templates');
    templateColumns.forEach(col => console.log(`  ${col.Field}: ${col.Type}`));

    console.log('\nChecking email_logs table columns:');
    const [logsColumns] = await connection.query('SHOW COLUMNS FROM email_logs');
    logsColumns.forEach(col => console.log(`  ${col.Field}: ${col.Type}`));

    console.log('\nChecking shop_settings table columns:');
    const [settingsColumns] = await connection.query('SHOW COLUMNS FROM shop_settings');
    settingsColumns.forEach(col => console.log(`  ${col.Field}: ${col.Type}`));

    console.log('\nChecking if new tables exist:');
    const [tables] = await connection.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    console.log('  customer_emails:', tableNames.includes('customer_emails') ? 'EXISTS' : 'MISSING');
    console.log('  email_conversations:', tableNames.includes('email_conversations') ? 'EXISTS' : 'MISSING');
    console.log('  zoho_webhook_logs:', tableNames.includes('zoho_webhook_logs') ? 'EXISTS' : 'MISSING');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkSchema();
