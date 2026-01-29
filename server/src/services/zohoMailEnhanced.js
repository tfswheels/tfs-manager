import axios from 'axios';
import db from '../config/database.js';

/**
 * Enhanced Zoho Mail API Service
 *
 * Features:
 * - Email sending (HTML + plain text)
 * - Inbox fetching (sales@ and support@)
 * - Email threading
 * - Deliverability tracking
 * - OAuth token management
 */

const ZOHO_API_BASE = 'https://mail.zoho.com/api';
const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.com';

// Account IDs for sales@ and support@
const EMAIL_ACCOUNTS = {
  sales: 'sales@tfswheels.com',
  support: 'support@tfswheels.com'
};

// Cache for Zoho account IDs (to avoid repeated API calls)
const accountIdCache = {};

// Hardcoded account IDs for TFS Wheels mailboxes
// These are specific to the TFS Wheels Zoho Mail organization
// NOTE: After OAuth reconnection on 2026-01-27, only sales@ account exists in OAuth access
// Using same account ID for both since support@ is not a separate mailbox
const ACCOUNT_ID_MAP = {
  'sales@tfswheels.com': '4132877000000008002',
  'support@tfswheels.com': '4132877000000008002'  // Using sales@ account ID
};

/**
 * Get Zoho settings from database
 */
