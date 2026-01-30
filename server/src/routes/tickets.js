/**
 * Ticket Management API Routes
 * Handles ticket status, assignment, notes, and activities
 */

import express from 'express';
import db from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  logStatusChange,
  logAssignment,
  logNote,
  logPriorityChange,
  logTagAdd,
  logTagRemove,
  logOrderLink,
  getActivityTimeline,
  getRecentActivities
} from '../services/ticketActivities.js';
import { downloadAttachment } from '../services/zohoMailEnhanced.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * GET /api/tickets
 * Get all tickets with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shopRows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shopRows[0].id;

    // Pagination
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Filters
    const status = req.query.status; // open, assigned, in_progress, etc.
    const assignedTo = req.query.assignedTo; // staff ID
    const priority = req.query.priority; // urgent, high, normal, low
    const category = req.query.category;
    const unreadOnly = req.query.unreadOnly === 'true';

    // Build query
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
    `;

    const params = [shopId];

    if (status) {
      query += ' AND ec.status = ?';
      params.push(status);
    }

    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        query += ' AND ec.assigned_to IS NULL';
      } else {
        query += ' AND ec.assigned_to = ?';
        params.push(parseInt(assignedTo));
      }
    }

    if (priority) {
      query += ' AND ec.priority = ?';
      params.push(priority);
    }

    if (category) {
      query += ' AND ec.category = ?';
      params.push(category);
    }

    if (unreadOnly) {
      query += ' AND ec.unread_count > 0';
    }

    // Note: LIMIT and OFFSET cannot be parameterized in MySQL prepared statements
    query += ` ORDER BY ec.last_message_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

    const [tickets] = await db.execute(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM email_conversations ec
      WHERE ec.shop_id = ? AND ec.is_merged = FALSE
    `;
    const countParams = [shopId];

    if (status) {
      countQuery += ' AND ec.status = ?';
      countParams.push(status);
    }
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        countQuery += ' AND ec.assigned_to IS NULL';
      } else {
        countQuery += ' AND ec.assigned_to = ?';
        countParams.push(parseInt(assignedTo));
      }
    }
    if (priority) {
      countQuery += ' AND ec.priority = ?';
      countParams.push(priority);
    }
    if (category) {
      countQuery += ' AND ec.category = ?';
      countParams.push(category);
    }
    if (unreadOnly) {
      countQuery += ' AND ec.unread_count > 0';
    }

    const [countResult] = await db.execute(countQuery, countParams);

    // Parse JSON fields (mysql2 auto-parses JSON columns, but handle strings too)
    const parsedTickets = tickets.map(ticket => ({
      ...ticket,
      participants: Array.isArray(ticket.participants) ? ticket.participants :
                    (ticket.participants ? (typeof ticket.participants === 'string' ? JSON.parse(ticket.participants) : []) : []),
      tags: Array.isArray(ticket.tags) ? ticket.tags :
            (ticket.tags ? (typeof ticket.tags === 'string' ? JSON.parse(ticket.tags) : []) : [])
    }));

    res.json({
      success: true,
      tickets: parsedTickets,
      total: countResult[0].total,
      limit,
      offset
    });
  } catch (error) {
    console.error('❌ Get tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

/**
 * GET /api/tickets/:id
 * Get ticket details with full activity timeline
 */
router.get('/:id', async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);

    const [tickets] = await db.execute(
      `SELECT
        ec.*,
        assigned_staff.id as assigned_to_id,
        assigned_staff.full_name as assigned_to_name,
        assigned_staff.email as assigned_to_email,
        assigned_staff.avatar_url as assigned_to_avatar,
        last_reply_staff.full_name as last_reply_by_name,
        o.shopify_order_id,
        o.order_number
       FROM email_conversations ec
       LEFT JOIN staff_users assigned_staff ON ec.assigned_to = assigned_staff.id
       LEFT JOIN staff_users last_reply_staff ON ec.last_reply_by = last_reply_staff.id
       LEFT JOIN orders o ON ec.order_id = o.id
       WHERE ec.id = ?`,
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = tickets[0];

    // Parse JSON fields (mysql2 auto-parses JSON columns)
    ticket.participants = Array.isArray(ticket.participants) ? ticket.participants :
                          (ticket.participants ? (typeof ticket.participants === 'string' ? JSON.parse(ticket.participants) : []) : []);
    ticket.tags = Array.isArray(ticket.tags) ? ticket.tags :
                  (ticket.tags ? (typeof ticket.tags === 'string' ? JSON.parse(ticket.tags) : []) : []);

    // Get activity timeline
    const activities = await getActivityTimeline(ticketId);

    // Get email messages
    const [messages] = await db.execute(
      `SELECT
        ce.*,
        s.full_name as staff_name,
        s.avatar_url as staff_avatar
       FROM customer_emails ce
       LEFT JOIN staff_users s ON ce.staff_id = s.id
       WHERE ce.conversation_id = ?
       ORDER BY ce.created_at ASC`,
      [ticketId]
    );

    // Get attachments for each message (exclude inline/embedded images)
    const baseUrl = process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app';
    for (const message of messages) {
      const [attachments] = await db.execute(
        `SELECT id, filename, original_filename, file_size, mime_type, is_inline, content_id
         FROM email_attachments
         WHERE email_id = ? AND is_inline = 0`,
        [message.id]
      );

      // Add attachments to message with full backend URLs
      message.attachments = attachments.map(att => ({
        ...att,
        url: `${baseUrl}/api/tickets/attachments/${att.id}`
      }));
    }

    res.json({
      success: true,
      ticket,
      messages,
      activities
    });
  } catch (error) {
    console.error('❌ Get ticket error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket details' });
  }
});

/**
 * PUT /api/tickets/:id/status
 * Change ticket status
 */
router.put('/:id/status', async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const { status, staffId, note } = req.body;

    // Validate status
    const validStatuses = ['open', 'assigned', 'in_progress', 'pending_customer', 'resolved', 'closed', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Get current ticket
    const [tickets] = await db.execute(
      'SELECT status, assigned_to FROM email_conversations WHERE id = ?',
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const oldStatus = tickets[0].status;

    // Don't update if status hasn't changed
    if (oldStatus === status) {
      return res.status(400).json({
        error: 'Status unchanged',
        message: 'Ticket already has this status'
      });
    }

    // Calculate resolution time if resolving
    let resolutionTime = null;
    if (status === 'resolved' || status === 'closed') {
      const [ticketInfo] = await db.execute(
        'SELECT created_at FROM email_conversations WHERE id = ?',
        [ticketId]
      );

      if (ticketInfo.length > 0) {
        const createdAt = new Date(ticketInfo[0].created_at);
        const now = new Date();
        resolutionTime = Math.floor((now - createdAt) / (1000 * 60)); // minutes
      }
    }

    // Update ticket status
    const updates = ['status = ?', 'updated_at = NOW()'];
    const params = [status];

    if (resolutionTime !== null) {
      updates.push('resolution_time = ?');
      params.push(resolutionTime);
    }

    params.push(ticketId);

    await db.execute(
      `UPDATE email_conversations
       SET ${updates.join(', ')}
       WHERE id = ?`,
      params
    );

    // Log activity
    await logStatusChange(ticketId, staffId || null, oldStatus, status);

    // Add note if provided
    if (note && staffId) {
      await logNote(ticketId, staffId, note);
    }

    console.log(`✅ Ticket #${ticketId} status changed: ${oldStatus} → ${status}`);

    res.json({
      success: true,
      message: 'Ticket status updated successfully',
      oldStatus,
      newStatus: status,
      resolutionTime
    });
  } catch (error) {
    console.error('❌ Update ticket status error:', error);
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});

