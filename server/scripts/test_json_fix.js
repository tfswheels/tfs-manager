import mysql from 'mysql2/promise';

const dbConfig = {
  host: '34.67.162.140',
  user: 'tfs',
  password: '[XtlAUU5;"1Ti*Ry',
  database: 'tfs-manager',
  port: 3306
};

async function testJsonFix() {
  let connection;

  try {
    console.log('🔗 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected!\n');

    // Get shop ID
    const [shopRows] = await connection.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      ['2f3d7a-2.myshopify.com']
    );

    const shopId = shopRows[0].id;
    const limit = 5;
    const offset = 0;

    // Build query like tickets.js does
    let query = `
      SELECT
        ec.*,
        assigned_staff.full_name as assigned_to_name,
        assigned_staff.avatar_url as assigned_to_avatar,
        last_reply_staff.full_name as last_reply_by_name,
        o.shopify_order_id,
        o.order_number
      FROM email_conversations ec
      LEFT JOIN staff_users assigned_staff ON ec.assigned_to = assigned_staff.id
      LEFT JOIN staff_users last_reply_staff ON ec.last_reply_by = last_reply_staff.id
      LEFT JOIN orders o ON ec.order_id = o.id
      WHERE ec.shop_id = ?
        AND ec.is_merged = FALSE
      ORDER BY ec.last_message_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
    `;

    console.log('🧪 Fetching tickets...\n');
    const [tickets] = await connection.execute(query, [shopId]);

    console.log(`✅ Found ${tickets.length} tickets\n`);

    // Test the JSON parsing logic from the fix
    console.log('🔍 Testing JSON field handling:\n');

    const parsedTickets = tickets.map(ticket => {
      const participants = Array.isArray(ticket.participants) ? ticket.participants :
                          (ticket.participants ? (typeof ticket.participants === 'string' ? JSON.parse(ticket.participants) : []) : []);

      const tags = Array.isArray(ticket.tags) ? ticket.tags :
                   (ticket.tags ? (typeof ticket.tags === 'string' ? JSON.parse(ticket.tags) : []) : []);

      return {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        subject: ticket.subject,
        participants,
        tags
      };
    });

    console.log('✅ Successfully parsed all JSON fields!\n');

    parsedTickets.forEach((ticket, i) => {
      console.log(`Ticket ${i + 1}: ${ticket.ticket_number}`);
      console.log(`  Subject: ${ticket.subject}`);
      console.log(`  Participants (${ticket.participants.length}):`, ticket.participants);
      console.log(`  Tags (${ticket.tags.length}):`, ticket.tags);
      console.log('');
    });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Connection closed');
    }
  }
}

testJsonFix();
