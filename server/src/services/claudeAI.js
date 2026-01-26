import Anthropic from '@anthropic-ai/sdk';
import db from '../config/database.js';

/**
 * Claude AI Service for Email Generation
 *
 * Handles AI-powered email generation using Claude Opus
 * Features:
 * - Dynamic response generation based on context
 * - Brand voice customization
 * - Thread-aware responses
 * - Placeholder integration
 */

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Get AI settings from shop_settings
 */
async function getAISettings(shopId) {
  const [rows] = await db.execute(
    `SELECT ai_enabled, ai_model, ai_temperature, ai_max_tokens
     FROM shop_settings
     WHERE shop_id = ?`,
    [shopId]
  );

  if (rows.length === 0) {
    // Return defaults if no settings
    return {
      ai_enabled: true,
      ai_model: 'claude-opus-4-20250514',
      ai_temperature: 0.7,
      ai_max_tokens: 4000
    };
  }

  return rows[0];
}

/**
 * Get active brand voice configuration
 */
async function getBrandVoice(shopId, voiceName = null) {
  let query = `
    SELECT * FROM ai_brand_voice
    WHERE shop_id = ? AND is_active = TRUE
  `;
  const params = [shopId];

  if (voiceName) {
    query += ' AND voice_name = ?';
    params.push(voiceName);
  } else {
    query += ' AND is_default = TRUE';
  }

  query += ' LIMIT 1';

  const [rows] = await db.execute(query, params);

  if (rows.length === 0) {
    // Return default friendly voice if none configured
    return {
      voice_name: 'friendly',
      system_prompt: 'You are a friendly and helpful customer service representative.',
      tone_keywords: { use: ['friendly', 'helpful'], avoid: ['formal', 'stiff'] },
      formality_level: 'balanced'
    };
  }

  return rows[0];
}

/**
 * Get email thread context for AI
 */
async function getThreadContext(conversationId) {
  if (!conversationId) return null;

  const [emails] = await db.execute(
    `SELECT
      direction,
      from_email,
      from_name,
      subject,
      body_text,
      body_html,
      sent_at,
      received_at
    FROM customer_emails
    WHERE conversation_id = ?
    ORDER BY COALESCE(sent_at, received_at) ASC`,
    [conversationId]
  );

  return emails;
}

/**
 * Format thread history for Claude context
 */
function formatThreadForContext(emails) {
  if (!emails || emails.length === 0) return '';

  let context = '\n\n## Email Thread History:\n\n';

  emails.forEach((email, index) => {
    const timestamp = email.sent_at || email.received_at;
    const direction = email.direction === 'inbound' ? 'Customer' : 'Us';
    const body = email.body_text || email.body_html || '';

    context += `### Message ${index + 1} (${direction} - ${timestamp})\n`;
    context += `From: ${email.from_name || email.from_email}\n`;
    context += `Subject: ${email.subject}\n\n`;
    context += `${body}\n\n`;
    context += '---\n\n';
  });

  return context;
}

/**
 * Build system prompt for Claude
 */
function buildSystemPrompt(brandVoice, context = {}) {
  let systemPrompt = brandVoice.system_prompt;

  // Add context about available data
  if (context.hasOrder) {
    systemPrompt += '\n\nYou have access to order information including order number, products purchased, vehicle information, and customer details.';
  }

  if (context.hasVehicle) {
    systemPrompt += ' The customer has vehicle information on file.';
  }

  // Add tone guidance
  if (brandVoice.tone_keywords) {
    const keywords = typeof brandVoice.tone_keywords === 'string'
      ? JSON.parse(brandVoice.tone_keywords)
      : brandVoice.tone_keywords;

    if (keywords.use && keywords.use.length > 0) {
      systemPrompt += `\n\nTone guidance - Use these words/phrases: ${keywords.use.join(', ')}`;
    }
    if (keywords.avoid && keywords.avoid.length > 0) {
      systemPrompt += `\nAvoid these words/phrases: ${keywords.avoid.join(', ')}`;
    }
  }

  // Add placeholder instructions
  systemPrompt += '\n\nIMPORTANT: When you need to include specific customer data, use placeholders in this format: {{placeholder_key}}. Available placeholders include:';
  systemPrompt += '\n- {{customer_name}} or {{customer_first_name}}';
  systemPrompt += '\n- {{order_number}}';
  systemPrompt += '\n- {{vehicle_full}} or {{vehicle_year}}, {{vehicle_make}}, {{vehicle_model}}';
  systemPrompt += '\n- {{wheel_brand}}, {{wheel_model}}';
  systemPrompt += '\n- {{tracking_number}}';
  systemPrompt += '\nUse these placeholders naturally in your response.';

  return systemPrompt;
}