/**
 * PUT /api/tickets/:id/assign
 * Assign ticket to staff member
 */
router.put('/:id/assign', async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const { assignToId, staffId, note } = req.body;

    // Verify ticket exists
    const [tickets] = await db.execute(
      'SELECT assigned_to, status FROM email_conversations WHERE id = ?',
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const oldAssigneeId = tickets[0].assigned_to;
    const currentStatus = tickets[0].status;

    // Verify new assignee exists (if not null)
    if (assignToId) {
      const [staff] = await db.execute(
        'SELECT id, full_name FROM staff_users WHERE id = ? AND is_active = TRUE',
        [assignToId]
      );

      if (staff.length === 0) {
        return res.status(404).json({ error: 'Staff member not found or inactive' });
      }
    }

    // Don't update if assignment hasn't changed
    if (oldAssigneeId === assignToId) {
      return res.status(400).json({
        error: 'Assignment unchanged',
        message: 'Ticket is already assigned to this staff member'
      });
    }

    // Update ticket assignment
    await db.execute(
      `UPDATE email_conversations
       SET assigned_to = ?,
           status = CASE
             WHEN ? IS NOT NULL AND status = 'open' THEN 'assigned'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = ?`,
      [assignToId, assignToId, ticketId]
    );

    // Log activity
    await logAssignment(ticketId, staffId || null, oldAssigneeId, assignToId);

    // Add note if provided
    if (note && staffId) {
      await logNote(ticketId, staffId, note);
    }

    console.log(`✅ Ticket #${ticketId} assigned to staff #${assignToId || 'unassigned'}`);

    res.json({
      success: true,
      message: 'Ticket assigned successfully',
      assignedTo: assignToId
    });
  } catch (error) {
    console.error('❌ Assign ticket error:', error);
    res.status(500).json({ error: 'Failed to assign ticket' });
  }
});

