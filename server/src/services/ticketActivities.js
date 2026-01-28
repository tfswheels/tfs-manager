/**
 * Ticket Activity Tracking Service
 * Logs all actions performed on tickets for audit trail and timeline
 */

import db from '../config/database.js';

/**
 * Log a ticket activity
 * @param {Object} params - Activity parameters
 * @param {number} params.conversationId - Ticket/conversation ID
 * @param {number|null} params.staffId - Staff member who performed action (null for system)
 * @param {string} params.actionType - Type of action (status_change, reply, assignment, note, etc.)
 * @param {string|null} params.fromValue - Previous value
 * @param {string|null} params.toValue - New value
 * @param {string|null} params.note - Additional note/comment
 * @param {Object|null} params.metadata - Additional metadata as JSON
 * @param {number|null} params.emailId - Related email ID (if action is a reply)
 * @returns {Promise<number>} Activity ID
 */
export async function logActivity({
  conversationId,
  staffId = null,
  actionType,
  fromValue = null,
  toValue = null,
  note = null,
  metadata = null,
  emailId = null
}) {
  try {
    const [result] = await db.execute(
      `INSERT INTO ticket_activities (
        conversation_id,
        staff_id,
        action_type,
        from_value,
        to_value,
        note,
        metadata,
        email_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conversationId,
        staffId,
        actionType,
        fromValue,
        toValue,
        note,
        metadata ? JSON.stringify(metadata) : null,
        emailId
      ]
    );

    return result.insertId;
  } catch (error) {
    console.error('❌ Error logging ticket activity:', error);
    throw error;
  }
}

/**
 * Log a status change
 * @param {number} conversationId - Ticket ID
 * @param {number|null} staffId - Staff who changed status
 * @param {string} oldStatus - Previous status
 * @param {string} newStatus - New status
 * @returns {Promise<number>} Activity ID
 */
export async function logStatusChange(conversationId, staffId, oldStatus, newStatus) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'status_change',
    fromValue: oldStatus,
    toValue: newStatus
  });
}

/**
 * Log a ticket assignment
 * @param {number} conversationId - Ticket ID
 * @param {number|null} staffId - Staff who made the assignment
 * @param {number|null} oldAssigneeId - Previous assignee ID
 * @param {number|null} newAssigneeId - New assignee ID
 * @returns {Promise<number>} Activity ID
 */
export async function logAssignment(conversationId, staffId, oldAssigneeId, newAssigneeId) {
  // Get assignee names
  let oldAssigneeName = 'Unassigned';
  let newAssigneeName = 'Unassigned';

  if (oldAssigneeId) {
    const [oldRows] = await db.execute(
      'SELECT full_name FROM staff_users WHERE id = ?',
      [oldAssigneeId]
    );
    if (oldRows.length > 0) {
      oldAssigneeName = oldRows[0].full_name;
    }
  }

  if (newAssigneeId) {
    const [newRows] = await db.execute(
      'SELECT full_name FROM staff_users WHERE id = ?',
      [newAssigneeId]
    );
    if (newRows.length > 0) {
      newAssigneeName = newRows[0].full_name;
    }
  }

  return logActivity({
    conversationId,
    staffId,
    actionType: 'assignment',
    fromValue: oldAssigneeName,
    toValue: newAssigneeName,
    metadata: {
      old_assignee_id: oldAssigneeId,
      new_assignee_id: newAssigneeId
    }
  });
}

/**
 * Log a reply
 * @param {number} conversationId - Ticket ID
 * @param {number} staffId - Staff who replied
 * @param {number} emailId - Email record ID
 * @param {string} direction - 'inbound' or 'outbound'
 * @returns {Promise<number>} Activity ID
 */
export async function logReply(conversationId, staffId, emailId, direction = 'outbound') {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'reply',
    toValue: direction,
    emailId,
    metadata: { direction }
  });
}

/**
 * Log an internal note
 * @param {number} conversationId - Ticket ID
 * @param {number} staffId - Staff who added note
 * @param {string} noteText - Note content
 * @returns {Promise<number>} Activity ID
 */
export async function logNote(conversationId, staffId, noteText) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'note',
    note: noteText
  });
}

/**
 * Log a priority change
 * @param {number} conversationId - Ticket ID
 * @param {number|null} staffId - Staff who changed priority
 * @param {string} oldPriority - Previous priority
 * @param {string} newPriority - New priority
 * @returns {Promise<number>} Activity ID
 */
export async function logPriorityChange(conversationId, staffId, oldPriority, newPriority) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'priority_change',
    fromValue: oldPriority,
    toValue: newPriority
  });
}

/**
 * Log a tag addition
 * @param {number} conversationId - Ticket ID
 * @param {number|null} staffId - Staff who added tag
 * @param {string} tag - Tag added
 * @returns {Promise<number>} Activity ID
 */
export async function logTagAdd(conversationId, staffId, tag) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'tag_add',
    toValue: tag
  });
}

/**
 * Log a tag removal
 * @param {number} conversationId - Ticket ID
 * @param {number|null} staffId - Staff who removed tag
 * @param {string} tag - Tag removed
 * @returns {Promise<number>} Activity ID
 */
export async function logTagRemove(conversationId, staffId, tag) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'tag_remove',
    fromValue: tag
  });
}

/**
 * Log a ticket merge
 * @param {number} conversationId - Ticket being merged (child)
 * @param {number} targetId - Ticket being merged into (parent)
 * @param {number|null} staffId - Staff who performed merge
 * @returns {Promise<number>} Activity ID
 */
export async function logMerge(conversationId, targetId, staffId) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'merge',
    toValue: `Merged into ticket #${targetId}`,
    metadata: { target_ticket_id: targetId }
  });
}

