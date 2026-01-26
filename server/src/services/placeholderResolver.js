import db from '../config/database.js';
import { shopify } from '../config/shopify.js';

/**
 * Placeholder Resolver Service
 *
 * Resolves dynamic placeholders in email templates and AI-generated content
 * Supports customer, order, product, vehicle, and company placeholders
 */

/**
 * Get all available placeholders from database
 */
export async function getAvailablePlaceholders(category = null) {
  let query = 'SELECT * FROM available_placeholders WHERE is_active = TRUE';
  const params = [];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY category, placeholder_key';

  const [placeholders] = await db.execute(query, params);

  return placeholders;
}

/**
 * Get customer data for placeholder resolution
 */
async function getCustomerData(customerId, customerEmail) {
  // If we have email but no ID, look up by email
  if (!customerId && customerEmail) {
    const [customers] = await db.execute(
      `SELECT * FROM orders
       WHERE customer_email = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerEmail]
    );

    if (customers.length > 0) {
      return {
        customer_name: customers[0].customer_name,
        customer_email: customers[0].customer_email,
        customer_phone: customers[0].customer_phone || '',
        customer_first_name: customers[0].customer_name?.split(' ')[0] || ''
      };
    }
  }

  return null;
}

/**
 * Get order data for placeholder resolution
 */
async function getOrderData(orderId) {
  if (!orderId) return null;

  try {
    const [orders] = await db.execute(
      `SELECT * FROM orders WHERE id = ?`,
      [orderId]
    );

    if (orders.length === 0) return null;

    const order = orders[0];

    // Get line items
    const [lineItems] = await db.execute(
      `SELECT * FROM order_items WHERE shopify_order_id = ?`,
      [order.shopify_order_id]
    );

    // Extract product info from first wheel item
    let wheelBrand = '';
    let wheelModel = '';
    let wheelSize = '';
    let wheelFinish = '';

    for (const item of lineItems) {
      // Skip non-wheel items
      if (item.title.toLowerCase().includes('shipping') ||
          item.title.toLowerCase().includes('installation') ||
          item.title.toLowerCase().includes('hub centric')) {
        continue;
      }

      // Extract wheel info from title or product data
      wheelBrand = item.vendor || '';

      // Try to parse model from title (format: "Brand Model Size Finish")
      const titleParts = item.title.split(' ');
      if (titleParts.length >= 2) {
        wheelModel = titleParts.slice(1, 3).join(' '); // Rough guess
      }

      break; // Use first wheel item
    }

    // Format order date
    const orderDate = new Date(order.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return {
      order_number: order.order_number,
      order_total: order.total_price ? `$${parseFloat(order.total_price).toFixed(2)}` : '',
      order_date: orderDate,
      order_status: order.fulfillment_status || 'Processing',
      tracking_number: order.tracking_number || 'Not yet available',
      vehicle_year: order.vehicle_year || '',
      vehicle_make: order.vehicle_make || '',
      vehicle_model: order.vehicle_model || '',
      vehicle_trim: order.vehicle_trim || '',
      vehicle_full: [order.vehicle_year, order.vehicle_make, order.vehicle_model, order.vehicle_trim]
        .filter(Boolean)
        .join(' '),
      wheel_brand: wheelBrand,
      wheel_model: wheelModel,
      wheel_size: wheelSize,
      wheel_finish: wheelFinish,
      product_names: lineItems.map(item => item.title).join(', ')
    };

  } catch (error) {
    console.error('❌ Failed to get order data:', error);
    return null;
  }
}

/**
 * Get company/default placeholders
 */
function getCompanyData() {
  return {
    company_name: 'TFS Wheels',
    company_email: 'sales@tfswheels.com',
    company_phone: process.env.COMPANY_PHONE || '',
    company_website: 'https://tfswheels.com'
  };
}

/**
 * Build placeholder data object from all sources
 */
export async function buildPlaceholderData(context = {}) {
  const data = {};

  // Always include company data
  Object.assign(data, getCompanyData());

  // Add customer data
  if (context.customerId || context.customerEmail) {
    const customerData = await getCustomerData(context.customerId, context.customerEmail);
    if (customerData) {
      Object.assign(data, customerData);
    }
  }

  // Add explicit customer data from context
  if (context.customerName) {
    data.customer_name = context.customerName;
    data.customer_first_name = context.customerName.split(' ')[0];
  }
  if (context.customerEmail) {
    data.customer_email = context.customerEmail;
  }

  // Add order data
  if (context.orderId) {
    const orderData = await getOrderData(context.orderId);
    if (orderData) {
      Object.assign(data, orderData);
    }
  }

  // Allow context to override any values
  Object.assign(data, context.overrides || {});

  return data;
}

/**
 * Resolve placeholders in text
 *
 * @param {string} text - Text with placeholders like {{customer_name}}
 * @param {object} data - Data object with values
 * @returns {string} Text with placeholders replaced
 */
export function resolvePlaceholders(text, data) {
  if (!text) return text;

  let resolved = text;

  // Find all placeholders in format {{key}}
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  const matches = text.matchAll(placeholderRegex);

  for (const match of matches) {
    const fullMatch = match[0]; // {{customer_name}}
    const key = match[1]; // customer_name

    // Get value from data, or use placeholder's default, or leave placeholder
    const value = data[key] !== undefined ? data[key] : fullMatch;

    resolved = resolved.replace(fullMatch, value);
  }

  return resolved;
}

/**
 * Resolve placeholders in email template
 *
 * @param {string} subject - Email subject with placeholders
 * @param {string} body - Email body with placeholders
 * @param {object} context - Context for placeholder resolution
 * @returns {Promise<object>} Resolved email with subject and body
 */
export async function resolveEmailTemplate(subject, body, context = {}) {
  try {
    // Build placeholder data from context
    const data = await buildPlaceholderData(context);

    // Resolve placeholders
    const resolvedSubject = resolvePlaceholders(subject, data);
    const resolvedBody = resolvePlaceholders(body, data);

    return {
      subject: resolvedSubject,
      body: resolvedBody,
      resolvedData: data
    };

  } catch (error) {
    console.error('❌ Failed to resolve email template:', error);
    throw error;
  }
}

/**
 * Get preview of email with placeholders resolved
 *
 * @param {number} templateId - Template ID
 * @param {object} context - Context for preview
 * @returns {Promise<object>} Preview data
 */
export async function getTemplatePreview(templateId, context = {}) {
  try {
    // Get template
    const [templates] = await db.execute(
      'SELECT * FROM email_templates WHERE id = ?',
      [templateId]
    );

    if (templates.length === 0) {
      throw new Error('Template not found');
    }

    const template = templates[0];

    // Resolve placeholders
    const resolved = await resolveEmailTemplate(template.subject, template.body, context);

    return {
      template_id: templateId,
      template_name: template.name,
      subject: resolved.subject,
      body: resolved.body,
      placeholders_used: extractPlaceholdersFromText(template.subject + ' ' + template.body),
      resolved_data: resolved.resolvedData
    };

  } catch (error) {
    console.error('❌ Failed to get template preview:', error);
    throw error;
  }
}

/**
 * Extract placeholder keys from text
 */
function extractPlaceholdersFromText(text) {
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  const matches = [...text.matchAll(placeholderRegex)];
  return [...new Set(matches.map(m => m[1]))]; // Unique keys
}

/**
 * Validate that all required placeholders have data
 */
export function validatePlaceholders(text, data) {
  const placeholders = extractPlaceholdersFromText(text);
  const missing = [];

  for (const key of placeholders) {
    if (data[key] === undefined || data[key] === '') {
      missing.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing: missing,
    found: placeholders.filter(k => data[k] !== undefined && data[k] !== '')
  };
}

/**
 * Get placeholder suggestions for text editor
 * Returns placeholders relevant to the context
 */
export async function getPlaceholderSuggestions(context = {}) {
  const placeholders = await getAvailablePlaceholders();

  // Filter by context
  let filtered = placeholders;

  if (!context.orderId) {
    // Remove order-required placeholders if no order
    filtered = filtered.filter(p => !p.requires_order);
  }

  // Group by category
  const grouped = {};
  for (const placeholder of filtered) {
    if (!grouped[placeholder.category]) {
      grouped[placeholder.category] = [];
    }
    grouped[placeholder.category].push({
      key: placeholder.placeholder_key,
      name: placeholder.display_name,
      description: placeholder.description,
      sample: placeholder.sample_value,
      syntax: `{{${placeholder.placeholder_key}}}`
    });
  }

  return grouped;
}

export default {
  getAvailablePlaceholders,
  buildPlaceholderData,
  resolvePlaceholders,
  resolveEmailTemplate,
  getTemplatePreview,
  validatePlaceholders,
  getPlaceholderSuggestions
};
