#!/usr/bin/env node

import db from '../src/config/database.js';

async function checkSchema() {
  try {
    console.log('📊 Checking email_logs table structure...\n');
    const [columns] = await db.execute('DESCRIBE email_logs');
    console.log('Columns:');
    columns.forEach(col => {
      console.log(`  ${col.Field.padEnd(30)} ${col.Type.padEnd(25)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkSchema();
