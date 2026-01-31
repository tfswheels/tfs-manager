/**
 * Settings Manager Service
 *
 * Handles all CRUD operations for ticketing system settings:
 * - ticket_settings (general configuration)
 * - business_hours (Mon-Sun schedules)
 * - email_footer_settings (footer customization)
 *
 * All functions are per-shop to support future multi-shop deployment.
 */

import db from '../config/database.js';

// =============================================================================
// TICKET SETTINGS
// =============================================================================

/**
 * Get ticket settings for a shop
 * @param {number} shopId - Shop ID
 * @returns {Promise<Object>} Settings object
 */
export async function getTicketSettings(shopId) {
  const [rows] = await db.execute(
    'SELECT * FROM ticket_settings WHERE shop_id = ?',
    [shopId]
  );

  if (rows.length === 0) {
    // Return defaults if no settings exist (shouldn't happen after migration)
    return {
      auto_response_enabled: true,
      pending_reminder_enabled: true,
      escalation_enabled: true,
      auto_close_enabled: true,
      // ... other defaults
    };
  }

  return rows[0];
}

/**
 * Update ticket settings for a shop
 * @param {number} shopId - Shop ID
 * @param {Object} updates - Partial settings object to update
 * @returns {Promise<Object>} Updated settings
 */
export async function updateTicketSettings(shopId, updates) {
  // Build SET clause dynamically from updates object
  const allowedFields = [
    'auto_response_enabled',
    'auto_response_business_hours',
    'auto_response_after_hours',
    'auto_response_delay_minutes',
    'pending_reminder_enabled',
    'pending_reminder_send_time',
    'pending_reminder_template_1',
    'pending_reminder_template_2',
    'pending_reminder_template_3',
    'pending_reminder_max_count',
    'auto_close_enabled',
    'auto_close_template',
    'ticket_closed_confirmation_enabled',
    'ticket_closed_confirmation_template',
    'escalation_enabled',
    'escalation_hours',
    'escalation_notify_all_staff',
    'sla_first_response_hours',
    'sla_resolution_hours',
    'default_assignee_id',
    'notify_on_new_ticket',
    'notify_on_escalation',
    'notify_on_customer_reply',
  ];

  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = [...fields.map(field => updates[field]), shopId];

  await db.execute(
    `UPDATE ticket_settings SET ${setClause}, updated_at = NOW() WHERE shop_id = ?`,
    values
  );

  return await getTicketSettings(shopId);
}

// =============================================================================
// BUSINESS HOURS
// =============================================================================

/**
 * Get business hours for all 7 days
 * @param {number} shopId - Shop ID
 * @returns {Promise<Array>} Array of 7 business_hours objects (Sunday-Saturday)
 */
export async function getBusinessHours(shopId) {
  const [rows] = await db.execute(
    'SELECT * FROM business_hours WHERE shop_id = ? ORDER BY day_of_week',
    [shopId]
  );

  return rows;
}

/**
 * Update business hours for one or all days
 * @param {number} shopId - Shop ID
 * @param {Array} hoursArray - Array of {day_of_week, is_open, open_time, close_time, timezone}
 * @returns {Promise<Array>} Updated business hours
 */
export async function updateBusinessHours(shopId, hoursArray) {
  if (!Array.isArray(hoursArray)) {
    throw new Error('hoursArray must be an array');
  }

  // Update each day
  for (const hours of hoursArray) {
    const { day_of_week, is_open, open_time, close_time, timezone } = hours;

    await db.execute(
      `UPDATE business_hours
       SET is_open = ?,
           open_time = ?,
           close_time = ?,
           timezone = ?,
           updated_at = NOW()
       WHERE shop_id = ? AND day_of_week = ?`,
      [is_open, open_time, close_time, timezone, shopId, day_of_week]
    );
  }

  return await getBusinessHours(shopId);
}

/**
 * Check if currently within business hours
 * @param {number} shopId - Shop ID
 * @returns {Promise<Boolean>} True if currently in business hours
 */
export async function isWithinBusinessHours(shopId) {
  const hours = await getBusinessHours(shopId);

  if (hours.length === 0) {
    return false; // Default to closed if no hours configured
  }

  // Get current day and time in shop's timezone
  const timezone = hours[0].timezone || 'America/New_York';
  const now = new Date();

  // Get day of week (0 = Sunday, 6 = Saturday)
  const dayOfWeek = now.getDay();

  // Find business hours for today
  const todayHours = hours.find(h => h.day_of_week === dayOfWeek);

  if (!todayHours || !todayHours.is_open) {
    return false; // Closed today
  }

  // Get current time in HH:MM:SS format
  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Compare times (simple string comparison works for HH:MM:SS)
  const isAfterOpen = currentTime >= todayHours.open_time;
  const isBeforeClose = currentTime <= todayHours.close_time;

  return isAfterOpen && isBeforeClose;
}

// =============================================================================
// EMAIL FOOTER SETTINGS
// =============================================================================

/**
 * Get email footer settings for a shop
 * @param {number} shopId - Shop ID
 * @returns {Promise<Object>} Footer settings object
 */
export async function getEmailFooterSettings(shopId) {
  const [rows] = await db.execute(
    'SELECT * FROM email_footer_settings WHERE shop_id = ?',
    [shopId]
  );

  if (rows.length === 0) {
    // Return defaults if no settings exist (shouldn't happen after migration)
    return {
      company_name: 'TFS Wheels',
      email: 'sales@tfswheels.com',
      show_close_ticket_link: true,
      close_ticket_link_text: 'Close this ticket',
    };
  }

  return rows[0];
}

/**
 * Update email footer settings for a shop
 * @param {number} shopId - Shop ID
 * @param {Object} updates - Partial footer settings object
 * @returns {Promise<Object>} Updated footer settings
 */
export async function updateEmailFooterSettings(shopId, updates) {
  const allowedFields = [
    'logo_url',
    'logo_alt_text',
    'company_name',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'zip',
    'country',
    'phone',
    'email',
    'website_url',
    'facebook_url',
    'instagram_url',
    'twitter_url',
    'linkedin_url',
    'google_review_url',
    'trustpilot_url',
    'show_close_ticket_link',
    'close_ticket_link_text',
  ];

  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = [...fields.map(field => updates[field]), shopId];

  await db.execute(
    `UPDATE email_footer_settings SET ${setClause}, updated_at = NOW() WHERE shop_id = ?`,
    values
  );

  return await getEmailFooterSettings(shopId);
}

// =============================================================================
// ALL SETTINGS (Convenience function)
// =============================================================================

/**
 * Get all settings for a shop in one call
 * @param {number} shopId - Shop ID
 * @returns {Promise<Object>} Object with ticketSettings, businessHours, footerSettings
 */
export async function getAllSettings(shopId) {
  const [ticketSettings, businessHours, footerSettings] = await Promise.all([
    getTicketSettings(shopId),
    getBusinessHours(shopId),
    getEmailFooterSettings(shopId),
  ]);

  return {
    ticketSettings,
    businessHours,
    footerSettings,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  getTicketSettings,
  updateTicketSettings,
  getBusinessHours,
  updateBusinessHours,
  isWithinBusinessHours,
  getEmailFooterSettings,
  updateEmailFooterSettings,
  getAllSettings,
};
