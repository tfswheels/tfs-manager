import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function fixTicketData() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Fix 1: Update 'active' status to 'open'
    console.log('🔧 Fix 1: Updating "active" status to "open"...');
    const [statusUpdate] = await connection.execute(
      "UPDATE email_conversations SET status = 'open' WHERE status = 'active'"
    );
    console.log(`✅ Updated ${statusUpdate.affectedRows} tickets from 'active' to 'open'\n`);

    // Fix 2: Generate ticket numbers for tickets without numbers
    console.log('🔧 Fix 2: Generating ticket numbers for new tickets...');
    const [ticketsWithoutNumbers] = await connection.query(
      'SELECT id, shop_id FROM email_conversations WHERE ticket_number IS NULL'
    );

    console.log(`Found ${ticketsWithoutNumbers.length} tickets without numbers`);

    for (const ticket of ticketsWithoutNumbers) {
      const ticketNumber = `TFS-${ticket.shop_id}-${String(ticket.id).padStart(5, '0')}`;
      await connection.execute(
        'UPDATE email_conversations SET ticket_number = ? WHERE id = ?',
        [ticketNumber, ticket.id]
      );
    }

    console.log(`✅ Generated ticket numbers for ${ticketsWithoutNumbers.length} tickets\n`);

    // Verify fixes
    console.log('🔍 Verifying fixes...\n');

    const [verifyStatus] = await connection.query(
      'SELECT DISTINCT status, COUNT(*) as count FROM email_conversations GROUP BY status'
    );
    console.log('📊 Status distribution after fix:');
    verifyStatus.forEach(s => {
      console.log(`  ${s.status}: ${s.count} tickets`);
    });

    const [verifyNumbers] = await connection.query(
      'SELECT COUNT(*) as count FROM email_conversations WHERE ticket_number IS NULL'
    );
    console.log(`\n📋 Tickets without numbers: ${verifyNumbers[0].count}`);

    // Show sample of fixed tickets
    const [samples] = await connection.query(
      'SELECT id, ticket_number, status FROM email_conversations ORDER BY id DESC LIMIT 5'
    );
    console.log('\n📋 Sample of recent tickets:');
    samples.forEach(t => {
      console.log(`  ${t.ticket_number} - Status: ${t.status}`);
    });

    console.log('\n✅ All fixes completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

fixTicketData();