/**
 * Generate AI email response
 *
 * @param {number} shopId - Shop ID
 * @param {object} options - Generation options
 * @param {string} options.prompt - User prompt/instruction
 * @param {number} options.conversationId - Email thread ID
 * @param {number} options.orderId - Related order ID
 * @param {object} options.customerData - Customer information
 * @param {string} options.voiceName - Brand voice to use
 * @param {string} options.context - Additional context
 * @param {number} options.temperature - AI temperature (0.0-1.0)
 * @returns {Promise<object>} Generated email with metadata
 */
export async function generateEmailResponse(shopId, options) {
  try {
    console.log('🤖 Generating AI email response...');

    // Get AI settings
    const aiSettings = await getAISettings(shopId);

    if (!aiSettings.ai_enabled) {
      throw new Error('AI features are disabled for this shop');
    }

    // Get brand voice
    const brandVoice = await getBrandVoice(shopId, options.voiceName);
    console.log(`📝 Using brand voice: ${brandVoice.voice_name || brandVoice.display_name}`);

    // Get thread context if conversation ID provided
    let threadEmails = null;
    let threadContext = '';
    if (options.conversationId) {
      threadEmails = await getThreadContext(options.conversationId);
      threadContext = formatThreadForContext(threadEmails);
      console.log(`📧 Loaded ${threadEmails.length} previous emails from thread`);
    }

    // Build context object
    const context = {
      hasOrder: !!options.orderId,
      hasVehicle: !!(options.customerData?.vehicle_full || options.customerData?.vehicle_year),
      threadLength: threadEmails ? threadEmails.length : 0
    };

    // Build system prompt
    const systemPrompt = buildSystemPrompt(brandVoice, context);

    // Build user prompt
    let userPrompt = options.prompt;

    // Add thread context
    if (threadContext) {
      userPrompt = threadContext + '\n\n' + userPrompt;
    }

    // Add customer data context
    if (options.customerData) {
      userPrompt += '\n\n## Customer Information:\n';
      Object.entries(options.customerData).forEach(([key, value]) => {
        if (value) {
          userPrompt += `- ${key}: ${value}\n`;
        }
      });
    }

    // Add additional context
    if (options.context) {
      userPrompt += '\n\n## Additional Context:\n' + options.context;
    }

    console.log('📤 Sending request to Claude...');

    // Call Claude API
    // Ensure temperature is a number (database returns strings)
    const temperature = options.temperature !== undefined
      ? parseFloat(options.temperature)
      : parseFloat(aiSettings.ai_temperature || 0.7);
    const model = aiSettings.ai_model || 'claude-opus-4-20250514';
    const maxTokens = parseInt(aiSettings.ai_max_tokens || 4000);

    const message = await anthropic.messages.create({
      model: model,
      max_tokens: maxTokens,
      temperature: temperature,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    console.log('✅ AI response generated successfully');

    // Extract response text
    const responseText = message.content[0].text;

    // Calculate tokens used
    const tokensUsed = message.usage.input_tokens + message.usage.output_tokens;

    // Calculate estimated cost (Opus pricing: $15/M input, $75/M output)
    const inputCost = (message.usage.input_tokens / 1000000) * 15;
    const outputCost = (message.usage.output_tokens / 1000000) * 75;
    const totalCost = inputCost + outputCost;

    console.log(`💰 Tokens used: ${tokensUsed} (Cost: $${totalCost.toFixed(4)})`);

    return {
      success: true,
      content: responseText,
      metadata: {
        model: model,
        brand_voice: brandVoice.voice_name || brandVoice.display_name,
        tokens_used: tokensUsed,
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cost_usd: totalCost,
        temperature: temperature,
        thread_length: context.threadLength
      },
      ai_prompt: userPrompt.substring(0, 1000), // Store truncated prompt for debugging
      raw_response: message
    };

  } catch (error) {
    console.error('❌ AI generation failed:', error);

    if (error.status === 401) {
      throw new Error('Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY environment variable.');
    }

    if (error.status === 429) {
      throw new Error('Rate limit exceeded. Please try again in a moment.');
    }

    throw new Error(`AI generation failed: ${error.message}`);
  }
}

/**
 * Generate thread summary using AI
 *
 * @param {number} shopId - Shop ID
 * @param {number} conversationId - Conversation ID
 * @returns {Promise<object>} Summary and metadata
 */
export async function generateThreadSummary(shopId, conversationId) {
  try {
    console.log(`📋 Generating thread summary for conversation #${conversationId}`);

    // Get thread emails
    const threadEmails = await getThreadContext(conversationId);

    if (!threadEmails || threadEmails.length === 0) {
      throw new Error('No emails found in thread');
    }

    // Format thread
    const threadContext = formatThreadForContext(threadEmails);

    // Build summary prompt
    const summaryPrompt = `Please provide a concise summary of this email conversation thread. Include:

1. Main topic/issue discussed
2. Key points from customer
3. Our responses and actions taken
4. Current status (resolved, pending, needs follow-up)
5. Any important dates, order numbers, or product details mentioned

Keep the summary brief (3-5 sentences) but informative for a team member who needs to quickly understand the situation.

${threadContext}`;

    // Use a simpler system prompt for summaries
    const systemPrompt = 'You are an expert at summarizing customer service email conversations. Provide clear, factual summaries that help team members quickly understand the context.';

    const aiSettings = await getAISettings(shopId);

    // Call Claude
    const message = await anthropic.messages.create({
      model: aiSettings.ai_model || 'claude-opus-4-20250514',
      max_tokens: 1000, // Summaries should be short
      temperature: 0.3, // Lower temperature for factual summaries
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: summaryPrompt
        }
      ]
    });

    const summary = message.content[0].text;

    // Save summary to database
    await db.execute(
      `UPDATE email_conversations
       SET ai_summary = ?,
           ai_summary_generated_at = NOW()
       WHERE id = ?`,
      [summary, conversationId]
    );

    console.log('✅ Thread summary generated and saved');

    return {
      success: true,
      summary: summary,
      metadata: {
        conversation_id: conversationId,
        email_count: threadEmails.length,
        tokens_used: message.usage.input_tokens + message.usage.output_tokens
      }
    };

  } catch (error) {
    console.error('❌ Thread summary generation failed:', error);
    throw error;
  }
}

