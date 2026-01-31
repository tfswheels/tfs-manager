/**
 * Staff Management API Routes
 * Handles staff members, Shopify sync, and staff-related operations
 */

import express from 'express';
import db from '../config/database.js';
import {
  syncStaffMembers,
  getStaffById,
  getActiveStaff,
  getStaffByEmail
} from '../services/shopifyStaffSync.js';

const router = express.Router();

/**
 * GET /api/staff
 * Get all staff members for a shop
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

    // Get staff members
    const includeInactive = req.query.includeInactive === 'true';

    let query = `
      SELECT
        id,
        shopify_staff_id,
        email,
        first_name,
        last_name,
        full_name,
        phone,
        locale,
        avatar_url,
        role,
        is_shop_owner,
        is_active,
        shopify_active,
        total_tickets_handled,
        avg_response_time_minutes,
        last_active_at,
        last_synced_at,
        sync_error,
        created_at,
        updated_at
      FROM staff_users
      WHERE shop_id = ?
    `;

    const params = [shopId];

    if (!includeInactive) {
      query += ' AND is_active = TRUE';
    }

    query += ' ORDER BY is_shop_owner DESC, full_name ASC';

    const [staff] = await db.execute(query, params);

    res.json({
      success: true,
      staff: staff,
      total: staff.length
    });
  } catch (error) {
    console.error('❌ Get staff error:', error);
    res.status(500).json({ error: 'Failed to fetch staff members' });
  }
});

/**
 * GET /api/staff/:id
 * Get a specific staff member by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);

    const staff = await getStaffById(staffId);

    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Get staff stats
    const [ticketStats] = await db.execute(
      `SELECT
        COUNT(*) as total_assigned,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tickets,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_tickets,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_tickets
       FROM email_conversations
       WHERE assigned_to = ?`,
      [staffId]
    );

    const [replyStats] = await db.execute(
      `SELECT
        COUNT(*) as total_replies,
        COUNT(DISTINCT conversation_id) as conversations_replied_to
       FROM customer_emails
       WHERE staff_id = ? AND direction = 'outbound'`,
      [staffId]
    );

    res.json({
      success: true,
      staff: staff,
      stats: {
        tickets: ticketStats[0],
        replies: replyStats[0]
      }
    });
  } catch (error) {
    console.error('❌ Get staff by ID error:', error);
    res.status(500).json({ error: 'Failed to fetch staff member' });
  }
});

/**
 * POST /api/staff/sync
 * Sync staff members from Shopify
 */
