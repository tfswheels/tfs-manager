import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const DB_CONFIG = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306,
  multipleStatements: true
};

async function runMigration() {
  let connection;

  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', '010_comprehensive_email_system.sql');
    console.log('📖 Reading migration file:', migrationPath);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    console.log('🚀 Executing migration...');
    const [results] = await connection.query(sql);

    console.log('✅ Migration completed successfully!');

    // Show results
    if (Array.isArray(results)) {
      const lastResult = results[results.length - 1];
      if (lastResult && lastResult.length > 0) {
        console.log('\n📊 Migration Results:');
        console.table(lastResult);
      }
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

runMigration();