/**
 * Improve existing email draft using AI
 *
 * @param {number} shopId - Shop ID
 * @param {string} draft - Current draft text
 * @param {string} instructions - Improvement instructions
 * @param {string} voiceName - Brand voice to use
 * @returns {Promise<object>} Improved draft
 */
export async function improveDraft(shopId, draft, instructions, voiceName = null) {
  try {
    console.log('✨ Improving email draft with AI...');

    const brandVoice = await getBrandVoice(shopId, voiceName);
    const aiSettings = await getAISettings(shopId);

    const systemPrompt = buildSystemPrompt(brandVoice, {});

    const userPrompt = `Please improve the following email draft based on these instructions:

Instructions: ${instructions}

Current Draft:
${draft}

Please provide an improved version while maintaining the core message and using appropriate placeholders like {{customer_name}}, {{order_number}}, etc.`;

    const message = await anthropic.messages.create({
      model: aiSettings.ai_model || 'claude-opus-4-20250514',
      max_tokens: aiSettings.ai_max_tokens,
      temperature: aiSettings.ai_temperature,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const improvedDraft = message.content[0].text;

    console.log('✅ Draft improved successfully');

    return {
      success: true,
      content: improvedDraft,
      metadata: {
        tokens_used: message.usage.input_tokens + message.usage.output_tokens
      }
    };

  } catch (error) {
    console.error('❌ Draft improvement failed:', error);
    throw error;
  }
}

/**
 * Validate that Anthropic API key is configured
 */
export function validateAPIKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set. Please add it to Railway.');
  }

  // Accept both old format (sk-ant-) and new format (sk-ant-api03-)
  if (!process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    throw new Error('ANTHROPIC_API_KEY appears to be invalid. It should start with "sk-ant-"');
  }

  return true;
}

export default {
  generateEmailResponse,
  generateThreadSummary,
  improveDraft,
  validateAPIKey
};
