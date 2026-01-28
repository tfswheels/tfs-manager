import axios from 'axios';

const API_URL = 'http://localhost:3000';
const SHOP = '2f3d7a-2.myshopify.com';

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logSection(message) {
  log(`\n${'='.repeat(60)}`, 'blue');
  log(`${message}`, 'blue');
  log(`${'='.repeat(60)}`, 'blue');
}

async function test() {
  let ticketId = null;
  let staffId = null;

  try {
    logSection('PHASE 2A: Ticket Management APIs Test');

    // Test 1: Get Ticket Stats
    logSection('Test 1: Get Ticket Statistics');
    try {
      const response = await axios.get(`${API_URL}/api/tickets/stats/summary`, {
        params: { shop: SHOP }
      });

      logSuccess('Ticket stats fetched successfully');
      console.log('Stats:', JSON.stringify(response.data.stats, null, 2));
    } catch (error) {
      logError(`Failed to get ticket stats: ${error.response?.data?.error || error.message}`);
    }

    // Test 2: Get Tickets List
    logSection('Test 2: Get Tickets List');
    try {
      const response = await axios.get(`${API_URL}/api/tickets`, {
        params: {
          shop: SHOP,
          limit: 5
        }
      });

      logSuccess(`Fetched ${response.data.tickets.length} tickets`);

      if (response.data.tickets.length > 0) {
        ticketId = response.data.tickets[0].id;
        logInfo(`Using ticket ID: ${ticketId} (${response.data.tickets[0].ticket_number})`);
        console.log('First ticket:', {
          id: response.data.tickets[0].id,
          ticket_number: response.data.tickets[0].ticket_number,
          subject: response.data.tickets[0].subject,
          status: response.data.tickets[0].status,
          assigned_to: response.data.tickets[0].assigned_to_name || 'Unassigned'
        });
      }
    } catch (error) {
      logError(`Failed to get tickets: ${error.response?.data?.error || error.message}`);
    }

    if (!ticketId) {
      logError('No tickets found to test with. Exiting.');
      return;
    }

    // Test 3: Get Single Ticket Details
    logSection('Test 3: Get Ticket Details');
    try {
      const response = await axios.get(`${API_URL}/api/tickets/${ticketId}`);

      logSuccess('Ticket details fetched successfully');
      console.log('Ticket:', {
        id: response.data.ticket.id,
        ticket_number: response.data.ticket.ticket_number,
        subject: response.data.ticket.subject,
        status: response.data.ticket.status,
        priority: response.data.ticket.priority,
        category: response.data.ticket.category,
        messages_count: response.data.messages.length,
        activities_count: response.data.activities.length
      });
    } catch (error) {
      logError(`Failed to get ticket details: ${error.response?.data?.error || error.message}`);
    }

    // Test 4: Get Staff List
    logSection('Test 4: Get Staff Members');
    try {
      const response = await axios.get(`${API_URL}/api/staff`, {
        params: { shop: SHOP }
      });

      logSuccess(`Found ${response.data.staff.length} staff members`);

      if (response.data.staff.length > 0) {
        staffId = response.data.staff[0].id;
        logInfo(`Using staff ID: ${staffId} (${response.data.staff[0].full_name})`);

        response.data.staff.forEach(staff => {
          console.log(`  - ${staff.full_name} <${staff.email}> - ${staff.role}`);
        });
      }
    } catch (error) {
      logError(`Failed to get staff: ${error.response?.data?.error || error.message}`);
    }

    // Test 5: Change Ticket Status
    logSection('Test 5: Change Ticket Status');
    try {
      const response = await axios.put(`${API_URL}/api/tickets/${ticketId}/status`, {
        status: 'in_progress',
        staffId: staffId,
        note: 'Started working on this ticket'
      });

      logSuccess(`Status changed: ${response.data.oldStatus} → ${response.data.newStatus}`);
    } catch (error) {
      logError(`Failed to change status: ${error.response?.data?.error || error.message}`);
    }

    // Test 6: Assign Ticket to Staff
    logSection('Test 6: Assign Ticket to Staff');
    try {
      const response = await axios.put(`${API_URL}/api/tickets/${ticketId}/assign`, {
        assignToId: staffId,
        staffId: staffId,
        note: 'Assigning to myself for resolution'
      });

      logSuccess(`Ticket assigned to staff #${response.data.assignedTo}`);
    } catch (error) {
      logError(`Failed to assign ticket: ${error.response?.data?.error || error.message}`);
    }

    // Test 7: Add Internal Note
    logSection('Test 7: Add Internal Note');
    try {
      const response = await axios.post(`${API_URL}/api/tickets/${ticketId}/note`, {
        staffId: staffId,
        note: 'This is an internal note. Customer contacted via phone, investigating the issue.'
      });

      logSuccess(`Internal note added (Activity ID: ${response.data.activityId})`);
    } catch (error) {
      logError(`Failed to add note: ${error.response?.data?.error || error.message}`);
    }

    // Test 8: Change Priority
    logSection('Test 8: Change Ticket Priority');
    try {
      const response = await axios.put(`${API_URL}/api/tickets/${ticketId}/priority`, {
        priority: 'high',
        staffId: staffId
      });

      logSuccess(`Priority changed: ${response.data.oldPriority} → ${response.data.newPriority}`);
    } catch (error) {
      logError(`Failed to change priority: ${error.response?.data?.error || error.message}`);
    }

    // Test 9: Get Activity Timeline
    logSection('Test 9: Get Activity Timeline');
    try {
      const response = await axios.get(`${API_URL}/api/tickets/${ticketId}/activities`);

      logSuccess(`Fetched ${response.data.activities.length} activities`);

      console.log('\nActivity Timeline:');
      response.data.activities.slice(0, 5).forEach(activity => {
        const staffName = activity.staff_name || 'System';
        const time = new Date(activity.created_at).toLocaleString();
        console.log(`  ${time} - ${staffName}: ${activity.action_type}`);
        if (activity.from_value || activity.to_value) {
          console.log(`    ${activity.from_value || ''} → ${activity.to_value || ''}`);
        }
        if (activity.note) {
          console.log(`    Note: ${activity.note.substring(0, 60)}...`);
        }
      });
    } catch (error) {
      logError(`Failed to get activities: ${error.response?.data?.error || error.message}`);
    }

    // Test 10: Filter Tickets by Status
    logSection('Test 10: Filter Tickets by Status');
    try {
      const response = await axios.get(`${API_URL}/api/tickets`, {
        params: {
          shop: SHOP,
          status: 'in_progress',
          limit: 10
        }
      });

      logSuccess(`Found ${response.data.tickets.length} tickets with status 'in_progress'`);
      console.log(`Total in_progress tickets: ${response.data.total}`);
    } catch (error) {
      logError(`Failed to filter tickets: ${error.response?.data?.error || error.message}`);
    }

    // Test 11: Filter Tickets by Assigned Staff
    logSection('Test 11: Filter Tickets by Assigned Staff');
    try {
      const response = await axios.get(`${API_URL}/api/tickets`, {
        params: {
          shop: SHOP,
          assignedTo: staffId,
          limit: 10
        }
      });

      logSuccess(`Found ${response.data.tickets.length} tickets assigned to staff #${staffId}`);
      console.log(`Total assigned to this staff: ${response.data.total}`);
    } catch (error) {
      logError(`Failed to filter by staff: ${error.response?.data?.error || error.message}`);
    }

    // Test 12: Get Recent Activities (All Tickets)
    logSection('Test 12: Get Recent Activities (Dashboard)');
    try {
      const response = await axios.get(`${API_URL}/api/tickets/activities/recent`, {
        params: {
          shop: SHOP,
          limit: 10
        }
      });

      logSuccess(`Fetched ${response.data.activities.length} recent activities`);

      console.log('\nRecent Activities:');
      response.data.activities.slice(0, 5).forEach(activity => {
        const staffName = activity.staff_name || 'System';
        const ticketNum = activity.ticket_number || `#${activity.conversation_id}`;
        console.log(`  ${ticketNum} - ${staffName}: ${activity.action_type}`);
      });
    } catch (error) {
      logError(`Failed to get recent activities: ${error.response?.data?.error || error.message}`);
    }

    // Test 13: Close Ticket
    logSection('Test 13: Close Ticket');
    try {
      const response = await axios.put(`${API_URL}/api/tickets/${ticketId}/status`, {
        status: 'resolved',
        staffId: staffId,
        note: 'Issue resolved. Customer satisfied.'
      });

      logSuccess(`Ticket resolved! Resolution time: ${response.data.resolutionTime} minutes`);
    } catch (error) {
      logError(`Failed to close ticket: ${error.response?.data?.error || error.message}`);
    }

    // Final Stats
    logSection('Final Ticket Statistics');
    try {
      const response = await axios.get(`${API_URL}/api/tickets/stats/summary`, {
        params: { shop: SHOP }
      });

      console.log('\nTickets by Status:');
      Object.entries(response.data.stats.byStatus).forEach(([status, data]) => {
        console.log(`  ${status}: ${data.count} (${data.unread} unread)`);
      });

      console.log('\nTickets by Category:');
      response.data.stats.byCategory.slice(0, 5).forEach(cat => {
        console.log(`  ${cat.category}: ${cat.count}`);
      });

      console.log('\nOverall:');
      console.log(`  Total Tickets: ${response.data.stats.total}`);
      console.log(`  Unassigned: ${response.data.stats.unassigned}`);
      console.log(`  Urgent: ${response.data.stats.urgent}`);
      console.log(`  Has Unread: ${response.data.stats.has_unread}`);
      console.log(`  Avg Resolution Time: ${Math.round(response.data.stats.avg_resolution_minutes || 0)} minutes`);

      logSuccess('All tests completed successfully! 🎉');
    } catch (error) {
      logError(`Failed to get final stats: ${error.response?.data?.error || error.message}`);
    }

  } catch (error) {
    logError(`Test suite failed: ${error.message}`);
    console.error(error);
  }
}

// Run tests
console.log('\n');
log('╔════════════════════════════════════════════════════════════╗', 'cyan');
log('║         TICKET MANAGEMENT API TEST SUITE                  ║', 'cyan');
log('║                 Phase 2A Verification                      ║', 'cyan');
log('╚════════════════════════════════════════════════════════════╝', 'cyan');
console.log('\n');

test().catch(console.error);