/**
 * POST /api/tickets/:id/note
 * Add internal note to ticket
 */
router.post('/:id/note', async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const { staffId, note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'Note text is required' });
    }

    if (!staffId) {
      return res.status(400).json({ error: 'Staff ID is required' });
    }

    // Verify ticket exists
    const [tickets] = await db.execute(
      'SELECT id FROM email_conversations WHERE id = ?',
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Log note as activity
    const activityId = await logNote(ticketId, staffId, note.trim());

    // Also create an internal email record
    await db.execute(
      `INSERT INTO customer_emails (
        conversation_id,
        shop_id,
        staff_id,
        direction,
        from_email,
        from_name,
        subject,
        body_text,
        is_internal_note,
        status,
        sent_at
      ) SELECT
        ?,
        ec.shop_id,
        ?,
        'outbound',
        s.email,
        s.full_name,
        CONCAT('Internal Note: ', ec.subject),
        ?,
        TRUE,
        'read',
        NOW()
      FROM email_conversations ec
      LEFT JOIN staff_users s ON s.id = ?
      WHERE ec.id = ?`,
      [ticketId, staffId, note.trim(), staffId, ticketId]
    );

    console.log(`✅ Added internal note to ticket #${ticketId}`);

    res.json({
      success: true,
      message: 'Internal note added successfully',
      activityId
    });
  } catch (error) {
    console.error('❌ Add note error:', error);
    res.status(500).json({ error: 'Failed to add internal note' });
  }
});

/**
 * PUT /api/tickets/:id/priority
 * Change ticket priority
 */
router.put('/:id/priority', async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const { priority, staffId } = req.body;

    // Validate priority
    const validPriorities = ['urgent', 'high', 'normal', 'low'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        error: 'Invalid priority',
        message: `Priority must be one of: ${validPriorities.join(', ')}`
      });
    }

    // Get current priority
    const [tickets] = await db.execute(
      'SELECT priority FROM email_conversations WHERE id = ?',
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const oldPriority = tickets[0].priority;

    if (oldPriority === priority) {
      return res.status(400).json({
        error: 'Priority unchanged',
        message: 'Ticket already has this priority'
      });
    }

    // Update priority
    await db.execute(
      'UPDATE email_conversations SET priority = ?, updated_at = NOW() WHERE id = ?',
      [priority, ticketId]
    );

    // Log activity
    await logPriorityChange(ticketId, staffId || null, oldPriority, priority);

    console.log(`✅ Ticket #${ticketId} priority changed: ${oldPriority} → ${priority}`);

    res.json({
      success: true,
      message: 'Ticket priority updated successfully',
      oldPriority,
      newPriority: priority
    });
  } catch (error) {
    console.error('❌ Update priority error:', error);
    res.status(500).json({ error: 'Failed to update ticket priority' });
  }
});

/**
 * GET /api/tickets/:id/activities
 * Get activity timeline for a ticket
 */
router.get('/:id/activities', async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 100;

    // Verify ticket exists
    const [tickets] = await db.execute(
      'SELECT id FROM email_conversations WHERE id = ?',
      [ticketId]
    );

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const activities = await getActivityTimeline(ticketId, limit);

    res.json({
      success: true,
      activities,
      total: activities.length
    });
  } catch (error) {
    console.error('❌ Get activities error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket activities' });
  }
});