router.post('/sync', async (req, res) => {
  try {
    const shop = req.query.shop || req.body.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID and access token
    const [shopRows] = await db.execute(
      'SELECT id, access_token FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shopRows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shopRows[0].id;
    const accessToken = shopRows[0].access_token;

    if (!accessToken) {
      return res.status(400).json({
        error: 'Shop not authenticated',
        message: 'Missing Shopify access token. Please reinstall the app.'
      });
    }

    // Sync staff members
    const result = await syncStaffMembers(shopId, shop, accessToken);

    res.json({
      success: true,
      message: 'Staff sync completed successfully',
      ...result
    });
  } catch (error) {
    console.error('❌ Staff sync error:', error);
    res.status(500).json({
      error: 'Staff sync failed',
      message: error.message
    });
  }
});

/**
 * PUT /api/staff/:id
 * Update staff member details (role, active status)
 */
router.put('/:id', async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);
    const { role, is_active } = req.body;

    // Verify staff exists
    const staff = await getStaffById(staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (role !== undefined) {
      if (!['admin', 'agent', 'viewer'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role',
          message: 'Role must be one of: admin, agent, viewer'
        });
      }
      updates.push('role = ?');
      params.push(role);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(staffId);

    await db.execute(
      `UPDATE staff_users
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = ?`,
      params
    );

    console.log(`✅ Updated staff member #${staffId}`);

    // Return updated staff
    const updatedStaff = await getStaffById(staffId);

    res.json({
      success: true,
      message: 'Staff member updated successfully',
      staff: updatedStaff
    });
  } catch (error) {
    console.error('❌ Update staff error:', error);
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

/**
 * GET /api/staff/stats/summary
 * Get summary statistics for all staff
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

    // Get overall stats
    const [overallStats] = await db.execute(
      `SELECT
        COUNT(*) as total_staff,
        COUNT(CASE WHEN is_active = TRUE THEN 1 END) as active_staff,
        COUNT(CASE WHEN is_shop_owner = TRUE THEN 1 END) as owners,
        MAX(last_synced_at) as last_sync_at
       FROM staff_users
       WHERE shop_id = ?`,
      [shopId]
    );

    // Get staff performance stats
    const [performanceStats] = await db.execute(
      `SELECT
        s.id,
        s.full_name,
        s.email,
        s.avatar_url,
        s.role,
        COUNT(DISTINCT ec.id) as tickets_assigned,
        COUNT(DISTINCT CASE WHEN ec.status IN ('open', 'in_progress') THEN ec.id END) as active_tickets,
        COUNT(DISTINCT ce.id) as total_replies,
        s.total_tickets_handled,
        s.avg_response_time_minutes
       FROM staff_users s
       LEFT JOIN email_conversations ec ON ec.assigned_to = s.id
       LEFT JOIN customer_emails ce ON ce.staff_id = s.id AND ce.direction = 'outbound'
       WHERE s.shop_id = ? AND s.is_active = TRUE
       GROUP BY s.id, s.full_name, s.email, s.avatar_url, s.role, s.total_tickets_handled, s.avg_response_time_minutes
       ORDER BY tickets_assigned DESC`,
      [shopId]
    );

    res.json({
      success: true,
      stats: overallStats[0],
      staff: performanceStats
    });
  } catch (error) {
    console.error('❌ Get staff stats error:', error);
    res.status(500).json({ error: 'Failed to fetch staff statistics' });
  }
});

/**
 * DELETE /api/staff/:id
 * Deactivate a staff member (soft delete)
 */
router.delete('/:id', async (req, res) => {
  try {
    const staffId = parseInt(req.params.id);

    // Verify staff exists
    const staff = await getStaffById(staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Don't allow deleting shop owner
    if (staff.is_shop_owner) {
      return res.status(400).json({
        error: 'Cannot deactivate shop owner',
        message: 'Shop owners cannot be deactivated'
      });
    }

    // Soft delete - set is_active to FALSE
    await db.execute(
      `UPDATE staff_users
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = ?`,
      [staffId]
    );

    console.log(`✅ Deactivated staff member #${staffId}`);

    res.json({
      success: true,
      message: 'Staff member deactivated successfully'
    });
  } catch (error) {
    console.error('❌ Delete staff error:', error);
    res.status(500).json({ error: 'Failed to deactivate staff member' });
  }
});

// =============================================================================
// STAFF SELF-REGISTRATION
// =============================================================================

/**
 * POST /api/staff/:shopId/register
 * Self-register a staff member when they first access the app
 *
 * This solves the problem of Shopify's deprecated staffMembers API
 * by allowing staff to register themselves on first app access.
 */
router.post('/:shopId/register', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { email, first_name, last_name, full_name, role } = req.body;

    // Validation
    if (!email || !first_name) {
      return res.status(400).json({
        success: false,
        error: 'Email and first name are required'
      });
    }

    // Check if staff member already exists with this email
    const [existing] = await db.execute(
      'SELECT * FROM staff_users WHERE shop_id = ? AND email = ?',
      [parseInt(shopId), email]
    );

    if (existing.length > 0) {
      // Staff already exists - reactivate if inactive and return
      const staff = existing[0];

      if (!staff.is_active) {
        await db.execute(
          'UPDATE staff_users SET is_active = TRUE, updated_at = NOW() WHERE id = ?',
          [staff.id]
        );
        console.log(`✅ Reactivated staff member: ${email}`);
      }

      return res.json({
        success: true,
        data: staff,
        message: 'Staff member already registered'
      });
    }

    // Create new staff member
    const [result] = await db.execute(
      `INSERT INTO staff_users (
        shop_id,
        email,
        first_name,
        last_name,
        full_name,
        role,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [
        parseInt(shopId),
        email,
        first_name,
        last_name || null,
        full_name || `${first_name} ${last_name || ''}`.trim(),
        role || 'staff'
      ]
    );

    // Fetch the created staff member
    const [newStaff] = await db.execute(
      'SELECT * FROM staff_users WHERE id = ?',
      [result.insertId]
    );

    console.log(`✅ Self-registered new staff member: ${email} (ID: ${result.insertId})`);

    res.json({
      success: true,
      data: newStaff[0],
      message: 'Staff member registered successfully'
    });

  } catch (error) {
    console.error('❌ Staff self-registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register staff member'
    });
  }
});

export default router;
