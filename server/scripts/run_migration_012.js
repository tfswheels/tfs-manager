import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306,
  multipleStatements: true
};

async function runMigration() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log('🚀 Starting Migration 012: Ticketing System Phase 1...\n');

    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '012_ticketing_system_phase1.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    console.log('📝 Executing migration SQL...');
    const [results] = await connection.query(migrationSQL);

    console.log('\n✅ Migration executed successfully!\n');

    // Show summary
    console.log('=== Migration Summary ===\n');

    // Count staff users
    const [staffCount] = await connection.execute(
      'SELECT COUNT(*) as count FROM staff_users'
    );
    console.log(`👥 Staff Users Created: ${staffCount[0].count}`);

    // Count tickets with numbers
    const [ticketCount] = await connection.execute(
      'SELECT COUNT(*) as count FROM email_conversations WHERE ticket_number IS NOT NULL'
    );
    console.log(`🎫 Tickets with Numbers: ${ticketCount[0].count}`);

    // Count categorized tickets
    const [categoryCount] = await connection.execute(
      'SELECT COUNT(*) as count FROM email_conversations WHERE category IS NOT NULL'
    );
    console.log(`📂 Categorized Tickets: ${categoryCount[0].count}`);

    // Show ticket status distribution
    const [statusDist] = await connection.execute(
      'SELECT status, COUNT(*) as count FROM email_conversations GROUP BY status ORDER BY count DESC'
    );
    console.log('\n📊 Ticket Status Distribution:');
    statusDist.forEach(row => {
      console.log(`   ${row.status}: ${row.count}`);
    });

    // Show staff list
    const [staffList] = await connection.execute(
      'SELECT id, full_name, email, role, is_shop_owner FROM staff_users'
    );
    console.log('\n👤 Staff Members:');
    staffList.forEach(staff => {
      const ownerBadge = staff.is_shop_owner ? ' (Owner)' : '';
      console.log(`   ${staff.full_name} <${staff.email}> - ${staff.role}${ownerBadge}`);
    });

    console.log('\n✅ Migration 012 completed successfully!');
    console.log('\n📌 Next Steps:');
    console.log('   1. Run Shopify staff sync to populate real staff data');
    console.log('   2. Test ticket status transitions');
    console.log('   3. Verify ticket activities tracking');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nError details:', error.message);
    console.error('\nSQL Error Code:', error.code);
    console.error('\nSQL State:', error.sqlState);

    if (error.sql) {
      console.error('\nFailed SQL:', error.sql.substring(0, 500) + '...');
    }

    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration().catch(console.error);