/**
 * GET /api/tickets/stats/summary
 * Get ticket statistics
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shopRows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shopRows[0].id;

    // Get stats by status
    const [statusStats] = await db.execute(
      `SELECT
        status,
        COUNT(*) as count,
        COUNT(CASE WHEN unread_count > 0 THEN 1 END) as unread_count
       FROM email_conversations
       WHERE shop_id = ? AND is_merged = FALSE
       GROUP BY status`,
      [shopId]
    );

    // Get overall stats
    const [overallStats] = await db.execute(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN assigned_to IS NULL THEN 1 END) as unassigned,
        COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent,
        COUNT(CASE WHEN unread_count > 0 THEN 1 END) as has_unread,
        AVG(resolution_time) as avg_resolution_minutes
       FROM email_conversations
       WHERE shop_id = ? AND is_merged = FALSE`,
      [shopId]
    );

    // Get stats by category
    const [categoryStats] = await db.execute(
      `SELECT
        category,
        COUNT(*) as count
       FROM email_conversations
       WHERE shop_id = ? AND is_merged = FALSE AND category IS NOT NULL
       GROUP BY category
       ORDER BY count DESC`,
      [shopId]
    );

    // Format status stats as object
    const statusCounts = {};
    statusStats.forEach(stat => {
      statusCounts[stat.status] = {
        count: stat.count,
        unread: stat.unread_count
      };
    });

    res.json({
      success: true,
      stats: {
        ...overallStats[0],
        byStatus: statusCounts,
        byCategory: categoryStats
      }
    });
  } catch (error) {
    console.error('❌ Get ticket stats error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket statistics' });
  }
});

/**
 * GET /api/tickets/activities/recent
 * Get recent activities across all tickets
 */
router.get('/activities/recent', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const limit = parseInt(req.query.limit) || 50;

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shopRows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shopRows[0].id;

    const activities = await getRecentActivities(shopId, limit);

    res.json({
      success: true,
      activities,
      total: activities.length
    });
  } catch (error) {
    console.error('❌ Get recent activities error:', error);
    res.status(500).json({ error: 'Failed to fetch recent activities' });
  }
});

/**
 * POST /api/tickets/bulk/status
 * Bulk update ticket status
 */
router.post('/bulk/status', async (req, res) => {
  try {
    const { ticketIds, status, staffId, note } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'ticketIds must be a non-empty array' });
    }

    // Validate status
    const validStatuses = ['open', 'assigned', 'in_progress', 'pending_customer', 'resolved', 'closed', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    let updated = 0;
    let errors = [];

    for (const ticketId of ticketIds) {
      try {
        // Get current status
        const [tickets] = await db.execute(
          'SELECT status FROM email_conversations WHERE id = ?',
          [ticketId]
        );

        if (tickets.length === 0) {
          errors.push({ ticketId, error: 'Ticket not found' });
          continue;
        }

        const oldStatus = tickets[0].status;

        if (oldStatus === status) {
          continue; // Skip if already has this status
        }

        // Calculate resolution time if resolving
        let resolutionTime = null;
        if (status === 'resolved' || status === 'closed') {
          const [ticketInfo] = await db.execute(
            'SELECT created_at FROM email_conversations WHERE id = ?',
            [ticketId]
          );

          if (ticketInfo.length > 0) {
            const createdAt = new Date(ticketInfo[0].created_at);
            const now = new Date();
            resolutionTime = Math.floor((now - createdAt) / (1000 * 60));
          }
        }

        // Update status
        const updates = ['status = ?', 'updated_at = NOW()'];
        const params = [status];

        if (resolutionTime !== null) {
          updates.push('resolution_time = ?');
          params.push(resolutionTime);
        }

        params.push(ticketId);

        await db.execute(
          `UPDATE email_conversations SET ${updates.join(', ')} WHERE id = ?`,
          params
        );

        // Log activity
        await logStatusChange(ticketId, staffId || null, oldStatus, status);

        updated++;
      } catch (error) {
        errors.push({ ticketId, error: error.message });
      }
    }

    // Add bulk note if provided
    if (note && staffId && updated > 0) {
      const bulkNote = `Bulk action: ${note}`;
      for (const ticketId of ticketIds) {
        try {
          await logNote(ticketId, staffId, bulkNote);
        } catch (error) {
          // Ignore note errors
        }
      }
    }

    console.log(`✅ Bulk status update: ${updated} tickets updated to '${status}'`);

    res.json({
      success: true,
      message: `Updated ${updated} ticket(s) to '${status}'`,
      updated,
      total: ticketIds.length,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    console.error('❌ Bulk status update error:', error);
    res.status(500).json({ error: 'Failed to update ticket statuses' });
  }
});

/**
 * POST /api/tickets/bulk/assign
 * Bulk assign tickets to staff member
 */