async function getZohoSettings(shopId) {
  const [rows] = await db.execute(
    `SELECT zoho_client_id, zoho_client_secret, zoho_refresh_token,
            zoho_access_token, zoho_token_expires_at, email_from_name,
            email_signature, email_signature_plain
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
    throw new Error('Zoho OAuth credentials not configured. Please complete OAuth setup.');
  }

  try {
    console.log('🔄 Refreshing Zoho access token...');

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

    console.log('✅ Zoho access token refreshed');

    return access_token;
  } catch (error) {
    console.error('❌ Failed to refresh Zoho access token:', error.response?.data || error.message);
    throw new Error('Failed to refresh Zoho access token. Please re-authenticate.');
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
    return await refreshAccessToken(shopId);
  }

  return zoho_access_token;
}

/**
 * Get Zoho Mail account ID for a specific email address
 * @param {string} accessToken - Zoho access token
 * @param {string} accountEmail - Email address (e.g., sales@tfswheels.com)
 * @returns {Promise<string>} Account ID
 */
async function getZohoAccountId(accessToken, accountEmail) {
  // Check cache first
  if (accountIdCache[accountEmail]) {
    return accountIdCache[accountEmail];
  }

  // Check hardcoded mapping first (more reliable than API lookup)
  if (ACCOUNT_ID_MAP[accountEmail]) {
    console.log(`✅ Using hardcoded account ID for ${accountEmail}: ${ACCOUNT_ID_MAP[accountEmail]}`);
    accountIdCache[accountEmail] = ACCOUNT_ID_MAP[accountEmail];
    return ACCOUNT_ID_MAP[accountEmail];
  }

  try {
    // Fallback: Try to get account from API
    const response = await axios.get(
      `${ZOHO_API_BASE}/accounts`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      }
    );

    const accounts = response.data.data || [];

    console.log(`📋 Found ${accounts.length} Zoho accounts via API`);

    // Log all accounts for debugging (with full details)
    accounts.forEach(acc => {
      console.log(`  📫 Account ID: ${acc.accountId}`);
      console.log(`     Raw data:`, JSON.stringify(acc, null, 2));
    });

    // Find account matching the email
    // Zoho can return emails as strings or arrays, and may have aliases
    const account = accounts.find(acc => {
      // Helper function to check if an email matches (handles arrays)
      const emailMatches = (field) => {
        if (!field) return false;
        if (typeof field === 'string') return field === accountEmail;
        if (Array.isArray(field)) return field.some(e =>
          typeof e === 'string' ? e === accountEmail :
          typeof e === 'object' ? e.emailAddress === accountEmail || e.address === accountEmail : false
        );
        if (typeof field === 'object') return field.emailAddress === accountEmail || field.address === accountEmail;
        return false;
      };

      return (
        emailMatches(acc.accountAddress) ||
        emailMatches(acc.emailAddress) ||
        emailMatches(acc.primaryEmailAddress) ||
        emailMatches(acc.mailBoxAddress) ||
        emailMatches(acc.fromAddress) ||
        emailMatches(acc.sendMailDetails?.fromAddress) ||
        (acc.accountName && acc.accountName.includes(accountEmail))
      );
    });

    if (!account) {
      console.error(`❌ No account found via API for ${accountEmail}`);
      console.error(`   Available accounts:`, accounts.map(a => ({
        email: a.accountAddress || a.emailAddress || a.primaryEmailAddress,
        id: a.accountId
      })));
      throw new Error(`Zoho account not found for ${accountEmail}`);
    }

    // Cache the account ID
    accountIdCache[accountEmail] = account.accountId;

    console.log(`✅ Found Zoho account ID via API for ${accountEmail}: ${account.accountId}`);

    return account.accountId;

  } catch (error) {
    console.error(`❌ Failed to get Zoho account ID for ${accountEmail}:`, error.response?.data || error.message);
    throw new Error(`Failed to get Zoho account ID for ${accountEmail}`);
  }
}

/**
 * Send email via Zoho Mail API
 *
 * @param {number} shopId - Shop ID
 * @param {object} emailData - Email data
 * @returns {Promise<object>} Send result with message ID
 */
export async function sendEmail(shopId, emailData) {
  try {
    const accessToken = await getAccessToken(shopId);
    const settings = await getZohoSettings(shopId);

    const {
      to,
      toName,
      subject,
      bodyText,
      bodyHtml,
      fromAddress,
      fromName,
      cc,
      bcc,
      inReplyTo,
      references
    } = emailData;

    // Add signature if not already present
    let finalBodyHtml = bodyHtml;
    let finalBodyText = bodyText;

    if (settings.email_signature && bodyHtml && !bodyHtml.includes(settings.email_signature)) {
      finalBodyHtml = bodyHtml + '\n\n' + settings.email_signature;
    }

    if (settings.email_signature_plain && bodyText && !bodyText.includes(settings.email_signature_plain)) {
      finalBodyText = bodyText + '\n\n' + settings.email_signature_plain;
    }

    // Prepare email payload
    const payload = {
      fromAddress: fromAddress || EMAIL_ACCOUNTS.sales,
      toAddress: to,
      subject: subject,
      content: finalBodyHtml || finalBodyText,
      mailFormat: finalBodyHtml ? 'html' : 'plaintext',
      askReceipt: 'no'
    };

    // Add optional fields
    if (cc) payload.ccAddress = Array.isArray(cc) ? cc.join(',') : cc;
    if (bcc) payload.bccAddress = Array.isArray(bcc) ? bcc.join(',') : bcc;
    if (inReplyTo) payload.inReplyTo = inReplyTo;
    if (references) payload.references = references;

    console.log(`📤 Sending email to ${to} via Zoho...`);

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
 * Fetch emails from Zoho inbox with retry logic
 *
 * @param {number} shopId - Shop ID
 * @param {object} options - Fetch options
 * @returns {Promise<Array>} Array of emails
 */
export async function fetchInbox(shopId, options = {}) {
  const {
    accountEmail = EMAIL_ACCOUNTS.sales,
    folderId = '1', // 1 = Inbox
    limit = 50,
    start = 0,
    sortBy = 'receivedTime',
    sortOrder = 'desc',
    searchKey = null
  } = options;

  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const accessToken = await getAccessToken(shopId);

      // Only log on first attempt to reduce noise
      if (attempt === 1) {
        console.log(`📥 Fetching emails from ${accountEmail}...`);
      }

      // Get Zoho account ID for this email address
      const accountId = await getZohoAccountId(accessToken, accountEmail);

      // Build search query - Zoho Mail API requires using search endpoint
      const params = {
        limit: limit,
        start: start,
        searchKey: `fid:${folderId}`  // Search by folder ID
      };

      // Fetch messages using Zoho Mail search API
      const response = await axios.get(
        `${ZOHO_API_BASE}/accounts/${accountId}/messages/search`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`
          },
          params: params,
          timeout: 30000 // 30 second timeout
        }
      );

      const messages = response.data.data || [];

      console.log(`✅ Fetched ${messages.length} emails from ${accountEmail}`);

      return messages;

    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const status = error.response?.status;
      const errorData = error.response?.data || {};

      // Only log errors on last attempt to reduce noise
      if (isLastAttempt) {
        console.error(`❌ Failed to fetch inbox (all ${maxRetries} attempts failed):`, {
          status: status,
          statusText: error.response?.statusText,
          data: errorData,
          message: error.message
        });
      }

      // Don't retry on 4xx errors (client errors) except 429 (rate limit)
      if (status && status >= 400 && status < 500 && status !== 429) {
        console.error(`❌ Client error (${status}), not retrying`);
        throw new Error(`Failed to fetch inbox: ${errorData.message || error.message}`);
      }

      // If this is the last attempt, throw the error
      if (isLastAttempt) {
        throw new Error(`Failed to fetch inbox after ${maxRetries} attempts: ${errorData.message || error.message}`);
      }

      // Wait before retrying (exponential backoff)
      const delay = retryDelay * attempt;
      // Silent retry - no spammy logs
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Fetch full email details including body
 *
 * @param {number} shopId - Shop ID
 * @param {string} messageId - Zoho message ID
 * @param {string} accountEmail - Email account (e.g., sales@tfswheels.com)
 * @param {string} folderId - Folder ID (1=Inbox, 2=Sent, etc.)
 * @returns {Promise<object>} Full email details
 */
