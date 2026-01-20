import express from 'express';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get all email templates
 */
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Fetch templates
    const [templates] = await db.execute(
      `SELECT * FROM email_templates
       WHERE shop_id = ?
       ORDER BY name ASC`,
      [shopId]
    );

    res.json({
      success: true,
      templates: templates
    });

  } catch (error) {
    console.error('❌ Error fetching email templates:', error);
    res.status(500).json({
      error: 'Failed to fetch email templates',
      message: error.message
    });
  }
});

/**
 * Get single email template by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { id } = req.params;

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Fetch template
    const [templates] = await db.execute(
      'SELECT * FROM email_templates WHERE id = ? AND shop_id = ?',
      [id, shopId]
    );

    if (templates.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      success: true,
      template: templates[0]
    });

  } catch (error) {
    console.error('❌ Error fetching email template:', error);
    res.status(500).json({
      error: 'Failed to fetch email template',
      message: error.message
    });
  }
});

/**
 * Create new email template
 */
router.post('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { name, description, subject, body, template_type, category, variables } = req.body;

    console.log(`📧 Creating email template: ${name}`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Create template
    const [result] = await db.execute(
      `INSERT INTO email_templates (
        shop_id,
        name,
        description,
        subject,
        body,
        template_type,
        category,
        variables,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        shopId,
        name,
        description || null,
        subject,
        body,
        template_type || 'custom',
        category || 'general',
        JSON.stringify(variables || [])
      ]
    );

    console.log(`✅ Created email template #${result.insertId}`);

    res.json({
      success: true,
      message: 'Email template created successfully',
      templateId: result.insertId
    });

  } catch (error) {
    console.error('❌ Error creating email template:', error);
    res.status(500).json({
      error: 'Failed to create email template',
      message: error.message
    });
  }
});

/**
 * Update email template
 */
router.put('/:id', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { id } = req.params;
    const { name, description, subject, body, template_type, category, variables } = req.body;

    console.log(`📧 Updating email template #${id}`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Update template
    await db.execute(
      `UPDATE email_templates
       SET name = ?,
           description = ?,
           subject = ?,
           body = ?,
           template_type = ?,
           category = ?,
           variables = ?,
           updated_at = NOW()
       WHERE id = ? AND shop_id = ?`,
      [
        name,
        description || null,
        subject,
        body,
        template_type || 'custom',
        category || 'general',
        JSON.stringify(variables || []),
        id,
        shopId
      ]
    );

    console.log(`✅ Updated email template #${id}`);

    res.json({
      success: true,
      message: 'Email template updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating email template:', error);
    res.status(500).json({
      error: 'Failed to update email template',
      message: error.message
    });
  }
});

/**
 * Delete email template
 */
router.delete('/:id', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { id } = req.params;

    console.log(`🗑️  Deleting email template #${id}`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Delete template
    await db.execute(
      'DELETE FROM email_templates WHERE id = ? AND shop_id = ?',
      [id, shopId]
    );

    console.log(`✅ Deleted email template #${id}`);

    res.json({
      success: true,
      message: 'Email template deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting email template:', error);
    res.status(500).json({
      error: 'Failed to delete email template',
      message: error.message
    });
  }
});

export default router;
