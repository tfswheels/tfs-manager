import db from '../src/config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🚀 Running migration 005...\n');

    const migrationPath = path.join(__dirname, 'migrations', '005_scheduled_jobs.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.includes('SELECT') && statement.includes('Status')) {
        // Final status message
        const [rows] = await db.execute(statement);
        console.log(`✅ ${rows[0].Status}`);
      } else {
        await db.execute(statement);
        console.log(`✓ Executed statement`);
      }
    }

    console.log('\n✅ Migration 005 completed successfully!');
    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await db.end();
    process.exit(1);
  }
}

runMigration();
