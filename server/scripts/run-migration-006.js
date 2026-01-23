import db from '../src/config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🚀 Running migration 006: Drop products table...\n');

    const migrationPath = path.join(__dirname, 'migrations', '006_drop_products_table.sql');
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

    console.log('\n✅ Migration 006 completed successfully!');
    console.log('\n📝 Summary:');
    console.log('  - Dropped products table from tfs-manager database');
    console.log('  - Product webhooks (products/create, products/update) removed from code');
    console.log('  - Inventory data continues to live in tfs-db.shopify_products');

    await db.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await db.end();
    process.exit(1);
  }
}

runMigration();
