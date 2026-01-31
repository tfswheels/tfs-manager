/**
 * Settings API Routes
 *
 * Handles all ticketing system settings:
 * - GET /api/settings/:shopId - Get all settings
 * - PUT /api/settings/:shopId/ticket - Update ticket settings
 * - GET /api/settings/:shopId/business-hours - Get business hours
 * - PUT /api/settings/:shopId/business-hours - Update business hours
 * - GET /api/settings/:shopId/footer - Get email footer settings
 * - PUT /api/settings/:shopId/footer - Update email footer settings
 * - POST /api/settings/:shopId/footer/logo-upload - Upload footer logo
 */

import express from 'express';
import settingsManager from '../services/settingsManager.js';

const router = express.Router();

// =============================================================================
// GET ALL SETTINGS
// =============================================================================

router.get('/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;

    const settings = await settingsManager.getAllSettings(parseInt(shopId));

    res.json({
      success: true,
      data: settings
    });

  } catch (error) {
    console.error('[SETTINGS API] Error getting settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// TICKET SETTINGS
// =============================================================================

router.put('/:shopId/ticket', async (req, res) => {
  try {
    const { shopId } = req.params;
    const updates = req.body;

    const updatedSettings = await settingsManager.updateTicketSettings(
      parseInt(shopId),
      updates
    );

    res.json({
      success: true,
      data: updatedSettings,
      message: 'Ticket settings updated successfully'
    });

  } catch (error) {
    console.error('[SETTINGS API] Error updating ticket settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// BUSINESS HOURS
// =============================================================================

router.get('/:shopId/business-hours', async (req, res) => {
  try {
    const { shopId } = req.params;

    const hours = await settingsManager.getBusinessHours(parseInt(shopId));

    res.json({
      success: true,
      data: hours
    });

  } catch (error) {
    console.error('[SETTINGS API] Error getting business hours:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.put('/:shopId/business-hours', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { hours } = req.body;

    if (!Array.isArray(hours)) {
      return res.status(400).json({
        success: false,
        error: 'hours must be an array'
      });
    }

    const updatedHours = await settingsManager.updateBusinessHours(
      parseInt(shopId),
      hours
    );

    res.json({
      success: true,
      data: updatedHours,
      message: 'Business hours updated successfully'
    });

  } catch (error) {
    console.error('[SETTINGS API] Error updating business hours:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// EMAIL FOOTER SETTINGS
// =============================================================================

router.get('/:shopId/footer', async (req, res) => {
  try {
    const { shopId } = req.params;

    const footer = await settingsManager.getEmailFooterSettings(parseInt(shopId));

    res.json({
      success: true,
      data: footer
    });

  } catch (error) {
    console.error('[SETTINGS API] Error getting footer settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.put('/:shopId/footer', async (req, res) => {
  try {
    const { shopId } = req.params;
    const updates = req.body;

    const updatedFooter = await settingsManager.updateEmailFooterSettings(
      parseInt(shopId),
      updates
    );

    res.json({
      success: true,
      data: updatedFooter,
      message: 'Email footer settings updated successfully'
    });

  } catch (error) {
    console.error('[SETTINGS API] Error updating footer settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// LOGO UPLOAD
// =============================================================================
// TODO: Implement file upload with multer or similar
// For now, accepts logoUrl as a string

router.post('/:shopId/footer/logo-upload', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { logoUrl } = req.body;

    if (!logoUrl) {
      return res.status(400).json({
        success: false,
        error: 'logoUrl is required'
      });
    }

    const updatedFooter = await settingsManager.updateEmailFooterSettings(
      parseInt(shopId),
      { logo_url: logoUrl }
    );

    res.json({
      success: true,
      data: { logoUrl: updatedFooter.logo_url },
      message: 'Logo uploaded successfully'
    });

  } catch (error) {
    console.error('[SETTINGS API] Error uploading logo:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
