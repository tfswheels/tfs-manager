/**
 * Canned Responses API Routes
 *
 * Handles quick reply templates for staff:
 * - GET /api/canned-responses/:shopId - List all canned responses
 * - POST /api/canned-responses/:shopId - Create new canned response
 * - PUT /api/canned-responses/:id - Update canned response
 * - DELETE /api/canned-responses/:id - Delete canned response
 * - POST /api/canned-responses/:id/use - Increment usage count
 */

import express from 'express';
import db from '../config/database.js';

const router = express.Router();

// =============================================================================
// LIST CANNED RESPONSES
// =============================================================================

router.get('/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { category } = req.query;

    let query = `
      SELECT cr.*, s.full_name as created_by_name
      FROM canned_responses cr
      LEFT JOIN staff_users s ON cr.created_by = s.id
      WHERE cr.shop_id = ? AND cr.is_active = TRUE
    `;
    const params = [parseInt(shopId)];

    if (category) {
      query += ' AND cr.category = ?';
      params.push(category);
    }

    query += ' ORDER BY cr.usage_count DESC, cr.title ASC';

    const [responses] = await db.execute(query, params);

    res.json({
      success: true,
      data: responses
    });

  } catch (error) {
    console.error('[CANNED RESPONSES API] Error listing responses:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// CREATE CANNED RESPONSE
// =============================================================================

router.post('/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const {
      title,
      shortcut,
      category,
      body_html,
      body_text,
      created_by
    } = req.body;

    if (!title || !body_html) {
      return res.status(400).json({
        success: false,
        error: 'title and body_html are required'
      });
    }

    const [result] = await db.execute(
      `INSERT INTO canned_responses
       (shop_id, title, shortcut, category, body_html, body_text, created_by, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        parseInt(shopId),
        title,
        shortcut || null,
        category || null,
        body_html,
        body_text || null,
        created_by || null
      ]
    );

    const [newResponse] = await db.execute(
      'SELECT * FROM canned_responses WHERE id = ?',
      [result.insertId]
    );

    res.json({
      success: true,
      data: newResponse[0],
      message: 'Canned response created successfully'
    });

  } catch (error) {
    console.error('[CANNED RESPONSES API] Error creating response:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// UPDATE CANNED RESPONSE
// =============================================================================

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'title',
      'shortcut',
      'category',
      'body_html',
      'body_text',
      'is_active'
    ];

    const fields = Object.keys(updates).filter(key => allowedFields.includes(key));

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = [...fields.map(field => updates[field]), parseInt(id)];

    await db.execute(
      `UPDATE canned_responses SET ${setClause}, updated_at = NOW() WHERE id = ?`,
      values
    );

    const [updated] = await db.execute(
      'SELECT * FROM canned_responses WHERE id = ?',
      [parseInt(id)]
    );

    res.json({
      success: true,
      data: updated[0],
      message: 'Canned response updated successfully'
    });

  } catch (error) {
    console.error('[CANNED RESPONSES API] Error updating response:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// DELETE CANNED RESPONSE
// =============================================================================

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Soft delete (set is_active = FALSE)
    await db.execute(
      'UPDATE canned_responses SET is_active = FALSE WHERE id = ?',
      [parseInt(id)]
    );

    res.json({
      success: true,
      message: 'Canned response deleted successfully'
    });

  } catch (error) {
    console.error('[CANNED RESPONSES API] Error deleting response:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// INCREMENT USAGE COUNT
// =============================================================================

router.post('/:id/use', async (req, res) => {
  try {
    const { id } = req.params;

    await db.execute(
      'UPDATE canned_responses SET usage_count = usage_count + 1 WHERE id = ?',
      [parseInt(id)]
    );

    const [updated] = await db.execute(
      'SELECT usage_count FROM canned_responses WHERE id = ?',
      [parseInt(id)]
    );

    res.json({
      success: true,
      data: { usage_count: updated[0]?.usage_count || 0 }
    });

  } catch (error) {
    console.error('[CANNED RESPONSES API] Error incrementing usage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
