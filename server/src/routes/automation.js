/**
 * Automation API Routes
 *
 * Manual triggers for automated tasks:
 * - POST /api/automation/:shopId/trigger-reminders - Manually run pending reminders
 * - POST /api/automation/:shopId/trigger-escalation - Manually run escalation check
 * - POST /api/automation/:shopId/trigger-auto-close - Manually run auto-close
 */

import express from 'express';
import automationScheduler from '../services/automationScheduler.js';

const router = express.Router();

// =============================================================================
// TRIGGER PENDING REMINDERS
// =============================================================================

router.post('/:shopId/trigger-reminders', async (req, res) => {
  try {
    const { shopId } = req.params;

    const result = await automationScheduler.triggerPendingReminders(parseInt(shopId));

    res.json({
      success: true,
      data: result,
      message: 'Pending reminders check triggered successfully'
    });

  } catch (error) {
    console.error('[AUTOMATION API] Error triggering reminders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// TRIGGER ESCALATION CHECK
// =============================================================================

router.post('/:shopId/trigger-escalation', async (req, res) => {
  try {
    const { shopId } = req.params;

    const result = await automationScheduler.triggerEscalation(parseInt(shopId));

    res.json({
      success: true,
      data: result,
      message: 'Escalation check triggered successfully'
    });

  } catch (error) {
    console.error('[AUTOMATION API] Error triggering escalation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// TRIGGER AUTO-CLOSE
// =============================================================================

router.post('/:shopId/trigger-auto-close', async (req, res) => {
  try {
    const { shopId } = req.params;

    const result = await automationScheduler.triggerAutoClose(parseInt(shopId));

    res.json({
      success: true,
      data: result,
      message: 'Auto-close check triggered successfully'
    });

  } catch (error) {
    console.error('[AUTOMATION API] Error triggering auto-close:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
