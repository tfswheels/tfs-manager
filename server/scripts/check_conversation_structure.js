#!/usr/bin/env node

import db from '../src/config/database.js';

async function checkStructure() {
  try {
    console.log('📊 Checking email_conversations table structure...\n');

    const [columns] = await db.execute('DESCRIBE email_conversations');
    console.log('Columns:');
    columns.forEach(col => {
      console.log(`  ${col.Field.padEnd(30)} ${col.Type.padEnd(25)} ${col.Null === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    console.log('\n📝 Sample conversation data:');
    const [rows] = await db.execute('SELECT * FROM email_conversations LIMIT 1');
    if (rows.length > 0) {
      console.log(JSON.stringify(rows[0], null, 2));
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkStructure();
