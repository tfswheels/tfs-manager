/**
 * Test Database Connection Script
 * Tests connection to Google Cloud MySQL and displays current schema
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') });

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
};

async function testConnection() {
  console.log('🔌 Testing database connection...');
  console.log(`📍 Host: ${dbConfig.host}`);
  console.log(`👤 User: ${dbConfig.user}`);
  console.log(`🗄️  Database: ${dbConfig.database}\n`);

  let connection;

  try {
    // Create connection
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connection successful!\n');

    // Show all tables
    console.log('📊 Current tables:');
    const [tables] = await connection.execute('SHOW TABLES');
    tables.forEach((row, index) => {
      const tableName = Object.values(row)[0];
      console.log(`   ${index + 1}. ${tableName}`);
    });
    console.log(`\n📈 Total tables: ${tables.length}\n`);

    // Check if migration 012 has been run (ticket tables exist)
    const ticketTables = tables.filter(row => {
      const tableName = Object.values(row)[0];
      return ['email_conversations', 'staff_users', 'ticket_activities'].includes(tableName);
    });

    if (ticketTables.length === 3) {
      console.log('✅ Migration 012 detected (ticket tables exist)');
    } else {
      console.log('⚠️  Migration 012 may not be complete');
    }

    // Check if email_conversations has the columns we need
    console.log('\n📋 Checking email_conversations structure...');
    const [columns] = await connection.execute('DESCRIBE email_conversations');

    const requiredColumns = ['reminder_count', 'last_reminder_at', 'is_escalated', 'escalated_at'];
    const existingColumns = columns.map(col => col.Field);

    console.log('   Existing columns for automation:');
    requiredColumns.forEach(col => {
      if (existingColumns.includes(col)) {
        console.log(`   ✅ ${col} (already exists)`);
      } else {
        console.log(`   ❌ ${col} (will be added by migration 014)`);
      }
    });

    // Check if new tables from migration 014 exist
    console.log('\n📋 Checking for migration 014 tables...');
    const migration014Tables = [
      'ticket_settings',
      'business_hours',
      'canned_responses',
      'email_footer_settings',
      'ticket_reminders',
      'close_ticket_tokens'
    ];

    const existingTableNames = tables.map(row => Object.values(row)[0]);
    migration014Tables.forEach(tableName => {
      if (existingTableNames.includes(tableName)) {
        console.log(`   ✅ ${tableName} (already exists)`);
      } else {
        console.log(`   ❌ ${tableName} (will be created by migration 014)`);
      }
    });

    console.log('\n✨ Database connection test complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n🔍 Full error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed.');
    }
  }
}

testConnection();
