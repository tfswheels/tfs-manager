import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function runMigrations() {
  let connection;

  try {
    console.log('🔌 Connecting to database...');

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      multipleStatements: true
    });

    console.log('✅ Connected to database');
    console.log(`📊 Database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

    // Read SQL file
    const sqlFile = path.join(__dirname, 'create-tables.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('🚀 Running migrations...\n');

    // Execute SQL
    const [results] = await connection.query(sql);

    console.log('✅ Migrations completed successfully!\n');

    // Show results
    if (Array.isArray(results)) {
      const lastResult = results[results.length - 1];
      if (lastResult && lastResult[0]) {
        console.log(lastResult[0]);
      }
    }

    console.log('\n📋 Tables created:');
    const [tables] = await connection.query('SHOW TABLES');
    tables.forEach(table => {
      console.log(`  ✓ ${Object.values(table)[0]}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

runMigrations();
