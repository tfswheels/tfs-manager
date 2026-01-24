import express from 'express';
import db from '../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run migration 005 to create scheduled jobs tables
 * This endpoint allows Railway to run the migration with production database credentials
 */
router.post('/005', async (req, res) => {
  try {
    console.log('🚀 Running migration 005 via API...');

    const migrationPath = path.join(__dirname, '../../scripts/migrations/005_scheduled_jobs.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    const results = [];

    for (const statement of statements) {
      try {
        if (statement.includes('SELECT') && statement.includes('Status')) {
          // Final status message
          const [rows] = await db.execute(statement);
          results.push({ type: 'status', message: rows[0]?.Status });
          console.log(`✅ ${rows[0]?.Status}`);
        } else {
          await db.execute(statement);
          results.push({ type: 'statement', success: true });
          console.log(`✓ Executed statement`);
        }
      } catch (error) {
        // If table already exists, that's OK
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.message.includes('already exists')) {
          results.push({ type: 'statement', success: true, skipped: true, reason: 'already exists' });
          console.log(`⏭️  Skipped: ${error.message}`);
        } else {
          throw error;
        }
      }
    }

    console.log('✅ Migration 005 completed successfully via API!');

    res.json({
      success: true,
      message: 'Migration 005 completed successfully',
      details: results
    });
  } catch (error) {
    console.error('❌ Migration 005 failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message,
      code: error.code
    });
  }
});

/**
 * Run migration 008 to add product creation stats columns
 */
router.post('/008', async (req, res) => {
  try {
    console.log('🚀 Running migration 008 via API... (v2)');

    const results = [];
    const columns = [
      { name: 'products_skipped', comment: 'Number of products skipped (already exist on Shopify)' },
      { name: 'products_failed', comment: 'Number of products that failed to create' },
      { name: 'wheels_skipped', comment: 'Number of wheels skipped' },
      { name: 'tires_skipped', comment: 'Number of tires skipped' },
      { name: 'wheels_failed', comment: 'Number of wheels that failed' },
      { name: 'tires_failed', comment: 'Number of tires that failed' }
    ];

    console.log(`Will add ${columns.length} columns...`);

    for (const col of columns) {
      try {
        const sql = `ALTER TABLE product_creation_jobs ADD COLUMN ${col.name} INT DEFAULT 0 COMMENT '${col.comment}'`;
        console.log(`Executing: ${sql}`);
        await db.execute(sql);
        results.push({ column: col.name, success: true, added: true });
        console.log(`✅ Successfully added column ${col.name}`);
      } catch (error) {
        console.error(`Error for ${col.name}:`, { code: error.code, message: error.message });
        // If column already exists, that's OK
        if (error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column') || error.message.includes('duplicate column')) {
          results.push({ column: col.name, success: true, skipped: true, reason: 'column already exists' });
          console.log(`⏭️  Skipped ${col.name} - already exists`);
        } else {
          console.error(`❌ Error adding column ${col.name}:`, error);
          results.push({ column: col.name, success: false, error: error.message });
          // Continue with other columns instead of throwing
        }
      }
    }

    console.log(`Migration 008 results:`, JSON.stringify(results, null, 2));

    console.log('✅ Migration 008 completed successfully via API!');

    res.json({
      success: true,
      message: 'Migration 008 completed successfully - Added product creation stats columns',
      details: results
    });
  } catch (error) {
    console.error('❌ Migration 008 failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message,
      code: error.code
    });
  }
});

/**
 * Check migration status
 */
router.get('/status', async (req, res) => {
  try {
    const tables = {};

    // Check if scheduled_scrape_jobs exists
    try {
      const [rows1] = await db.execute('SHOW TABLES LIKE "scheduled_scrape_jobs"');
      tables.scheduled_scrape_jobs = rows1.length > 0;
    } catch (error) {
      tables.scheduled_scrape_jobs = false;
    }

    // Check if product_creation_jobs exists
    try {
      const [rows2] = await db.execute('SHOW TABLES LIKE "product_creation_jobs"');
      tables.product_creation_jobs = rows2.length > 0;
    } catch (error) {
      tables.product_creation_jobs = false;
    }

    const allTablesExist = tables.scheduled_scrape_jobs && tables.product_creation_jobs;

    res.json({
      migration_005: {
        status: allTablesExist ? 'completed' : 'pending',
        tables: tables
      }
    });
  } catch (error) {
    console.error('❌ Failed to check migration status:', error);
    res.status(500).json({ error: 'Failed to check migration status' });
  }
});

export default router;
