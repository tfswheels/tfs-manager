import axios from 'axios';
import db from '../config/database.js';

/**
 * Zoho Mail API Service
 * Handles email sending through Zoho Mail API
 */

const ZOHO_API_BASE = 'https://mail.zoho.com/api';
const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.com';

/**
 * Get Zoho settings from database
 */
async function getZohoSettings(shopId) {
  const [rows] = await db.execute(
    `SELECT zoho_client_id, zoho_client_secret, zoho_refresh_token,
            zoho_access_token, zoho_token_expires_at, email_from_name
     FROM shop_settings
     WHERE shop_id = ?`,
    [shopId]
  );

  if (rows.length === 0) {
    throw new Error('Shop settings not found');
  }

  return rows[0];
}

/**
 * Refresh Zoho access token if expired
 */
async function refreshAccessToken(shopId) {
  const settings = await getZohoSettings(shopId);

  const { zoho_client_id, zoho_client_secret, zoho_refresh_token } = settings;

  if (!zoho_client_id || !zoho_client_secret || !zoho_refresh_token) {
    throw new Error('Zoho OAuth credentials not configured. Please set up Zoho integration in settings.');
  }

  try {
    const response = await axios.post(
      `${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`,
      null,
      {
        params: {
          refresh_token: zoho_refresh_token,
          client_id: zoho_client_id,
          client_secret: zoho_client_secret,
          grant_type: 'refresh_token'
        }
      }
    );

    const { access_token, expires_in } = response.data;

    // Calculate token expiration time
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Update access token in database
    await db.execute(
      `UPDATE shop_settings
       SET zoho_access_token = ?,
           zoho_token_expires_at = ?
       WHERE shop_id = ?`,
      [access_token, expiresAt, shopId]
    );

    return access_token;
  } catch (error) {
    console.error('❌ Failed to refresh Zoho access token:', error.response?.data || error.message);
    throw new Error('Failed to refresh Zoho access token');
  }
}

/**
 * Get valid Zoho access token (refreshes if expired)
 */
async function getAccessToken(shopId) {
  const settings = await getZohoSettings(shopId);

  const { zoho_access_token, zoho_token_expires_at } = settings;

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiresAt = new Date(zoho_token_expires_at);

  if (!zoho_access_token || expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
    console.log('🔄 Zoho access token expired or missing, refreshing...');
    return await refreshAccessToken(shopId);
  }

  return zoho_access_token;
}

/**
 * Replace template variables with actual values
 */
function replaceVariables(template, variables) {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(regex, value || '');
  }

  return result;
}

/**
 * Send email via Zoho Mail API
 *
 * @param {number} shopId - Shop ID
 * @param {object} emailData - Email data
 * @param {string} emailData.to - Recipient email
 * @param {string} emailData.toName - Recipient name
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.body - Email body (plain text)
 * @param {string} [emailData.fromAddress] - From email address (default: sales@tfswheels.com)
 * @param {string} [emailData.fromName] - From name (from settings)
 */
export async function sendEmail(shopId, emailData) {
  try {
    const accessToken = await getAccessToken(shopId);
    const settings = await getZohoSettings(shopId);

    const { to, toName, subject, body, fromAddress, fromName } = emailData;

    // Prepare email payload for Zoho Mail API
    const payload = {
      fromAddress: fromAddress || 'sales@tfswheels.com',
      toAddress: to,
      subject: subject,
      content: body,
      mailFormat: 'plaintext',  // or 'html' when we add HTML support
      askReceipt: 'no'
    };

    // Send email via Zoho Mail API
    const response = await axios.post(
      `${ZOHO_API_BASE}/accounts/self/messages`,
      payload,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Email sent successfully to ${to}`);

    return {
      success: true,
      messageId: response.data.data?.messageId,
      response: response.data
    };

  } catch (error) {
    console.error('❌ Failed to send email via Zoho:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to send email');
  }
}

/**
 * Send email using template
 *
 * @param {number} shopId - Shop ID
 * @param {number} templateId - Email template ID
 * @param {object} recipient - Recipient data
 * @param {string} recipient.email - Recipient email
 * @param {string} recipient.name - Recipient name
 * @param {object} variables - Template variables to replace
 */
export async function sendTemplatedEmail(shopId, templateId, recipient, variables) {
  try {
    // Fetch template
    const [templates] = await db.execute(
      'SELECT * FROM email_templates WHERE id = ? AND shop_id = ?',
      [templateId, shopId]
    );

    if (templates.length === 0) {
      throw new Error('Email template not found');
    }

    const template = templates[0];

    // Replace variables in subject and body
    const subject = replaceVariables(template.subject, variables);
    const body = replaceVariables(template.body, variables);

    // Send email
    const result = await sendEmail(shopId, {
      to: recipient.email,
      toName: recipient.name,
      subject: subject,
      body: body
    });

    // Log email in database
    await db.execute(
      `INSERT INTO email_logs (
        shop_id,
        template_id,
        order_id,
        recipient_email,
        recipient_name,
        subject,
        body,
        status,
        zoho_message_id,
        sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, NOW())`,
      [
        shopId,
        templateId,
        variables.order_id || null,
        recipient.email,
        recipient.name,
        subject,
        body,
        result.messageId || null
      ]
    );

    return result;

  } catch (error) {
    // Log failed email
    await db.execute(
      `INSERT INTO email_logs (
        shop_id,
        template_id,
        recipient_email,
        recipient_name,
        status,
        error_message,
        sent_at
      ) VALUES (?, ?, ?, ?, 'failed', ?, NOW())`,
      [
        shopId,
        templateId,
        recipient.email,
        recipient.name,
        error.message
      ]
    );

    throw error;
  }
}

export default {
  sendEmail,
  sendTemplatedEmail,
  getAccessToken,
  refreshAccessToken
};