export async function fetchEmailDetails(shopId, messageId, accountEmail = EMAIL_ACCOUNTS.sales, folderId = '1') {
  try {
    const accessToken = await getAccessToken(shopId);

    console.log(`📧 Fetching email details for message ${messageId}...`);

    // Get Zoho account ID
    const accountId = await getZohoAccountId(accessToken, accountEmail);

    // Fetch email metadata (from, to, subject, etc.)
    const detailsResponse = await axios.get(
      `${ZOHO_API_BASE}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/details`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      }
    );

    const email = detailsResponse.data.data;

    // Fetch email content (body)
    try {
      const contentResponse = await axios.get(
        `${ZOHO_API_BASE}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/content`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`
          }
        }
      );

      // Add content to email object
      email.content = contentResponse.data.data;
    } catch (contentError) {
      console.warn(`⚠️  Could not fetch content for ${messageId}: ${contentError.response?.data?.errorCode || contentError.message}`);
      // Continue without content - better to have metadata than nothing
      email.content = null;
    }

    console.log(`✅ Fetched email details for ${email.fromAddress}`);

    return email;

  } catch (error) {
    console.error('❌ Failed to fetch email details:', error.response?.data || error.message);
    throw new Error('Failed to fetch email details');
  }
}

/**
 * Fetch email attachments from Zoho
 *
 * @param {number} shopId - Shop ID
 * @param {string} messageId - Zoho message ID
 * @param {string} accountEmail - Email account
 * @param {string} folderId - Folder ID (1=Inbox, 2=Sent)
 * @returns {Promise<Array>} Array of attachment metadata
 */
export async function fetchEmailAttachments(shopId, messageId, accountEmail = EMAIL_ACCOUNTS.sales, folderId = '1') {
  try {
    const accessToken = await getAccessToken(shopId);
    const accountId = await getZohoAccountId(accessToken, accountEmail);

    console.log(`📎 Fetching attachments for message ${messageId}...`);

    // Fetch attachment list
    const response = await axios.get(
      `${ZOHO_API_BASE}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachmentinfo`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      }
    );

    const attachments = response.data.data?.attachments || [];

    if (attachments.length === 0) {
      console.log(`  No attachments found for message ${messageId}`);
      return [];
    }

    console.log(`  Found ${attachments.length} attachment(s)`);
    return attachments;

  } catch (error) {
    // If endpoint doesn't exist or no attachments, return empty array
    if (error.response?.status === 404 || error.response?.data?.code === 'E101') {
      console.log(`  No attachments for message ${messageId}`);
      return [];
    }

    console.error('❌ Failed to fetch attachments:', error.response?.data || error.message);
    return []; // Don't fail the whole email sync if attachments fail
  }
}

/**
 * Download specific attachment from Zoho
 *
 * @param {number} shopId - Shop ID
 * @param {string} messageId - Zoho message ID
 * @param {string} attachmentId - Attachment ID
 * @param {string} accountEmail - Email account
 * @param {string} folderId - Folder ID
 * @returns {Promise<Buffer>} Attachment file data as buffer
 */
export async function downloadAttachment(shopId, messageId, attachmentId, accountEmail = EMAIL_ACCOUNTS.sales, folderId = '1') {
  try {
    const accessToken = await getAccessToken(shopId);
    const accountId = await getZohoAccountId(accessToken, accountEmail);

    console.log(`⬇️  Downloading attachment ${attachmentId}...`);

    const response = await axios.get(
      `${ZOHO_API_BASE}/accounts/${accountId}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        },
        responseType: 'arraybuffer' // Get binary data
      }
    );

    console.log(`✅ Downloaded attachment ${attachmentId}`);
    return Buffer.from(response.data);

  } catch (error) {
    console.error(`❌ Failed to download attachment ${attachmentId}:`, error.response?.data || error.message);
    throw new Error('Failed to download attachment');
  }
}

