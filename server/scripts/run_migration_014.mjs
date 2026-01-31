/**
 * Run Migration 014: Ticketing System Overhaul
 * Executes the SQL migration file on Google Cloud MySQL
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs/promises';
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
  multipleStatements: true, // CRITICAL: Allow multiple SQL statements
};

async function runMigration() {
  console.log('🚀 Starting Migration 014: Ticketing System Overhaul\n');

  let connection;

  try {
    // Read migration SQL file
    const migrationPath = resolve(__dirname, 'migrations/014_ticketing_system_overhaul.sql');
    console.log(`📄 Reading migration file: ${migrationPath}`);

    const sql = await fs.readFile(migrationPath, 'utf8');
    console.log(`✅ Migration file loaded (${sql.length} characters)\n`);

    // Create connection
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected successfully!\n');

    // Execute migration
    console.log('⚙️  Executing migration SQL...\n');
    const startTime = Date.now();

    const [results] = await connection.query(sql);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`✅ Migration executed successfully in ${duration}s\n`);

    // Get the final summary
    if (Array.isArray(results)) {
      const lastResult = results[results.length - 1];
      if (lastResult && lastResult[0]) {
        console.log('📊 Migration Summary:');
        console.log(lastResult[0]);
      }
    }

    // Verify new tables were created
    console.log('\n🔍 Verifying migration...');
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME IN (
        'ticket_settings',
        'business_hours',
        'canned_responses',
        'email_footer_settings',
        'ticket_reminders',
        'close_ticket_tokens'
      )
    `, [dbConfig.database]);

    console.log(`✅ ${tables.length}/6 new tables created:`);
    tables.forEach(row => console.log(`   - ${row.TABLE_NAME}`));

    // Verify new columns were added
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'email_conversations'
      AND COLUMN_NAME IN ('reminder_count', 'last_reminder_at', 'is_escalated', 'escalated_at')
    `, [dbConfig.database]);

    console.log(`\n✅ ${columns.length}/4 new columns added to email_conversations:`);
    columns.forEach(row => console.log(`   - ${row.COLUMN_NAME}`));

    console.log('\n✨ Migration 014 completed successfully!');

  } catch (error) {
    console.error('\n❌ Migration failed!');
    console.error('Error:', error.message);

    if (error.sql) {
      console.error('\nFailed SQL:', error.sql.substring(0, 200) + '...');
    }

    console.error('\n🔍 Full error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed.');
    }
  }
}

runMigration();