/**
 * Log an order link
 * @param {number} conversationId - Ticket ID
 * @param {number|null} staffId - Staff who linked order
 * @param {number} orderId - Order ID
 * @param {string} orderNumber - Order number for display
 * @returns {Promise<number>} Activity ID
 */
export async function logOrderLink(conversationId, staffId, orderId, orderNumber) {
  return logActivity({
    conversationId,
    staffId,
    actionType: 'link_order',
    toValue: `Order #${orderNumber}`,
    metadata: { order_id: orderId, order_number: orderNumber }
  });
}

/**
 * Get activity timeline for a ticket
 * @param {number} conversationId - Ticket ID
 * @param {number} limit - Maximum number of activities to return
 * @returns {Promise<Array>} Array of activities with staff info
 */
export async function getActivityTimeline(conversationId, limit = 100) {
  try {
    const [activities] = await db.execute(
      `SELECT
        ta.*,
        s.full_name as staff_name,
        s.email as staff_email,
        s.avatar_url as staff_avatar,
        s.role as staff_role
       FROM ticket_activities ta
       LEFT JOIN staff_users s ON ta.staff_id = s.id
       WHERE ta.conversation_id = ?
       ORDER BY ta.created_at DESC
       LIMIT ?`,
      [conversationId, limit]
    );

    // Parse metadata JSON
    return activities.map(activity => ({
      ...activity,
      metadata: activity.metadata ? JSON.parse(activity.metadata) : null
    }));
  } catch (error) {
    console.error('❌ Error getting activity timeline:', error);
    return [];
  }
}

/**
 * Get activity count for a ticket
 * @param {number} conversationId - Ticket ID
 * @returns {Promise<number>} Number of activities
 */
export async function getActivityCount(conversationId) {
  try {
    const [rows] = await db.execute(
      'SELECT COUNT(*) as count FROM ticket_activities WHERE conversation_id = ?',
      [conversationId]
    );

    return rows[0].count;
  } catch (error) {
    console.error('❌ Error getting activity count:', error);
    return 0;
  }
}

/**
 * Get recent activities across all tickets (for dashboard)
 * @param {number} shopId - Shop ID
 * @param {number} limit - Maximum number of activities
 * @returns {Promise<Array>} Array of recent activities
 */
export async function getRecentActivities(shopId, limit = 50) {
  try {
    const [activities] = await db.execute(
      `SELECT
        ta.*,
        s.full_name as staff_name,
        s.avatar_url as staff_avatar,
        ec.ticket_number,
        ec.subject,
        ec.customer_name,
        ec.customer_email
       FROM ticket_activities ta
       LEFT JOIN staff_users s ON ta.staff_id = s.id
       INNER JOIN email_conversations ec ON ta.conversation_id = ec.id
       WHERE ec.shop_id = ?
       ORDER BY ta.created_at DESC
       LIMIT ?`,
      [shopId, limit]
    );

    return activities.map(activity => ({
      ...activity,
      metadata: activity.metadata ? JSON.parse(activity.metadata) : null
    }));
  } catch (error) {
    console.error('❌ Error getting recent activities:', error);
    return [];
  }
}

export default {
  logActivity,
  logStatusChange,
  logAssignment,
  logReply,
  logNote,
  logPriorityChange,
  logTagAdd,
  logTagRemove,
  logMerge,
  logOrderLink,
  getActivityTimeline,
  getActivityCount,
  getRecentActivities
};
