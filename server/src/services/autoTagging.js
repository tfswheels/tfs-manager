/**
 * Auto-Tagging Service
 *
 * Automatically tags tickets based on Shopify customer data:
 * - Has orders → 'customer' tag, 'normal' priority
 * - Has cart/abandoned checkout → 'potential-customer' tag, 'high' priority
 * - Neither → 'visitor' tag, 'low' priority
 *
 * Integrates with Shopify Admin API (GraphQL) to lookup customer data.
 */

import db from '../config/database.js';
import fetch from 'node-fetch';

/**
 * Query Shopify for customer data
 * @param {string} shop - Shopify shop domain (e.g., "mystore.myshopify.com")
 * @param {string} accessToken - Shopify access token
 * @param {string} customerEmail - Customer email to search for
 * @returns {Promise<Object>} Customer data with orders and checkouts
 */
async function queryShopifyCustomer(shop, accessToken, customerEmail) {
  const query = `
    query getCustomer($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            email
            ordersCount
            checkouts(first: 5) {
              edges {
                node {
                  id
                  completedAt
                  createdAt
                }
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    query: `email:${customerEmail}`
  };

  try {
    const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.errors) {
      console.error('[AUTO-TAG] Shopify GraphQL errors:', result.errors);
      throw new Error('Shopify GraphQL query failed');
    }

    const customer = result.data?.customers?.edges[0]?.node;

    return customer || null;

  } catch (error) {
    console.error('[AUTO-TAG] Error querying Shopify:', error.message);
    return null;
  }
}

/**
 * Auto-tag and auto-prioritize ticket based on Shopify customer data
 *
 * Rules:
 * - Customer with orders → 'customer' tag, 'normal' priority
 * - Customer with active cart/abandoned checkout → 'potential-customer' tag, 'high' priority
 * - Neither → 'visitor' tag, 'low' priority
 *
 * @param {number} shopId - Shop ID
 * @param {number} conversationId - Email conversation ID (ticket ID)
 * @param {string} customerEmail - Customer email address
 * @returns {Promise<Object>} { tag, priority, shopifyData }
 */
export async function autoTagTicket(shopId, conversationId, customerEmail) {
  try {
    // Get shop details (domain and access token)
    const [shops] = await db.execute(
      'SELECT shop_name, access_token FROM shops WHERE id = ?',
      [shopId]
    );

    if (shops.length === 0) {
      console.warn('[AUTO-TAG] Shop not found:', shopId);
      return { tag: 'visitor', priority: 'low', shopifyData: null };
    }

    const shop = shops[0].shop_name;
    const accessToken = shops[0].access_token;

    if (!accessToken) {
      console.warn('[AUTO-TAG] No access token for shop:', shop);
      return { tag: 'visitor', priority: 'low', shopifyData: null };
    }

    // Query Shopify for customer data
    const customer = await queryShopifyCustomer(shop, accessToken, customerEmail);

    if (!customer) {
      // Customer not found in Shopify → visitor
      console.log(`[AUTO-TAG] Customer not found in Shopify: ${customerEmail} → visitor/low`);
      return await applyTagAndPriority(conversationId, 'visitor', 'low', null);
    }

    // Determine tag and priority based on Shopify data
    let tag = 'visitor';
    let priority = 'low';

    const hasOrders = customer.ordersCount > 0;
    const hasActiveCheckouts = customer.checkouts?.edges?.some(
      edge => !edge.node.completedAt // Incomplete checkout = abandoned
    );

    if (hasOrders) {
      // Has orders → customer (normal priority)
      tag = 'customer';
      priority = 'normal';
      console.log(`[AUTO-TAG] Customer has ${customer.ordersCount} orders: ${customerEmail} → customer/normal`);
    } else if (hasActiveCheckouts) {
      // Has abandoned checkout → potential-customer (high priority)
      tag = 'potential-customer';
      priority = 'high';
      console.log(`[AUTO-TAG] Customer has abandoned checkout: ${customerEmail} → potential-customer/high`);
    } else {
      // No orders, no checkouts → visitor (low priority)
      console.log(`[AUTO-TAG] Customer has no orders or checkouts: ${customerEmail} → visitor/low`);
    }

    return await applyTagAndPriority(conversationId, tag, priority, customer);

  } catch (error) {
    console.error('[AUTO-TAG] Error auto-tagging ticket:', error);
    // Fallback to visitor/low on error
    return await applyTagAndPriority(conversationId, 'visitor', 'low', null);
  }
}

/**
 * Apply tag and priority to ticket (database update)
 * @param {number} conversationId - Ticket ID
 * @param {string} tag - Tag to apply
 * @param {string} priority - Priority to set
 * @param {Object|null} shopifyData - Shopify customer data (optional)
 * @returns {Promise<Object>} { tag, priority, shopifyData }
 */
async function applyTagAndPriority(conversationId, tag, priority, shopifyData) {
  // Get existing tags
  const [existing] = await db.execute(
    'SELECT tags FROM email_conversations WHERE id = ?',
    [conversationId]
  );

  if (existing.length === 0) {
    console.warn('[AUTO-TAG] Conversation not found:', conversationId);
    return { tag, priority, shopifyData };
  }

  // Parse existing tags (JSON array)
  let tags = [];
  try {
    tags = existing[0].tags ? JSON.parse(existing[0].tags) : [];
  } catch (e) {
    tags = [];
  }

  // Add new tag if not already present
  if (!tags.includes(tag)) {
    tags.push(tag);
  }

  // Update ticket with new tags and priority
  await db.execute(
    `UPDATE email_conversations
     SET tags = ?,
         priority = ?
     WHERE id = ?`,
    [JSON.stringify(tags), priority, conversationId]
  );

  // Log activity
  await db.execute(
    `INSERT INTO ticket_activities (conversation_id, action_type, note, metadata)
     VALUES (?, 'tag_add', 'Auto-tagged based on Shopify data', ?)`,
    [
      conversationId,
      JSON.stringify({ tag, priority, auto: true, shopifyData: shopifyData ? {
        ordersCount: shopifyData.ordersCount,
        checkoutsCount: shopifyData.checkouts?.edges?.length || 0
      } : null })
    ]
  );

  return { tag, priority, shopifyData };
}

/**
 * Manual trigger to re-tag all existing tickets (run once after migration)
 * @param {number} shopId - Shop ID
 * @returns {Promise<Object>} { tagged: number, errors: number }
 */
export async function reTagAllTickets(shopId) {
  console.log('[AUTO-TAG] Re-tagging all existing tickets for shop:', shopId);

  const [tickets] = await db.execute(
    `SELECT id, customer_email
     FROM email_conversations
     WHERE shop_id = ?
     AND status NOT IN ('closed', 'archived')
     AND customer_email IS NOT NULL`,
    [shopId]
  );

  let tagged = 0;
  let errors = 0;

  for (const ticket of tickets) {
    try {
      await autoTagTicket(shopId, ticket.id, ticket.customer_email);
      tagged++;
    } catch (error) {
      console.error(`[AUTO-TAG] Error re-tagging ticket ${ticket.id}:`, error.message);
      errors++;
    }

    // Rate limit: wait 200ms between calls
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`[AUTO-TAG] Re-tagging complete: ${tagged} tagged, ${errors} errors`);

  return { tagged, errors };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  autoTagTicket,
  reTagAllTickets
};
