import db from '../src/config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🚀 Running migration 007: Create shared daily creation limit...\n');

    const migrationPath = path.join(__dirname, 'migrations', '007_shared_daily_creation_limit.sql');
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

    console.log('\n✅ Migration 007 completed successfully!');
    console.log('\n📝 Summary:');
    console.log('  - Created daily_shopify_creation_limit table');
    console.log('  - Shared 1000/day limit across wheels + tires');
    console.log('  - Tracks daily progress with breakdown by type');

    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await db.end();
    process.exit(1);
  }
}

runMigration();
