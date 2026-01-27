import db from '../src/config/database.js';
import fs from 'fs';

async function runMigration() {
  try {
    console.log('🔄 Running migration 011: Add SKU to order_items...');

    // Add SKU column
    await db.execute(`
      ALTER TABLE order_items
      ADD COLUMN sku VARCHAR(255) AFTER variant_id,
      ADD INDEX idx_sku (sku)
    `);

    console.log('✅ Migration 011 completed successfully!');
    console.log('   - Added sku column to order_items table');
    console.log('   - Added index on sku column for faster searches');

    process.exit(0);
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('⚠️  SKU column already exists, skipping migration');
      process.exit(0);
    }
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
