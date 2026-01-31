/**
 * Automation Scheduler Service
 *
 * Manages all automated ticketing tasks using cron jobs:
 * 1. Pending Customer Reminders (daily @ 10am EST)
 * 2. Auto-Close After Max Reminders (daily @ 10am EST)
 * 3. Escalation Check (every 15 minutes)
 * 4. SLA Monitoring (every 5 minutes)
 *
 * All jobs check shop settings before executing to respect per-shop configuration.
 */

import cron from 'node-cron';
import db from '../config/database.js';
import { sendEmail } from './zohoMailEnhanced.js';
import { getTicketSettings } from './settingsManager.js';

// Track cron job instances for start/stop control
const jobs = {};

// =============================================================================
// HELPER: Replace placeholders in email templates
// =============================================================================

function replacePlaceholders(template, data) {
  if (!template) return '';

  let result = template;

  const placeholders = {
    customer_name: data.customer_name || 'Valued Customer',
    customer_first_name: data.customer_first_name || 'there',
    customer_email: data.customer_email || '',
    ticket_number: data.ticket_number || '',
    subject: data.subject || '',
    order_number: data.order_number || '',
    company_name: 'TFS Wheels',
    company_email: 'sales@tfswheels.com',
  };

  for (const [key, value] of Object.entries(placeholders)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

// =============================================================================
// JOB 1: PENDING CUSTOMER REMINDERS
// =============================================================================
// Runs daily at 10:00 AM EST
// Checks all tickets with status='pending_customer'
// Sends reminder if 24+ hours since last_message_at or last_reminder_at
// Increments reminder_count
// =============================================================================

async function runPendingCustomerReminders() {
  console.log('[AUTOMATION] Running pending customer reminders check...');

  try {
    const [shops] = await db.execute('SELECT id FROM shops');

    for (const shop of shops) {
      const settings = await getTicketSettings(shop.id);

      if (!settings.pending_reminder_enabled) {
        console.log(`[AUTOMATION] Pending reminders disabled for shop ${shop.id}`);
        continue;
      }

      // Find tickets needing reminders
      const [tickets] = await db.execute(`
        SELECT
          ec.*,
          o.order_number
        FROM email_conversations ec
        LEFT JOIN orders o ON ec.order_id = o.id
        WHERE ec.shop_id = ?
          AND ec.status = 'pending_customer'
          AND ec.reminder_count < ?
          AND (
            (ec.last_reminder_at IS NULL AND ec.last_message_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
            OR (ec.last_reminder_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
          )
      `, [shop.id, settings.pending_reminder_max_count]);

      console.log(`[AUTOMATION] Found ${tickets.length} tickets needing reminders (shop ${shop.id})`);

      for (const ticket of tickets) {
        try {
          const reminderNumber = ticket.reminder_count + 1;
          const templateKey = `pending_reminder_template_${reminderNumber}`;
          const template = settings[templateKey];

          if (!template) {
            console.warn(`[AUTOMATION] No template for reminder ${reminderNumber}, skipping ticket ${ticket.ticket_number}`);
            continue;
          }

          // Replace placeholders
          const bodyHtml = replacePlaceholders(template, {
            customer_name: ticket.customer_name,
            customer_first_name: ticket.customer_name?.split(' ')[0],
            customer_email: ticket.customer_email,
            ticket_number: ticket.ticket_number,
            subject: ticket.subject,
            order_number: ticket.order_number,
          });

          // Send reminder email
          await sendEmail(shop.id, {
            to: ticket.customer_email,
            subject: `Re: ${ticket.subject}`,
            bodyHtml: bodyHtml,
            conversationId: ticket.id,
            inReplyTo: ticket.thread_id
          });

          // Update ticket
          await db.execute(`
            UPDATE email_conversations
            SET reminder_count = reminder_count + 1,
                last_reminder_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
          `, [ticket.id]);

          // Log reminder
          await db.execute(`
            INSERT INTO ticket_reminders (conversation_id, reminder_number, template_used)
            VALUES (?, ?, ?)
          `, [ticket.id, reminderNumber, bodyHtml]);

          // Log activity
          await db.execute(`
            INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
            VALUES (?, 'reminder_sent', ?, ?)
          `, [
            ticket.id,
            `Sent pending customer reminder #${reminderNumber}`,
            JSON.stringify({ reminderNumber, auto: true })
          ]);

          console.log(`[AUTOMATION] ✅ Sent reminder #${reminderNumber} for ticket ${ticket.ticket_number}`);

        } catch (error) {
          console.error(`[AUTOMATION] ❌ Error sending reminder for ticket ${ticket.ticket_number}:`, error.message);
        }
      }
    }

  } catch (error) {
    console.error('[AUTOMATION] Error in pending reminders job:', error);
  }
}

// =============================================================================
// JOB 2: AUTO-CLOSE AFTER MAX REMINDERS
// =============================================================================
// Runs daily at 10:00 AM EST
// Finds tickets with reminder_count >= max_reminders
// Sends final auto-close email (4th email)
// Changes status to 'closed'
// =============================================================================

async function runAutoClose() {
  console.log('[AUTOMATION] Running auto-close check...');

  try {
    const [shops] = await db.execute('SELECT id FROM shops');

    for (const shop of shops) {
      const settings = await getTicketSettings(shop.id);

      if (!settings.auto_close_enabled) {
        console.log(`[AUTOMATION] Auto-close disabled for shop ${shop.id}`);
        continue;
      }

      // Find tickets to auto-close
      const [tickets] = await db.execute(`
        SELECT
          ec.*,
          o.order_number
        FROM email_conversations ec
        LEFT JOIN orders o ON ec.order_id = o.id
        WHERE ec.shop_id = ?
          AND ec.status = 'pending_customer'
          AND ec.reminder_count >= ?
          AND ec.last_reminder_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `, [shop.id, settings.pending_reminder_max_count]);

      console.log(`[AUTOMATION] Found ${tickets.length} tickets to auto-close (shop ${shop.id})`);

      for (const ticket of tickets) {
        try {
          const template = settings.auto_close_template;

          if (!template) {
            console.warn(`[AUTOMATION] No auto-close template, skipping ticket ${ticket.ticket_number}`);
            continue;
          }

          // Replace placeholders
          const bodyHtml = replacePlaceholders(template, {
            customer_name: ticket.customer_name,
            customer_first_name: ticket.customer_name?.split(' ')[0],
            customer_email: ticket.customer_email,
            ticket_number: ticket.ticket_number,
            subject: ticket.subject,
            order_number: ticket.order_number,
          });

          // Send auto-close email
          await sendEmail(shop.id, {
            to: ticket.customer_email,
            subject: `Re: ${ticket.subject}`,
            bodyHtml: bodyHtml,
            conversationId: ticket.id,
            inReplyTo: ticket.thread_id
          });

          // Close ticket
          await db.execute(`
            UPDATE email_conversations
            SET status = 'closed',
                resolved_at = NOW(),
                resolution_time = TIMESTAMPDIFF(MINUTE, created_at, NOW()),
                updated_at = NOW()
            WHERE id = ?
          `, [ticket.id]);

          // Log auto-close reminder
          await db.execute(`
            INSERT INTO ticket_reminders (conversation_id, reminder_number, template_used)
            VALUES (?, 4, ?)
          `, [ticket.id, bodyHtml]);

          // Log activity
          await db.execute(`
            INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
            VALUES (?, 'status_change', 'Auto-closed after max reminders', ?)
          `, [ticket.id, JSON.stringify({ from: 'pending_customer', to: 'closed', auto: true })]);

          console.log(`[AUTOMATION] ✅ Auto-closed ticket ${ticket.ticket_number}`);

        } catch (error) {
          console.error(`[AUTOMATION] ❌ Error auto-closing ticket ${ticket.ticket_number}:`, error.message);
        }
      }
    }

  } catch (error) {
    console.error('[AUTOMATION] Error in auto-close job:', error);
  }
}

// =============================================================================
// JOB 3: ESCALATION CHECK
// =============================================================================
// Runs every 15 minutes
// Finds tickets in 'open' or 'assigned' status
// No activity for X hours (configurable)
// Marks as escalated, notifies all staff
// =============================================================================

async function runEscalationCheck() {
  console.log('[AUTOMATION] Running escalation check...');

  try {
    const [shops] = await db.execute('SELECT id FROM shops');

    for (const shop of shops) {
      const settings = await getTicketSettings(shop.id);

      if (!settings.escalation_enabled) {
        continue; // Skip if disabled
      }

      // Find tickets to escalate
      const [tickets] = await db.execute(`
        SELECT * FROM email_conversations
        WHERE shop_id = ?
          AND status IN ('open', 'assigned')
          AND is_escalated = FALSE
          AND last_message_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
      `, [shop.id, settings.escalation_hours]);

      if (tickets.length === 0) continue;

      console.log(`[AUTOMATION] Found ${tickets.length} tickets to escalate (shop ${shop.id})`);

      for (const ticket of tickets) {
        try {
          // Mark as escalated
          await db.execute(`
            UPDATE email_conversations
            SET is_escalated = TRUE,
                escalated_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
          `, [ticket.id]);

          // Log escalation
          await db.execute(`
            INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
            VALUES (?, 'escalation', ?, ?)
          `, [
            ticket.id,
            `Auto-escalated after ${settings.escalation_hours} hours of inactivity`,
            JSON.stringify({ hours: settings.escalation_hours, auto: true })
          ]);

          console.log(`[AUTOMATION] ✅ Escalated ticket ${ticket.ticket_number}`);

          // Notify all staff if enabled
          if (settings.escalation_notify_all_staff) {
            const [staff] = await db.execute(`
              SELECT email, full_name FROM staff_users
              WHERE shop_id = ? AND is_active = TRUE
            `, [shop.id]);

            for (const member of staff) {
              try {
                await sendEmail(shop.id, {
                  to: member.email,
                  subject: `⚠️ Ticket Escalated: ${ticket.ticket_number}`,
                  bodyHtml: `
                    <p>Hi ${member.full_name},</p>
                    <p>Ticket <strong>${ticket.ticket_number}</strong> has been escalated due to ${settings.escalation_hours} hours of inactivity.</p>
                    <p><strong>Subject:</strong> ${ticket.subject}</p>
                    <p><strong>Customer:</strong> ${ticket.customer_name} (${ticket.customer_email})</p>
                    <p><strong>Status:</strong> ${ticket.status}</p>
                    <p>Please review this ticket as soon as possible.</p>
                    <p>Thanks,<br>TFS Manager Automation</p>
                  `
                });
              } catch (error) {
                console.error(`[AUTOMATION] Error notifying ${member.email}:`, error.message);
              }
            }
          }

        } catch (error) {
          console.error(`[AUTOMATION] Error escalating ticket ${ticket.ticket_number}:`, error.message);
        }
      }
    }

  } catch (error) {
    console.error('[AUTOMATION] Error in escalation job:', error);
  }
}

// =============================================================================
// JOB 4: SLA MONITORING
// =============================================================================
// Runs every 5 minutes
// Tracks first response time and resolution time
// Logs SLA breaches to ticket_activities
// =============================================================================

async function runSLAMonitoring() {
  console.log('[AUTOMATION] Running SLA monitoring...');

  try {
    const [shops] = await db.execute('SELECT id FROM shops');

    for (const shop of shops) {
      const settings = await getTicketSettings(shop.id);

      // Check first response SLA
      const [noResponse] = await db.execute(`
        SELECT * FROM email_conversations
        WHERE shop_id = ?
          AND status IN ('open', 'assigned', 'in_progress')
          AND first_response_at IS NULL
          AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
          AND NOT EXISTS (
            SELECT 1 FROM ticket_activities
            WHERE conversation_id = email_conversations.id
            AND action_type = 'sla_breach'
            AND metadata->>'$.sla_type' = 'first_response'
          )
      `, [shop.id, settings.sla_first_response_hours]);

      for (const ticket of noResponse) {
        await db.execute(`
          INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
          VALUES (?, 'sla_breach', 'First response SLA breached', ?)
        `, [ticket.id, JSON.stringify({ sla_type: 'first_response', target_hours: settings.sla_first_response_hours })]);

        console.log(`[AUTOMATION] ⚠️ First response SLA breach: ${ticket.ticket_number}`);
      }

      // Check resolution SLA
      const [unresolved] = await db.execute(`
        SELECT * FROM email_conversations
        WHERE shop_id = ?
          AND status NOT IN ('resolved', 'closed')
          AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
          AND NOT EXISTS (
            SELECT 1 FROM ticket_activities
            WHERE conversation_id = email_conversations.id
            AND action_type = 'sla_breach'
            AND metadata->>'$.sla_type' = 'resolution'
          )
      `, [shop.id, settings.sla_resolution_hours]);

      for (const ticket of unresolved) {
        await db.execute(`
          INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
          VALUES (?, 'sla_breach', 'Resolution SLA breached', ?)
        `, [ticket.id, JSON.stringify({ sla_type: 'resolution', target_hours: settings.sla_resolution_hours })]);

        console.log(`[AUTOMATION] ⚠️ Resolution SLA breach: ${ticket.ticket_number}`);
      }
    }

  } catch (error) {
    console.error('[AUTOMATION] Error in SLA monitoring job:', error);
  }
}

// =============================================================================
// MANUAL TRIGGER FUNCTIONS (for API endpoints)
// =============================================================================

export async function triggerPendingReminders(shopId) {
  console.log(`[AUTOMATION] Manual trigger: Pending reminders for shop ${shopId}`);
  await runPendingCustomerReminders();
  return { success: true, message: 'Pending reminders check completed' };
}

export async function triggerEscalation(shopId) {
  console.log(`[AUTOMATION] Manual trigger: Escalation check for shop ${shopId}`);
  await runEscalationCheck();
  return { success: true, message: 'Escalation check completed' };
}

export async function triggerAutoClose(shopId) {
  console.log(`[AUTOMATION] Manual trigger: Auto-close for shop ${shopId}`);
  await runAutoClose();
  return { success: true, message: 'Auto-close check completed' };
}

// =============================================================================
// START/STOP SCHEDULER
// =============================================================================

export function startScheduler() {
  console.log('🤖 Starting Automation Scheduler...\n');

  // Job 1 & 2: Pending Reminders + Auto-Close (daily at 10:00 AM EST)
  // Cron: 0 10 * * * (10:00 AM every day)
  jobs.remindersAndClose = cron.schedule('0 10 * * *', async () => {
    console.log('\n🔔 [SCHEDULED] Running daily reminders + auto-close (10:00 AM EST)');
    await runPendingCustomerReminders();
    await runAutoClose();
  }, {
    timezone: 'America/New_York'
  });
  console.log('✅ Scheduled: Pending Reminders + Auto-Close (daily @ 10:00 AM EST)');

  // Job 3: Escalation Check (every 15 minutes)
  // Cron: */15 * * * * (every 15 minutes)
  jobs.escalation = cron.schedule('*/15 * * * *', async () => {
    await runEscalationCheck();
  });
  console.log('✅ Scheduled: Escalation Check (every 15 minutes)');

  // Job 4: SLA Monitoring (every 5 minutes)
  // Cron: */5 * * * * (every 5 minutes)
  jobs.sla = cron.schedule('*/5 * * * *', async () => {
    await runSLAMonitoring();
  });
  console.log('✅ Scheduled: SLA Monitoring (every 5 minutes)');

  console.log('\n✨ Automation Scheduler started successfully!\n');
}

export function stopScheduler() {
  console.log('🛑 Stopping Automation Scheduler...');

  Object.values(jobs).forEach(job => job.stop());

  console.log('✅ Automation Scheduler stopped.');
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  startScheduler,
  stopScheduler,
  triggerPendingReminders,
  triggerEscalation,
  triggerAutoClose
};
