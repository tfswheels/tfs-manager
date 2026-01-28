import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function checkTicketData() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Check ticket status and numbers
    const [tickets] = await connection.query(
      'SELECT id, ticket_number, status, subject, unread_count FROM email_conversations ORDER BY id DESC LIMIT 5'
    );

    console.log('📋 Recent tickets:\n');
    tickets.forEach(ticket => {
      console.log(`ID: ${ticket.id}`);
      console.log(`  Ticket Number: ${ticket.ticket_number}`);
      console.log(`  Status: ${ticket.status}`);
      console.log(`  Subject: ${ticket.subject || '(no subject)'}`);
      console.log(`  Unread: ${ticket.unread_count}`);
      console.log('');
    });

    // Check status column type
    const [columns] = await connection.query(
      "SHOW COLUMNS FROM email_conversations WHERE Field = 'status'"
    );
    console.log('📋 Status column info:');
    console.log(columns[0]);

    // Check distinct status values
    const [statuses] = await connection.query(
      'SELECT DISTINCT status, COUNT(*) as count FROM email_conversations GROUP BY status'
    );
    console.log('\n📊 Status distribution:');
    statuses.forEach(s => {
      console.log(`  ${s.status || 'NULL'}: ${s.count} tickets`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Connection closed');
    }
  }
}

checkTicketData();
