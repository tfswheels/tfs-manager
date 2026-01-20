import db from '../src/config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seedTemplates() {
  try {
    console.log('🌱 Seeding email templates...');

    const sql = fs.readFileSync(
      path.join(__dirname, 'migrations/004_seed_email_templates.sql'),
      'utf-8'
    );

    // Split by semicolons to execute each statement separately
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement) {
        await db.execute(statement);
      }
    }

    console.log('✅ Email templates seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding templates:', error.message);
    process.exit(1);
  }
}

seedTemplates();