router.post('/bulk/assign', async (req, res) => {
  try {
    const { ticketIds, assignToId, staffId, note } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'ticketIds must be a non-empty array' });
    }

    // Verify assignee exists (if not null)
    if (assignToId) {
      const [staff] = await db.execute(
        'SELECT id, full_name FROM staff_users WHERE id = ? AND is_active = TRUE',
        [assignToId]
      );

      if (staff.length === 0) {
        return res.status(404).json({ error: 'Staff member not found or inactive' });
      }
    }

    let updated = 0;
    let errors = [];

    for (const ticketId of ticketIds) {
      try {
        // Get current assignment
        const [tickets] = await db.execute(
          'SELECT assigned_to, status FROM email_conversations WHERE id = ?',
          [ticketId]
        );

        if (tickets.length === 0) {
          errors.push({ ticketId, error: 'Ticket not found' });
          continue;
        }

        const oldAssigneeId = tickets[0].assigned_to;

        if (oldAssigneeId === assignToId) {
          continue; // Skip if already assigned to this staff
        }

        // Update assignment
        await db.execute(
          `UPDATE email_conversations
           SET assigned_to = ?,
               status = CASE
                 WHEN ? IS NOT NULL AND status = 'open' THEN 'assigned'
                 ELSE status
               END,
               updated_at = NOW()
           WHERE id = ?`,
          [assignToId, assignToId, ticketId]
        );

        // Log activity
        await logAssignment(ticketId, staffId || null, oldAssigneeId, assignToId);

        updated++;
      } catch (error) {
        errors.push({ ticketId, error: error.message });
      }
    }

    // Add bulk note if provided
    if (note && staffId && updated > 0) {
      const bulkNote = `Bulk assignment: ${note}`;
      for (const ticketId of ticketIds) {
        try {
          await logNote(ticketId, staffId, bulkNote);
        } catch (error) {
          // Ignore note errors
        }
      }
    }

    console.log(`✅ Bulk assignment: ${updated} tickets assigned to staff #${assignToId || 'unassigned'}`);

    res.json({
      success: true,
      message: `Assigned ${updated} ticket(s)`,
      updated,
      total: ticketIds.length,
      assignedTo: assignToId,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    console.error('❌ Bulk assignment error:', error);
    res.status(500).json({ error: 'Failed to assign tickets' });
  }
});

/**
 * POST /api/tickets/bulk/priority
 * Bulk update ticket priority
 */
router.post('/bulk/priority', async (req, res) => {
  try {
    const { ticketIds, priority, staffId } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'ticketIds must be a non-empty array' });
    }

    // Validate priority
    const validPriorities = ['urgent', 'high', 'normal', 'low'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        error: 'Invalid priority',
        message: `Priority must be one of: ${validPriorities.join(', ')}`
      });
    }

    let updated = 0;
    let errors = [];

    for (const ticketId of ticketIds) {
      try {
        // Get current priority
        const [tickets] = await db.execute(
          'SELECT priority FROM email_conversations WHERE id = ?',
          [ticketId]
        );

        if (tickets.length === 0) {
          errors.push({ ticketId, error: 'Ticket not found' });
          continue;
        }

        const oldPriority = tickets[0].priority;

        if (oldPriority === priority) {
          continue; // Skip if already has this priority
        }

        // Update priority
        await db.execute(
          'UPDATE email_conversations SET priority = ?, updated_at = NOW() WHERE id = ?',
          [priority, ticketId]
        );

        // Log activity
        await logPriorityChange(ticketId, staffId || null, oldPriority, priority);

        updated++;
      } catch (error) {
        errors.push({ ticketId, error: error.message });
      }
    }

    console.log(`✅ Bulk priority update: ${updated} tickets set to '${priority}'`);

    res.json({
      success: true,
      message: `Updated priority for ${updated} ticket(s)`,
      updated,
      total: ticketIds.length,
      priority,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    console.error('❌ Bulk priority update error:', error);
    res.status(500).json({ error: 'Failed to update ticket priorities' });
  }
});

/**
 * POST /api/tickets/bulk/tags
 * Bulk add or remove tags
 */
