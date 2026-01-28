import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function checkJsonFields() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Get sample records to check JSON fields
    const [rows] = await connection.query(
      'SELECT id, ticket_number, participants, tags FROM email_conversations LIMIT 10'
    );

    console.log('📋 Checking JSON fields in email_conversations:\n');

    rows.forEach((row, index) => {
      console.log(`Record ${index + 1} (ID: ${row.id}, Ticket: ${row.ticket_number}):`);

      // Check participants
      console.log('  participants:', typeof row.participants, '=', row.participants);
      if (row.participants) {
        try {
          const parsed = JSON.parse(row.participants);
          console.log('  ✅ participants valid JSON:', parsed);
        } catch (e) {
          console.log('  ❌ participants INVALID JSON:', e.message);
        }
      }

      // Check tags
      console.log('  tags:', typeof row.tags, '=', row.tags);
      if (row.tags) {
        try {
          const parsed = JSON.parse(row.tags);
          console.log('  ✅ tags valid JSON:', parsed);
        } catch (e) {
          console.log('  ❌ tags INVALID JSON:', e.message);
        }
      }

      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Connection closed');
    }
  }
}

checkJsonFields();
