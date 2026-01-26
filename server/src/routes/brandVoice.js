import express from 'express';
import db from '../config/database.js';

const router = express.Router();

/**
 * Brand Voice Management Routes
 *
 * Allows configuration of AI brand voices for email generation
 * - Tone and formality settings
 * - System prompts and instructions
 * - Example emails for few-shot learning
 * - Keywords to use/avoid
 */

/**
 * GET /api/brand-voice
 * Get all brand voices for a shop
 */
router.get('/', async (req, res) => {
  try {
    const shopId = req.user?.shopId || 1;
    const { includeInactive = 'false' } = req.query;

    let query = 'SELECT * FROM ai_brand_voice WHERE shop_id = ?';
    const params = [shopId];

    if (includeInactive === 'false') {
      query += ' AND is_active = TRUE';
    }

    query += ' ORDER BY is_default DESC, voice_name ASC';

    const [voices] = await db.execute(query, params);

    // Parse JSON fields
    const parsedVoices = voices.map(voice => ({
      ...voice,
      tone_keywords: typeof voice.tone_keywords === 'string'
        ? JSON.parse(voice.tone_keywords)
        : voice.tone_keywords,
      example_emails: typeof voice.example_emails === 'string'
        ? JSON.parse(voice.example_emails)
        : voice.example_emails
    }));

    res.json({
      success: true,
      voices: parsedVoices
    });

  } catch (error) {
    console.error('❌ Brand voice fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/brand-voice/:id
 * Get single brand voice by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const voiceId = parseInt(req.params.id);

    const [voices] = await db.execute(
      'SELECT * FROM ai_brand_voice WHERE id = ?',
      [voiceId]
    );

    if (voices.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand voice not found'
      });
    }

    const voice = voices[0];

    // Parse JSON fields
    voice.tone_keywords = typeof voice.tone_keywords === 'string'
      ? JSON.parse(voice.tone_keywords)
      : voice.tone_keywords;
    voice.example_emails = typeof voice.example_emails === 'string'
      ? JSON.parse(voice.example_emails)
      : voice.example_emails;

    res.json({
      success: true,
      voice: voice
    });

  } catch (error) {
    console.error('❌ Brand voice fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/brand-voice/default
 * Get default brand voice for shop
 */
router.get('/default/current', async (req, res) => {
  try {
    const shopId = req.user?.shopId || 1;

    const [voices] = await db.execute(
      `SELECT * FROM ai_brand_voice
       WHERE shop_id = ? AND is_default = TRUE AND is_active = TRUE
       LIMIT 1`,
      [shopId]
    );

    if (voices.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No default brand voice found'
      });
    }

    const voice = voices[0];

    // Parse JSON fields
    voice.tone_keywords = typeof voice.tone_keywords === 'string'
      ? JSON.parse(voice.tone_keywords)
      : voice.tone_keywords;
    voice.example_emails = typeof voice.example_emails === 'string'
      ? JSON.parse(voice.example_emails)
      : voice.example_emails;

    res.json({
      success: true,
      voice: voice
    });

  } catch (error) {
    console.error('❌ Default brand voice fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/brand-voice
 * Create new brand voice
 */
router.post('/', async (req, res) => {
  try {
    const {
      voiceName,
      displayName,
      description,
      systemPrompt,
      toneKeywords,
      formalityLevel,
      exampleEmails,
      isDefault = false,
      isActive = true
    } = req.body;

    const shopId = req.user?.shopId || 1;

    // Validation
    if (!voiceName || !displayName || !systemPrompt) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: voiceName, displayName, systemPrompt'
      });
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await db.execute(
        'UPDATE ai_brand_voice SET is_default = FALSE WHERE shop_id = ?',
        [shopId]
      );
    }

    // Create brand voice
    const [result] = await db.execute(
      `INSERT INTO ai_brand_voice (
        shop_id,
        voice_name,
        display_name,
        description,
        system_prompt,
        tone_keywords,
        formality_level,
        example_emails,
        is_default,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        voiceName,
        displayName,
        description,
        systemPrompt,
        JSON.stringify(toneKeywords || { use: [], avoid: [] }),
        formalityLevel || 'balanced',
        JSON.stringify(exampleEmails || []),
        isDefault,
        isActive
      ]
    );

    console.log(`✅ Brand voice created: ${displayName} (#${result.insertId})`);

    res.json({
      success: true,
      voiceId: result.insertId,
      message: 'Brand voice created successfully'
    });

  } catch (error) {
    console.error('❌ Brand voice creation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/brand-voice/:id
 * Update brand voice
 */
router.put('/:id', async (req, res) => {
  try {
    const voiceId = parseInt(req.params.id);
    const {
      voiceName,
      displayName,
      description,
      systemPrompt,
      toneKeywords,
      formalityLevel,
      exampleEmails,
      isDefault,
      isActive
    } = req.body;

    const shopId = req.user?.shopId || 1;

    // Check if voice exists
    const [existing] = await db.execute(
      'SELECT * FROM ai_brand_voice WHERE id = ? AND shop_id = ?',
      [voiceId, shopId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand voice not found'
      });
    }

    // If setting as default, unset other defaults
    if (isDefault && !existing[0].is_default) {
      await db.execute(
        'UPDATE ai_brand_voice SET is_default = FALSE WHERE shop_id = ? AND id != ?',
        [shopId, voiceId]
      );
    }

    // Update brand voice
    await db.execute(
      `UPDATE ai_brand_voice SET
        voice_name = ?,
        display_name = ?,
        description = ?,
        system_prompt = ?,
        tone_keywords = ?,
        formality_level = ?,
        example_emails = ?,
        is_default = ?,
        is_active = ?,
        updated_at = NOW()
      WHERE id = ?`,
      [
        voiceName !== undefined ? voiceName : existing[0].voice_name,
        displayName !== undefined ? displayName : existing[0].display_name,
        description !== undefined ? description : existing[0].description,
        systemPrompt !== undefined ? systemPrompt : existing[0].system_prompt,
        toneKeywords !== undefined ? JSON.stringify(toneKeywords) : existing[0].tone_keywords,
        formalityLevel !== undefined ? formalityLevel : existing[0].formality_level,
        exampleEmails !== undefined ? JSON.stringify(exampleEmails) : existing[0].example_emails,
        isDefault !== undefined ? isDefault : existing[0].is_default,
        isActive !== undefined ? isActive : existing[0].is_active,
        voiceId
      ]
    );

    console.log(`✅ Brand voice updated: ${displayName || existing[0].display_name} (#${voiceId})`);

    res.json({
      success: true,
      message: 'Brand voice updated successfully'
    });

  } catch (error) {
    console.error('❌ Brand voice update failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/brand-voice/:id
 * Delete brand voice
 */
router.delete('/:id', async (req, res) => {
  try {
    const voiceId = parseInt(req.params.id);
    const shopId = req.user?.shopId || 1;

    // Check if voice exists and is not default
    const [existing] = await db.execute(
      'SELECT * FROM ai_brand_voice WHERE id = ? AND shop_id = ?',
      [voiceId, shopId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand voice not found'
      });
    }

    if (existing[0].is_default) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete default brand voice. Set another voice as default first.'
      });
    }

    // Delete brand voice
    await db.execute(
      'DELETE FROM ai_brand_voice WHERE id = ?',
      [voiceId]
    );

    console.log(`✅ Brand voice deleted: ${existing[0].display_name} (#${voiceId})`);

    res.json({
      success: true,
      message: 'Brand voice deleted successfully'
    });

  } catch (error) {
    console.error('❌ Brand voice deletion failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/brand-voice/:id/default
 * Set brand voice as default
 */
router.put('/:id/default', async (req, res) => {
  try {
    const voiceId = parseInt(req.params.id);
    const shopId = req.user?.shopId || 1;

    // Check if voice exists
    const [existing] = await db.execute(
      'SELECT * FROM ai_brand_voice WHERE id = ? AND shop_id = ?',
      [voiceId, shopId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand voice not found'
      });
    }

    // Unset all other defaults
    await db.execute(
      'UPDATE ai_brand_voice SET is_default = FALSE WHERE shop_id = ?',
      [shopId]
    );

    // Set this voice as default
    await db.execute(
      'UPDATE ai_brand_voice SET is_default = TRUE WHERE id = ?',
      [voiceId]
    );

    console.log(`✅ Default brand voice set: ${existing[0].display_name} (#${voiceId})`);

    res.json({
      success: true,
      message: 'Default brand voice updated successfully'
    });

  } catch (error) {
    console.error('❌ Default brand voice update failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * PUT /api/brand-voice/:id/toggle
 * Toggle brand voice active status
 */
router.put('/:id/toggle', async (req, res) => {
  try {
    const voiceId = parseInt(req.params.id);
    const shopId = req.user?.shopId || 1;

    // Check if voice exists
    const [existing] = await db.execute(
      'SELECT * FROM ai_brand_voice WHERE id = ? AND shop_id = ?',
      [voiceId, shopId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand voice not found'
      });
    }

    const newStatus = !existing[0].is_active;

    // Don't allow deactivating the default voice
    if (existing[0].is_default && !newStatus) {
      return res.status(400).json({
        success: false,
        error: 'Cannot deactivate default brand voice. Set another voice as default first.'
      });
    }

    // Toggle active status
    await db.execute(
      'UPDATE ai_brand_voice SET is_active = ? WHERE id = ?',
      [newStatus, voiceId]
    );

    console.log(`✅ Brand voice ${newStatus ? 'activated' : 'deactivated'}: ${existing[0].display_name} (#${voiceId})`);

    res.json({
      success: true,
      message: `Brand voice ${newStatus ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus
    });

  } catch (error) {
    console.error('❌ Brand voice toggle failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/brand-voice/:id/test
 * Test brand voice by generating a sample email
 */
router.post('/:id/test', async (req, res) => {
  try {
    const voiceId = parseInt(req.params.id);
    const { testPrompt = 'Write a friendly email thanking a customer for their order.' } = req.body;

    const shopId = req.user?.shopId || 1;

    // Get voice
    const [voices] = await db.execute(
      'SELECT * FROM ai_brand_voice WHERE id = ? AND shop_id = ?',
      [voiceId, shopId]
    );

    if (voices.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Brand voice not found'
      });
    }

    const voice = voices[0];

    // Import AI service (dynamic to avoid circular dependencies)
    const { generateEmailResponse } = await import('../services/claudeAI.js');

    // Generate test email
    const result = await generateEmailResponse(shopId, {
      prompt: testPrompt,
      voiceName: voice.voice_name,
      customerData: {
        customer_name: 'John Smith',
        customer_first_name: 'John',
        order_number: '#1234'
      }
    });

    res.json({
      success: true,
      testResult: {
        voice: voice.display_name,
        prompt: testPrompt,
        generatedContent: result.content,
        metadata: result.metadata
      }
    });

  } catch (error) {
    console.error('❌ Brand voice test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/brand-voice/presets/list
 * Get list of preset brand voices (templates)
 */
router.get('/presets/list', async (req, res) => {
  try {
    const presets = [
      {
        voice_name: 'friendly',
        display_name: 'Friendly & Approachable',
        description: 'Warm, conversational tone that makes customers feel valued',
        system_prompt: 'You are a friendly and helpful customer service representative for TFS Wheels. Write in a warm, conversational tone that makes customers feel valued and heard. Be personable but professional, using a casual-yet-respectful communication style.',
        tone_keywords: {
          use: ['happy to help', 'we appreciate', 'great question', 'thank you', 'welcome'],
          avoid: ['unfortunately', 'I\'m afraid', 'however', 'policy states', 'cannot']
        },
        formality_level: 'casual'
      },
      {
        voice_name: 'professional',
        display_name: 'Professional & Polished',
        description: 'Formal, business-like communication for corporate clients',
        system_prompt: 'You are a professional customer service specialist for TFS Wheels. Maintain a polished, business-appropriate tone in all communications. Be courteous, precise, and detail-oriented while remaining helpful and solution-focused.',
        tone_keywords: {
          use: ['pleased to assist', 'we understand', 'kindly', 'appreciate your patience', 'sincerely'],
          avoid: ['hey', 'yeah', 'totally', 'no worries', 'cool']
        },
        formality_level: 'formal'
      },
      {
        voice_name: 'empathetic',
        display_name: 'Empathetic & Understanding',
        description: 'Compassionate tone for handling complaints or issues',
        system_prompt: 'You are an empathetic customer service representative for TFS Wheels. Show genuine understanding and care for customer concerns. Acknowledge feelings, validate experiences, and focus on finding solutions while maintaining warmth and compassion.',
        tone_keywords: {
          use: ['I understand', 'that must be frustrating', 'we apologize', 'let me help', 'you\'re right'],
          avoid: ['actually', 'just', 'simply', 'calm down', 'per policy']
        },
        formality_level: 'balanced'
      },
      {
        voice_name: 'enthusiastic',
        display_name: 'Enthusiastic & Energetic',
        description: 'Upbeat, excited tone for promotions and positive updates',
        system_prompt: 'You are an enthusiastic brand ambassador for TFS Wheels. Show genuine excitement about products, services, and customer success. Use positive, energetic language that reflects passion for what we do while remaining authentic and helpful.',
        tone_keywords: {
          use: ['excited', 'amazing', 'fantastic', 'can\'t wait', 'love to', 'thrilled'],
          avoid: ['boring', 'standard', 'typical', 'regular', 'normal']
        },
        formality_level: 'casual'
      },
      {
        voice_name: 'technical',
        display_name: 'Technical & Detailed',
        description: 'Precise, information-rich responses for technical inquiries',
        system_prompt: 'You are a technical specialist for TFS Wheels with deep product knowledge. Provide accurate, detailed information with technical precision. Use industry terminology appropriately while ensuring clarity. Be thorough and specification-focused.',
        tone_keywords: {
          use: ['specifically', 'precisely', 'specifications', 'detailed', 'technical'],
          avoid: ['basically', 'kind of', 'sort of', 'pretty much', 'roughly']
        },
        formality_level: 'formal'
      }
    ];

    res.json({
      success: true,
      presets: presets
    });

  } catch (error) {
    console.error('❌ Preset list fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/brand-voice/presets/:presetName
 * Create brand voice from preset
 */
router.post('/presets/:presetName', async (req, res) => {
  try {
    const { presetName } = req.params;
    const { setAsDefault = false } = req.body;
    const shopId = req.user?.shopId || 1;

    // Get preset definition
    const presets = {
      friendly: {
        voice_name: 'friendly',
        display_name: 'Friendly & Approachable',
        description: 'Warm, conversational tone that makes customers feel valued',
        system_prompt: 'You are a friendly and helpful customer service representative for TFS Wheels. Write in a warm, conversational tone that makes customers feel valued and heard. Be personable but professional, using a casual-yet-respectful communication style.',
        tone_keywords: {
          use: ['happy to help', 'we appreciate', 'great question', 'thank you', 'welcome'],
          avoid: ['unfortunately', 'I\'m afraid', 'however', 'policy states', 'cannot']
        },
        formality_level: 'casual'
      },
      professional: {
        voice_name: 'professional',
        display_name: 'Professional & Polished',
        description: 'Formal, business-like communication for corporate clients',
        system_prompt: 'You are a professional customer service specialist for TFS Wheels. Maintain a polished, business-appropriate tone in all communications. Be courteous, precise, and detail-oriented while remaining helpful and solution-focused.',
        tone_keywords: {
          use: ['pleased to assist', 'we understand', 'kindly', 'appreciate your patience', 'sincerely'],
          avoid: ['hey', 'yeah', 'totally', 'no worries', 'cool']
        },
        formality_level: 'formal'
      },
      empathetic: {
        voice_name: 'empathetic',
        display_name: 'Empathetic & Understanding',
        description: 'Compassionate tone for handling complaints or issues',
        system_prompt: 'You are an empathetic customer service representative for TFS Wheels. Show genuine understanding and care for customer concerns. Acknowledge feelings, validate experiences, and focus on finding solutions while maintaining warmth and compassion.',
        tone_keywords: {
          use: ['I understand', 'that must be frustrating', 'we apologize', 'let me help', 'you\'re right'],
          avoid: ['actually', 'just', 'simply', 'calm down', 'per policy']
        },
        formality_level: 'balanced'
      },
      enthusiastic: {
        voice_name: 'enthusiastic',
        display_name: 'Enthusiastic & Energetic',
        description: 'Upbeat, excited tone for promotions and positive updates',
        system_prompt: 'You are an enthusiastic brand ambassador for TFS Wheels. Show genuine excitement about products, services, and customer success. Use positive, energetic language that reflects passion for what we do while remaining authentic and helpful.',
        tone_keywords: {
          use: ['excited', 'amazing', 'fantastic', 'can\'t wait', 'love to', 'thrilled'],
          avoid: ['boring', 'standard', 'typical', 'regular', 'normal']
        },
        formality_level: 'casual'
      },
      technical: {
        voice_name: 'technical',
        display_name: 'Technical & Detailed',
        description: 'Precise, information-rich responses for technical inquiries',
        system_prompt: 'You are a technical specialist for TFS Wheels with deep product knowledge. Provide accurate, detailed information with technical precision. Use industry terminology appropriately while ensuring clarity. Be thorough and specification-focused.',
        tone_keywords: {
          use: ['specifically', 'precisely', 'specifications', 'detailed', 'technical'],
          avoid: ['basically', 'kind of', 'sort of', 'pretty much', 'roughly']
        },
        formality_level: 'formal'
      }
    };

    const preset = presets[presetName];

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: 'Preset not found'
      });
    }

    // Check if this preset already exists for this shop
    const [existing] = await db.execute(
      'SELECT id FROM ai_brand_voice WHERE shop_id = ? AND voice_name = ?',
      [shopId, preset.voice_name]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'This preset is already installed',
        existingId: existing[0].id
      });
    }

    // If setting as default, unset other defaults
    if (setAsDefault) {
      await db.execute(
        'UPDATE ai_brand_voice SET is_default = FALSE WHERE shop_id = ?',
        [shopId]
      );
    }

    // Create brand voice from preset
    const [result] = await db.execute(
      `INSERT INTO ai_brand_voice (
        shop_id,
        voice_name,
        display_name,
        description,
        system_prompt,
        tone_keywords,
        formality_level,
        example_emails,
        is_default,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        shopId,
        preset.voice_name,
        preset.display_name,
        preset.description,
        preset.system_prompt,
        JSON.stringify(preset.tone_keywords),
        preset.formality_level,
        JSON.stringify([]),
        setAsDefault
      ]
    );

    console.log(`✅ Brand voice created from preset: ${preset.display_name} (#${result.insertId})`);

    res.json({
      success: true,
      voiceId: result.insertId,
      message: 'Brand voice created from preset successfully'
    });

  } catch (error) {
    console.error('❌ Preset installation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