router.post('/bulk/tags', async (req, res) => {
  try {
    const { ticketIds, action, tag, staffId } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'ticketIds must be a non-empty array' });
    }

    if (!['add', 'remove'].includes(action)) {
      return res.status(400).json({ error: 'action must be "add" or "remove"' });
    }

    if (!tag || !tag.trim()) {
      return res.status(400).json({ error: 'tag is required' });
    }

    const tagValue = tag.trim();
    let updated = 0;
    let errors = [];

    for (const ticketId of ticketIds) {
      try {
        // Get current tags
        const [tickets] = await db.execute(
          'SELECT tags FROM email_conversations WHERE id = ?',
          [ticketId]
        );

        if (tickets.length === 0) {
          errors.push({ ticketId, error: 'Ticket not found' });
          continue;
        }

        // mysql2 auto-parses JSON columns
        let tags = Array.isArray(tickets[0].tags) ? tickets[0].tags :
                   (tickets[0].tags ? (typeof tickets[0].tags === 'string' ? JSON.parse(tickets[0].tags) : []) : []);

        if (action === 'add') {
          if (!tags.includes(tagValue)) {
            tags.push(tagValue);

            // Update tags
            await db.execute(
              'UPDATE email_conversations SET tags = ?, updated_at = NOW() WHERE id = ?',
              [JSON.stringify(tags), ticketId]
            );

            // Log activity
            await logTagAdd(ticketId, staffId || null, tagValue);

            updated++;
          }
        } else if (action === 'remove') {
          const index = tags.indexOf(tagValue);
          if (index > -1) {
            tags.splice(index, 1);

            // Update tags
            await db.execute(
              'UPDATE email_conversations SET tags = ?, updated_at = NOW() WHERE id = ?',
              [JSON.stringify(tags), ticketId]
            );

            // Log activity
            await logTagRemove(ticketId, staffId || null, tagValue);

            updated++;
          }
        }
      } catch (error) {
        errors.push({ ticketId, error: error.message });
      }
    }

    console.log(`✅ Bulk tag ${action}: ${updated} tickets affected`);

    res.json({
      success: true,
      message: `${action === 'add' ? 'Added' : 'Removed'} tag '${tagValue}' for ${updated} ticket(s)`,
      updated,
      total: ticketIds.length,
      action,
      tag: tagValue,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    console.error('❌ Bulk tag operation error:', error);
    res.status(500).json({ error: 'Failed to update ticket tags' });
  }
});

/**
 * POST /api/tickets/bulk/close
 * Bulk close tickets (convenience endpoint)
 */
router.post('/bulk/close', async (req, res) => {
  try {
    const { ticketIds, staffId, note } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'ticketIds must be a non-empty array' });
    }

    let updated = 0;
    let errors = [];

    for (const ticketId of ticketIds) {
      try {
        // Get current status
        const [tickets] = await db.execute(
          'SELECT status, created_at FROM email_conversations WHERE id = ?',
          [ticketId]
        );

        if (tickets.length === 0) {
          errors.push({ ticketId, error: 'Ticket not found' });
          continue;
        }

        const oldStatus = tickets[0].status;

        if (oldStatus === 'closed') {
          continue; // Skip if already closed
        }

        // Calculate resolution time
        const createdAt = new Date(tickets[0].created_at);
        const now = new Date();
        const resolutionTime = Math.floor((now - createdAt) / (1000 * 60));

        // Update to closed
        await db.execute(
          `UPDATE email_conversations
           SET status = 'closed', resolution_time = ?, updated_at = NOW()
           WHERE id = ?`,
          [resolutionTime, ticketId]
        );

        // Log activity
        await logStatusChange(ticketId, staffId || null, oldStatus, 'closed');

        updated++;
      } catch (error) {
        errors.push({ ticketId, error: error.message });
      }
    }

    // Add bulk note if provided
    if (note && staffId && updated > 0) {
      const bulkNote = `Bulk close: ${note}`;
      for (const ticketId of ticketIds) {
        try {
          await logNote(ticketId, staffId, bulkNote);
        } catch (error) {
          // Ignore note errors
        }
      }
    }

    console.log(`✅ Bulk close: ${updated} tickets closed`);

    res.json({
      success: true,
      message: `Closed ${updated} ticket(s)`,
      updated,
      total: ticketIds.length,
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    console.error('❌ Bulk close error:', error);
    res.status(500).json({ error: 'Failed to close tickets' });
  }
});

/**
 * POST /api/tickets/maintenance/fix-message-counts
 * Recalculate message_count for all conversations
 * MAINTENANCE ENDPOINT - Use with caution
 */
