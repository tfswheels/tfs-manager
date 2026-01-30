#!/usr/bin/env node
import db from '../src/config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log('🔄 Running migration 013: Add Zoho attachment metadata...\n');

    const migrationPath = path.join(__dirname, '../migrations/013_add_zoho_attachment_metadata.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 60)}...`);
      await db.execute(statement);
    }

    console.log('\n✅ Migration 013 completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