/**
 * Get tracking pixel URL for email open tracking
 */
export function getTrackingPixelUrl(emailLogId) {
  const baseUrl = process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app';
  return `${baseUrl}/api/emails/track/open/${emailLogId}/pixel.gif`;
}

/**
 * Wrap links for click tracking
 */
export function wrapLinksForTracking(html, emailLogId) {
  const baseUrl = process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app';

  // Replace all href links with tracking redirects
  return html.replace(
    /href="([^"]+)"/g,
    (match, url) => {
      const trackingUrl = `${baseUrl}/api/emails/track/click/${emailLogId}?url=${encodeURIComponent(url)}`;
      return `href="${trackingUrl}"`;
    }
  );
}

/**
 * Add tracking to email before sending
 */
export function addEmailTracking(bodyHtml, emailLogId) {
  if (!bodyHtml) return bodyHtml;

  let trackedHtml = bodyHtml;

  // Add tracking pixel (invisible 1x1 image)
  const trackingPixel = `<img src="${getTrackingPixelUrl(emailLogId)}" width="1" height="1" style="display:none" alt="" />`;
  trackedHtml += trackingPixel;

  // Wrap links for click tracking
  trackedHtml = wrapLinksForTracking(trackedHtml, emailLogId);

  return trackedHtml;
}

/**
 * Mark email as read in Zoho
 */
export async function markAsRead(shopId, messageId) {
  try {
    const accessToken = await getAccessToken(shopId);

    await axios.put(
      `${ZOHO_API_BASE}/accounts/self/messages/${messageId}/read`,
      {},
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      }
    );

    console.log(`✅ Marked email ${messageId} as read`);

  } catch (error) {
    console.error('❌ Failed to mark email as read:', error.response?.data || error.message);
  }
}

/**
 * Archive email in Zoho
 */
export async function archiveEmail(shopId, messageId) {
  try {
    const accessToken = await getAccessToken(shopId);

    await axios.post(
      `${ZOHO_API_BASE}/accounts/self/messages/${messageId}/archive`,
      {},
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      }
    );

    console.log(`✅ Archived email ${messageId}`);

  } catch (error) {
    console.error('❌ Failed to archive email:', error.response?.data || error.message);
  }
}

export default {
  sendEmail,
  fetchInbox,
  fetchEmailDetails,
  getAccessToken,
  refreshAccessToken,
  markAsRead,
  archiveEmail,
  addEmailTracking,
  getTrackingPixelUrl
};