router.post('/maintenance/fix-message-counts', async (req, res) => {
  try {
    const shop = req.body.shop || req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shopRows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shopRows[0].id;

    console.log('🔧 Starting message count fix for all conversations...');

    // Get all conversations
    const [conversations] = await db.execute(
      `SELECT id, ticket_number, message_count
       FROM email_conversations
       WHERE shop_id = ? AND is_merged = FALSE
       ORDER BY id`,
      [shopId]
    );

    let fixed = 0;
    let checked = 0;
    const fixes = [];

    for (const conv of conversations) {
      // Count actual messages
      const [emails] = await db.execute(
        `SELECT COUNT(*) as count
         FROM customer_emails
         WHERE conversation_id = ?`,
        [conv.id]
      );

      const actualCount = emails[0].count;
      checked++;

      if (conv.message_count !== actualCount) {
        console.log(`🔧 Fixing ${conv.ticket_number}: ${conv.message_count} -> ${actualCount} messages`);

        // Update message count
        await db.execute(
          `UPDATE email_conversations
           SET message_count = ?
           WHERE id = ?`,
          [actualCount, conv.id]
        );

        fixes.push({
          ticket_number: conv.ticket_number,
          old_count: conv.message_count,
          new_count: actualCount
        });

        fixed++;
      }

      // Progress indicator
      if (checked % 50 === 0) {
        console.log(`   Progress: ${checked}/${conversations.length} checked, ${fixed} fixed`);
      }
    }

    console.log(`✅ Message count fix complete: ${checked} checked, ${fixed} fixed`);

    res.json({
      success: true,
      message: `Checked ${checked} conversations, fixed ${fixed} incorrect message counts`,
      checked,
      fixed,
      fixes: fixes.slice(0, 100) // Return first 100 fixes
    });
  } catch (error) {
    console.error('❌ Fix message counts error:', error);
    res.status(500).json({ error: 'Failed to fix message counts' });
  }
});

/**
 * POST /api/tickets/merge
 * Merge multiple tickets into one
 */
router.post('/merge', async (req, res) => {
  try {
    const { sourceTicketIds, targetTicketId, staffId, note } = req.body;

    if (!Array.isArray(sourceTicketIds) || sourceTicketIds.length === 0) {
      return res.status(400).json({ error: 'sourceTicketIds must be a non-empty array' });
    }

    if (!targetTicketId) {
      return res.status(400).json({ error: 'targetTicketId is required' });
    }

    // Verify target ticket exists
    const [targetTickets] = await db.execute(
      'SELECT id, ticket_number, subject FROM email_conversations WHERE id = ?',
      [targetTicketId]
    );

    if (targetTickets.length === 0) {
      return res.status(404).json({ error: 'Target ticket not found' });
    }

    const targetTicket = targetTickets[0];

    let merged = 0;
    let errors = [];

    for (const sourceId of sourceTicketIds) {
      if (sourceId === targetTicketId) {
        errors.push({ ticketId: sourceId, error: 'Cannot merge ticket into itself' });
        continue;
      }

      try {
        // Verify source ticket exists
        const [sourceTickets] = await db.execute(
          'SELECT id FROM email_conversations WHERE id = ?',
          [sourceId]
        );

        if (sourceTickets.length === 0) {
          errors.push({ ticketId: sourceId, error: 'Source ticket not found' });
          continue;
        }

        // Mark source as merged
        await db.execute(
          `UPDATE email_conversations
           SET is_merged = TRUE,
               merged_into = ?,
               status = 'closed',
               updated_at = NOW()
           WHERE id = ?`,
          [targetTicketId, sourceId]
        );

        // Move all emails from source to target
        await db.execute(
          'UPDATE customer_emails SET conversation_id = ? WHERE conversation_id = ?',
          [targetTicketId, sourceId]
        );

        // Move all activities from source to target
        await db.execute(
          'UPDATE ticket_activities SET conversation_id = ? WHERE conversation_id = ?',
          [targetTicketId, sourceId]
        );

        // Update target's message count and last_message_at
        await db.execute(
          `UPDATE email_conversations
           SET message_count = (SELECT COUNT(*) FROM customer_emails WHERE conversation_id = ?),
               last_message_at = (SELECT MAX(COALESCE(sent_at, received_at, created_at)) FROM customer_emails WHERE conversation_id = ?),
               updated_at = NOW()
           WHERE id = ?`,
          [targetTicketId, targetTicketId, targetTicketId]
        );

        // Log merge activity
        await db.execute(
          `INSERT INTO ticket_activities (conversation_id, staff_id, action_type, to_value, note, metadata)
           VALUES (?, ?, 'merge', ?, ?, ?)`,
          [
            sourceId,
            staffId || null,
            `Merged into ${targetTicket.ticket_number}`,
            note || `Merged into ticket #${targetTicketId}`,
            JSON.stringify({ target_ticket_id: targetTicketId })
          ]
        );

        merged++;
      } catch (error) {
        errors.push({ ticketId: sourceId, error: error.message });
      }
    }

    // Add note to target ticket
    if (staffId) {
      const mergeNote = note || `Merged ${merged} ticket(s) into this ticket`;
      await logNote(targetTicketId, staffId, mergeNote);
    }

    console.log(`✅ Ticket merge: ${merged} tickets merged into #${targetTicketId}`);

    res.json({
      success: true,
      message: `Merged ${merged} ticket(s) into ${targetTicket.ticket_number}`,
      merged,
      total: sourceTicketIds.length,
      targetTicket: {
        id: targetTicket.id,
        ticket_number: targetTicket.ticket_number,
        subject: targetTicket.subject
      },
      errors: errors.length > 0 ? errors : null
    });
  } catch (error) {
    console.error('❌ Ticket merge error:', error);
    res.status(500).json({ error: 'Failed to merge tickets' });
  }
});

