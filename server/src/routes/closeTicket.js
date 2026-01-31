/**
 * Close Ticket Webhook (Public Endpoint)
 *
 * Allows customers to close tickets via secure link in email footer.
 *
 * - GET /api/webhooks/close-ticket/:conversationId/:token
 *
 * Flow:
 * 1. Validate token exists and matches conversation
 * 2. Check if token has expired (if expiration set)
 * 3. Close the ticket
 * 4. Mark token as used
 * 5. Send confirmation email to customer
 * 6. Display HTML success page
 */

import express from 'express';
import crypto from 'crypto';
import db from '../config/database.js';
import { sendEmail } from '../services/zohoMailEnhanced.js';
import { getTicketSettings } from '../services/settingsManager.js';

const router = express.Router();

// =============================================================================
// GENERATE CLOSE TICKET TOKEN
// =============================================================================

/**
 * Generate secure token for closing ticket
 * @param {number} conversationId - Ticket ID
 * @returns {Promise<string>} Secure token (64 char hex)
 */
export async function generateCloseTicketToken(conversationId) {
  const token = crypto.randomBytes(32).toString('hex'); // 64 char hex string

  // Insert token into database (no expiration by default)
  await db.execute(
    `INSERT INTO close_ticket_tokens (conversation_id, token, expires_at)
     VALUES (?, ?, NULL)`,
    [conversationId, token]
  );

  return token;
}

// =============================================================================
// CLOSE TICKET VIA TOKEN (Public Endpoint)
// =============================================================================

router.get('/:conversationId/:token', async (req, res) => {
  try {
    const { conversationId, token } = req.params;

    // Validate token
    const [tokens] = await db.execute(
      `SELECT * FROM close_ticket_tokens
       WHERE conversation_id = ? AND token = ?`,
      [parseInt(conversationId), token]
    );

    if (tokens.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invalid Link</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Invalid Link</h1>
            <p>This close ticket link is invalid or has already been used.</p>
            <p>If you need further assistance, please reply to the ticket email.</p>
          </div>
        </body>
        </html>
      `);
    }

    const tokenData = tokens[0];

    // Check if token has been used
    if (tokenData.used_at) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Already Closed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #f59e0b; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚠️ Already Closed</h1>
            <p>This ticket has already been closed using this link.</p>
            <p>If you need to reopen it, simply reply to any email in this thread.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Check if token has expired
    if (tokenData.expires_at && new Date() > new Date(tokenData.expires_at)) {
      return res.status(410).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link Expired</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⌛ Link Expired</h1>
            <p>This close ticket link has expired.</p>
            <p>Please reply to the ticket email if you need further assistance.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Get ticket details
    const [tickets] = await db.execute(
      'SELECT * FROM email_conversations WHERE id = ?',
      [parseInt(conversationId)]
    );

    if (tickets.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Ticket Not Found</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #dc2626; margin-bottom: 16px; }
            p { color: #64748b; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Ticket Not Found</h1>
            <p>We couldn't find this ticket in our system.</p>
          </div>
        </body>
        </html>
      `);
    }

    const ticket = tickets[0];

    // Close the ticket
    await db.execute(
      `UPDATE email_conversations
       SET status = 'closed',
           resolved_at = NOW(),
           resolution_time = TIMESTAMPDIFF(MINUTE, created_at, NOW()),
           updated_at = NOW()
       WHERE id = ?`,
      [ticket.id]
    );

    // Mark token as used
    await db.execute(
      `UPDATE close_ticket_tokens
       SET used_at = NOW()
       WHERE id = ?`,
      [tokenData.id]
    );

    // Log activity
    await db.execute(
      `INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
       VALUES (?, 'status_change', 'Customer closed ticket via email link', ?)`,
      [ticket.id, JSON.stringify({ from: ticket.status, to: 'closed', method: 'close_link' })]
    );

    // Send confirmation email if enabled
    const settings = await getTicketSettings(ticket.shop_id);

    if (settings.ticket_closed_confirmation_enabled && settings.ticket_closed_confirmation_template) {
      const template = settings.ticket_closed_confirmation_template
        .replace(/{{customer_name}}/g, ticket.customer_name || 'Valued Customer')
        .replace(/{{customer_first_name}}/g, ticket.customer_name?.split(' ')[0] || 'there')
        .replace(/{{ticket_number}}/g, ticket.ticket_number);

      try {
        await sendEmail(ticket.shop_id, {
          to: ticket.customer_email,
          subject: `Ticket Closed: ${ticket.ticket_number}`,
          bodyHtml: template,
          conversationId: ticket.id
        });
      } catch (error) {
        console.error('[CLOSE TICKET] Error sending confirmation email:', error.message);
      }
    }

    // Display success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ticket Closed</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            text-align: center;
          }
          h1 {
            color: #10b981;
            margin-bottom: 16px;
            font-size: 28px;
          }
          p {
            color: #64748b;
            line-height: 1.6;
            margin: 12px 0;
          }
          .ticket-number {
            background: #f1f5f9;
            padding: 12px 20px;
            border-radius: 8px;
            font-family: monospace;
            font-weight: bold;
            margin: 20px 0;
            color: #0f172a;
          }
          .note {
            background: #eff6ff;
            border-left: 4px solid #3b82f6;
            padding: 16px;
            margin-top: 24px;
            text-align: left;
            border-radius: 4px;
          }
          .note strong { color: #1e40af; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Ticket Closed</h1>
          <p>Your ticket has been closed successfully.</p>
          <div class="ticket-number">${ticket.ticket_number}</div>
          <p>If you need further assistance, no worries! Just reply to any email from this thread and we'll reopen it immediately.</p>
          <div class="note">
            <strong>💡 Tip:</strong> You'll receive a confirmation email shortly. Keep it for your records!
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('[CLOSE TICKET] Error closing ticket:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            text-align: center;
          }
          h1 { color: #dc2626; margin-bottom: 16px; }
          p { color: #64748b; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>An error occurred while closing your ticket.</p>
          <p>Please try again or contact support directly.</p>
        </div>
      </body>
      </html>
    `);
  }
});

export default router;
