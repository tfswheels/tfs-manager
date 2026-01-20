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

    // Run create-tables.sql first
    const createTablesFile = path.join(__dirname, 'create-tables.sql');
    if (fs.existsSync(createTablesFile)) {
      console.log('🚀 Running create-tables.sql...\n');
      const sql = fs.readFileSync(createTablesFile, 'utf8');
      await connection.query(sql);
      console.log('✅ Base tables created\n');
    }

    // Run migrations from migrations folder
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Run in alphabetical order

      if (migrationFiles.length > 0) {
        console.log('🔄 Running migrations...\n');

        for (const file of migrationFiles) {
          console.log(`  Running ${file}...`);
          const migrationPath = path.join(migrationsDir, file);
          const sql = fs.readFileSync(migrationPath, 'utf8');
          await connection.query(sql);
          console.log(`  ✅ ${file} completed`);
        }

        console.log('\n✅ All migrations completed successfully!\n');
      }
    }

    console.log('📋 Tables in database:');
    const [tables] = await connection.query('SHOW TABLES');
    tables.forEach(table => {
      console.log(`  ✓ ${Object.values(table)[0]}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

runMigrations();