/**
 * GET /api/tickets/:ticketId/attachments
 * Get all attachments for a specific ticket/email thread
 */
router.get('/:ticketId/attachments', async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Get all attachments for emails in this conversation (exclude inline/embedded images)
    const [attachments] = await db.execute(
      `SELECT
        a.id,
        a.email_id,
        a.filename,
        a.original_filename,
        a.file_size,
        a.mime_type,
        a.is_inline,
        a.content_id,
        a.created_at,
        e.subject as email_subject,
        e.direction
       FROM email_attachments a
       JOIN customer_emails e ON a.email_id = e.id
       WHERE e.conversation_id = ? AND a.is_inline = 0
       ORDER BY a.created_at DESC`,
      [ticketId]
    );

    const baseUrl = process.env.APP_URL || 'https://tfs-manager-server-production.up.railway.app';
    res.json({
      success: true,
      attachments: attachments.map(att => ({
        ...att,
        url: `${baseUrl}/api/tickets/attachments/${att.id}`
      }))
    });

  } catch (error) {
    console.error('❌ Error fetching attachments:', error);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

/**
 * GET /api/tickets/attachments/:id
 * Download/serve an attachment file (fetched from Zoho on-demand)
 */
router.get('/attachments/:id', async (req, res) => {
  try {
    const attachmentId = req.params.id;
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [shopRows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shopRows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shopRows[0].id;

    // Get attachment metadata from database
    const [attachments] = await db.execute(
      'SELECT * FROM email_attachments WHERE id = ?',
      [attachmentId]
    );

    if (attachments.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const attachment = attachments[0];

    let fileData;

    // Inline images are saved to disk, regular attachments are fetched from Zoho
    if (attachment.is_inline && attachment.file_path) {
      // Inline image - read from disk
      console.log(`📥 Reading inline image ${attachment.filename} from disk...`);
      try {
        fileData = await fs.readFile(attachment.file_path);
      } catch (error) {
        console.error(`❌ Inline image file not found: ${attachment.file_path}`);
        return res.status(404).json({ error: 'Inline image file not found' });
      }
    } else {
      // Regular attachment - fetch from Zoho on-demand
      if (!attachment.zoho_attachment_id || !attachment.zoho_message_id) {
        console.error(`❌ Attachment ${attachmentId} missing Zoho metadata - cannot fetch`);
        return res.status(404).json({
          error: 'Attachment unavailable',
          message: 'This attachment is missing required metadata and cannot be downloaded'
        });
      }

      console.log(`📥 Fetching attachment ${attachment.filename} from Zoho...`);
      fileData = await downloadAttachment(
        shopId,
        attachment.zoho_message_id,
        attachment.zoho_attachment_id,
        attachment.zoho_account_email,
        attachment.zoho_folder_id
      );
    }

    // Set disposition based on whether it's inline or a regular attachment
    const disposition = attachment.is_inline ? 'inline' : 'attachment';

    // Set appropriate headers
    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', fileData.length);
    res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.original_filename || attachment.filename}"`);

    // Send the file
    res.send(fileData);

    console.log(`✅ Served ${disposition} ${attachment.is_inline ? 'image' : 'attachment'}: ${attachment.filename} (${(fileData.length / 1024).toFixed(2)} KB)`);

  } catch (error) {
    console.error('❌ Error serving attachment:', error);
    res.status(500).json({ error: 'Failed to serve attachment' });
  }
});

export default router;
