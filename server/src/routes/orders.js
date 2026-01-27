import express from 'express';
import { shopify } from '../config/shopify.js';
import db from '../config/database.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifyShopInstalled } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Get all orders - Fetch from database with search and pagination
 * Query params:
 * - limit: number of orders to fetch (default: 50)
 * - page: page number (default: 1)
 * - search: search query (searches order_number, customer_name, customer_email)
 */
router.get('/', verifyShopInstalled, async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    // Validate and sanitize limit and page parameters to prevent SQL injection
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 50, 500));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const search = req.query.search || '';

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Shop not found',
        message: 'Please install the app first'
      });
    }

    const shopId = rows[0].id;

    // Build search query
    // Use DISTINCT when searching line items to avoid duplicate orders
    const useDistinct = search.trim() ? 'DISTINCT' : '';

    let query = `
      SELECT ${useDistinct}
        o.id,
        o.shopify_order_id,
        o.order_number,
        o.customer_name,
        o.customer_email,
        o.total_price,
        o.financial_status,
        o.fulfillment_status,
        o.tags,
        o.vehicle_year,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_trim,
        o.vehicle_info_notes,
        o.created_at,
        o.updated_at
      FROM orders o
    `;

    const params = [shopId];

    // Add search filter with line items
    if (search.trim()) {
      // Left join to search line items (product names and SKUs)
      query += `
        LEFT JOIN order_items oi ON o.shopify_order_id = oi.shopify_order_id
        WHERE o.shop_id = ? AND (
          o.order_number LIKE ? OR
          o.customer_name LIKE ? OR
          o.customer_email LIKE ? OR
          oi.title LIKE ? OR
          oi.sku LIKE ? OR
          oi.variant_title LIKE ?
        )
      `;
      const searchPattern = `%${search.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    } else {
      query += ` WHERE o.shop_id = ?`;
    }

    // Add ordering and pagination
    // Note: LIMIT and OFFSET cannot be parameterized in MySQL prepared statements
    // They must be literal integers (already validated above)
    const offset = (page - 1) * limit;
    query += ` ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    // Fetch orders from database
    const [orders] = await db.execute(query, params);

    // Get total count for pagination
    let countQuery = '';
    const countParams = [shopId];

    if (search.trim()) {
      countQuery = `
        SELECT COUNT(DISTINCT o.id) as total
        FROM orders o
        LEFT JOIN order_items oi ON o.shopify_order_id = oi.shopify_order_id
        WHERE o.shop_id = ? AND (
          o.order_number LIKE ? OR
          o.customer_name LIKE ? OR
          o.customer_email LIKE ? OR
          oi.title LIKE ? OR
          oi.sku LIKE ? OR
          oi.variant_title LIKE ?
        )
      `;
      const searchPattern = `%${search.trim()}%`;
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    } else {
      countQuery = 'SELECT COUNT(*) as total FROM orders WHERE shop_id = ?';
    }

    const [countResult] = await db.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      count: orders.length,
      total: total,
      page: page,
      limit: limit,
      hasMore: (page * limit) < total,
      orders: orders
    });

  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({
      error: 'Failed to fetch orders',
      message: error.message
    });
  }
});

/**
 * Extract vehicle info from order using the exact same logic as SDW script
 */
function extractVehicleInfo(order) {
  let vehicleInfo = null;

  // 1. Try to get from line items properties (key: 'vehicle' or '_vehicle')
  // In Shopify REST API, line item custom attributes are called 'properties'
  if (order.line_items) {
    for (const item of order.line_items) {
      if (item.properties && Array.isArray(item.properties)) {
        for (const prop of item.properties) {
          const propName = prop.name ? prop.name.toLowerCase() : '';
          if (propName === 'vehicle' || propName === '_vehicle') {
            vehicleInfo = prop.value;
            break;
          }
        }
      }
      if (vehicleInfo) break;
    }
  }

  // 2. Try to get from order notes (pattern: "Vehicle: ...")
  if (!vehicleInfo && order.note) {
    const vehicleMatch = order.note.match(/Vehicle:\s*(.+?)(?:\n|$)/i);
    if (vehicleMatch) {
      vehicleInfo = vehicleMatch[1].trim();
    }
  }

  // 3. Try order-level note_attributes (Shopify order custom attributes)
  if (!vehicleInfo && order.note_attributes && Array.isArray(order.note_attributes)) {
    for (const attr of order.note_attributes) {
      const attrName = attr.name ? attr.name.toLowerCase() : '';
      if (attrName === 'vehicle') {
        vehicleInfo = attr.value;
        break;
      }
    }
  }

  return vehicleInfo;
}

/**
 * Parse vehicle string into components
 */
function parseVehicleInfo(vehicleStr) {
  if (!vehicleStr) {
    return {
      year: null,
      make: null,
      model: null,
      trim: null
    };
  }

  const parts = vehicleStr.trim().split(/\s+/);

  const result = {
    year: null,
    make: null,
    model: null,
    trim: null
  };

  // First part should be year (4 digits)
  if (parts.length >= 1 && parts[0].match(/^\d{4}$/)) {
    result.year = parts[0];

    if (parts.length >= 2) result.make = parts[1];
    if (parts.length >= 3) result.model = parts[2];
    if (parts.length >= 4) result.trim = parts.slice(3).join(' ');
  } else {
    // No year, try to extract make/model
    if (parts.length >= 1) result.make = parts[0];
    if (parts.length >= 2) result.model = parts[1];
    if (parts.length >= 3) result.trim = parts.slice(2).join(' ');
  }

  return result;
}

/**
 * Sync orders from Shopify to database using GraphQL
 */
router.post('/sync', verifyShopInstalled, async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    console.log(`🔄 Syncing ALL orders from Shopify for ${shop}...`);

    // Get access token from database
    const [rows] = await db.execute(
      'SELECT id, access_token, created_at FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Shop not found',
        message: 'Please install the app first'
      });
    }

    const shopId = rows[0].id;
    const accessToken = rows[0].access_token;
    const appInstalledDate = rows[0].created_at;

    if (!accessToken) {
      return res.status(401).json({
        error: 'No access token',
        message: 'Please reinstall the app'
      });
    }

    console.log(`🔐 App installed: ${appInstalledDate ? new Date(appInstalledDate).toISOString().split('T')[0] : 'unknown'}`);

    // First, get total order count from REST API to compare
    let restOrderCount = 0;
    try {
      const countResponse = await fetch(`https://${shop}/admin/api/2024-01/orders/count.json`, {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      });
      if (countResponse.ok) {
        const countData = await countResponse.json();
        restOrderCount = countData.count;
        console.log(`📊 REST API order count: ${restOrderCount}`);
      }
    } catch (e) {
      console.log(`⚠️  Could not fetch order count: ${e.message}`);
    }

    // Try to get count with status filter
    try {
      const allCountResponse = await fetch(`https://${shop}/admin/api/2024-01/orders/count.json?status=any`, {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      });
      if (allCountResponse.ok) {
        const allCountData = await allCountResponse.json();
        console.log(`📊 REST API order count (status=any): ${allCountData.count}`);
      }
    } catch (e) {
      console.log(`⚠️  Could not fetch order count with status filter`);
    }

    // Fetch orders using GraphQL with cursor-based pagination (raw fetch like license-manager)
    let allOrders = [];
    let cursor = null;
    let pageCount = 0;
    const perPage = 250; // GraphQL max is 250

    while (true) {
      pageCount++;
      console.log(`  📄 Fetching page ${pageCount}...`);

      const query = `
        {
          orders(first: ${perPage}${cursor ? `, after: "${cursor}"` : ''}) {
            edges {
              node {
                id
                legacyResourceId
                name
                createdAt
                email
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                displayFinancialStatus
                displayFulfillmentStatus
                tags
                customer {
                  firstName
                  lastName
                  email
                }
                note
                customAttributes {
                  key
                  value
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      customAttributes {
                        key
                        value
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      // Use raw fetch instead of Shopify client (like license-manager app)
      const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        console.error('GraphQL errors:', result.errors);
        throw new Error('GraphQL query failed');
      }

      const ordersData = result.data.orders;
      const edges = ordersData.edges || [];

      if (edges.length === 0) {
        console.log(`    ℹ️  No more orders to fetch`);
        break;
      }

      // Convert GraphQL format to REST-like format for compatibility
      const orders = edges.map(edge => {
        const node = edge.node;

        // Convert ISO 8601 to MySQL datetime format
        const createdAt = node.createdAt ? new Date(node.createdAt) : new Date();

        return {
          id: node.legacyResourceId,
          name: node.name,
          created_at: createdAt, // Will be a Date object
          email: node.email,
          total_price: node.totalPriceSet.shopMoney.amount,
          financial_status: node.displayFinancialStatus,
          fulfillment_status: node.displayFulfillmentStatus,
          tags: node.tags.join(','),
          customer: {
            first_name: node.customer?.firstName,
            last_name: node.customer?.lastName,
            email: node.customer?.email
          },
          note: node.note,
          note_attributes: node.customAttributes?.map(attr => ({
            name: attr.key,
            value: attr.value
          })) || [],
          line_items: node.lineItems.edges.map(li => ({
            properties: li.node.customAttributes?.map(attr => ({
              name: attr.key,
              value: attr.value
            })) || []
          }))
        };
      });

      allOrders = allOrders.concat(orders);

      // Get date range for this page
      const dates = orders.map(o => new Date(o.created_at));
      const newestDate = new Date(Math.max(...dates));
      const oldestDate = new Date(Math.min(...dates));

      console.log(`    ✓ Retrieved ${orders.length} orders (total: ${allOrders.length})`);
      console.log(`    📅 Date range: ${oldestDate.toISOString().split('T')[0]} to ${newestDate.toISOString().split('T')[0]}`);
      console.log(`    🔢 Order numbers: ${orders[orders.length-1].name} to ${orders[0].name}`);

      // Update cursor for next page (like license-manager app)
      const hasMore = ordersData.pageInfo.hasNextPage;
      cursor = hasMore ? ordersData.pageInfo.endCursor : null;

      console.log(`    🔗 hasMore: ${hasMore}, cursor: ${cursor ? 'YES' : 'NO'}`);

      // Break if no more pages
      if (!cursor) {
        console.log(`    ℹ️  No more pages available`);
        break;
      }

      // Safety limit
      if (allOrders.length >= 50000) {
        console.log(`    ⚠️  Safety limit reached (50000 orders)`);
        break;
      }
    }

    console.log(`\n📊 SYNC SUMMARY`);
    console.log(`   Total orders fetched: ${allOrders.length}`);

    if (allOrders.length > 0) {
      // Get overall date range
      const allDates = allOrders.map(o => new Date(o.created_at));
      const newestOrder = new Date(Math.max(...allDates));
      const oldestOrder = new Date(Math.min(...allDates));

      console.log(`   📅 Date range: ${oldestOrder.toISOString().split('T')[0]} to ${newestOrder.toISOString().split('T')[0]}`);
      console.log(`   🔢 Order numbers: ${allOrders[allOrders.length-1].name} to ${allOrders[0].name}`);
      console.log(`   ⏱️  Timespan: ${Math.floor((newestOrder - oldestOrder) / (1000 * 60 * 60 * 24))} days`);
    }

    let syncedCount = 0;
    let vehicleExtractedCount = 0;

    console.log(`\n💾 Saving ${allOrders.length} orders to database...`);

    // Sync orders to database
    for (const order of allOrders) {
      try {
        const customerName = order.customer?.default_address?.name ||
                            (order.customer?.first_name && order.customer?.last_name
                              ? `${order.customer.first_name} ${order.customer.last_name}`
                              : 'Guest');

        // Extract vehicle info using the exact same logic as SDW script
        const vehicleStr = extractVehicleInfo(order);
        const vehicleInfo = parseVehicleInfo(vehicleStr);

        if (vehicleStr) {
          vehicleExtractedCount++;
        }

        await db.execute(
          `INSERT INTO orders (
            shop_id,
            shopify_order_id,
            order_number,
            customer_name,
            customer_email,
            total_price,
            financial_status,
            fulfillment_status,
            tags,
            vehicle_year,
            vehicle_make,
            vehicle_model,
            vehicle_trim,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            customer_name = VALUES(customer_name),
            customer_email = VALUES(customer_email),
            total_price = VALUES(total_price),
            financial_status = VALUES(financial_status),
            fulfillment_status = VALUES(fulfillment_status),
            tags = VALUES(tags),
            vehicle_year = VALUES(vehicle_year),
            vehicle_make = VALUES(vehicle_make),
            vehicle_model = VALUES(vehicle_model),
            vehicle_trim = VALUES(vehicle_trim),
            updated_at = NOW()`,
          [
            shopId,
            order.id,
            order.name,
            customerName,
            order.customer?.email || null,
            parseFloat(order.total_price) || 0,
            order.financial_status || 'pending',
            order.fulfillment_status || null,
            order.tags || null,
            vehicleInfo.year,
            vehicleInfo.make,
            vehicleInfo.model,
            vehicleInfo.trim,
            order.created_at
          ]
        );

        syncedCount++;
      } catch (dbError) {
        console.error(`⚠️ Failed to sync order ${order.name}:`, dbError.message);
      }
    }

    console.log(`✅ Synced ${syncedCount} orders from Shopify`);
    console.log(`🚗 Extracted vehicle info from ${vehicleExtractedCount} orders`);

    res.json({
      success: true,
      message: `Successfully synced ${syncedCount} orders from Shopify (${vehicleExtractedCount} with vehicle info)`,
      synced: syncedCount,
      total: allOrders.length,
      vehicleExtracted: vehicleExtractedCount
    });

  } catch (error) {
    console.error('❌ Error syncing orders:', error);
    res.status(500).json({
      error: 'Failed to sync orders',
      message: error.message
    });
  }
});

/**
 * Get full order details from Shopify including line items
 */
router.get('/:shopifyOrderId/details', verifyShopInstalled, async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { shopifyOrderId } = req.params;

    console.log(`📋 Fetching order details for ${shopifyOrderId}...`);

    // Get shop ID and access token
    const [rows] = await db.execute(
      'SELECT id, access_token FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0 || !rows[0].access_token) {
      return res.status(404).json({
        error: 'Shop not found or not authenticated'
      });
    }

    const accessToken = rows[0].access_token;
    const shopId = rows[0].id;

    // Fetch full order details from Shopify using REST API
    const client = new shopify.clients.Rest({
      session: {
        shop,
        accessToken
      }
    });

    const response = await client.get({
      path: `orders/${shopifyOrderId}`
    });

    const order = response.body.order;

    console.log(`✅ Retrieved order ${order.name} with ${order.line_items?.length || 0} items`);

    // Fetch product tags for each line item
    if (order.line_items && order.line_items.length > 0) {
      for (const item of order.line_items) {
        if (item.product_id) {
          try {
            const productResponse = await client.get({
              path: `products/${item.product_id}`,
              query: { fields: 'tags' }
            });
            // Add tags to line item
            item.tags = productResponse.body.product.tags ? productResponse.body.product.tags.split(', ') : [];
          } catch (error) {
            console.error(`Error fetching tags for product ${item.product_id}:`, error.message);
            item.tags = [];
          }
        }
      }
    }

    // Fetch vehicle info from database
    const [dbOrders] = await db.execute(
      `SELECT vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_info_notes
       FROM orders
       WHERE shopify_order_id = ? AND shop_id = ?`,
      [shopifyOrderId, shopId]
    );

    // Merge vehicle info from database into order object
    if (dbOrders.length > 0) {
      order.vehicle_year = dbOrders[0].vehicle_year;
      order.vehicle_make = dbOrders[0].vehicle_make;
      order.vehicle_model = dbOrders[0].vehicle_model;
      order.vehicle_trim = dbOrders[0].vehicle_trim;
      order.vehicle_info_notes = dbOrders[0].vehicle_info_notes;
    }

    res.json({
      success: true,
      order: order
    });

  } catch (error) {
    console.error('❌ Error fetching order details:', error);
    res.status(500).json({
      error: 'Failed to fetch order details',
      message: error.message
    });
  }
});

/**
 * Update vehicle information for an order
 */
router.patch('/:orderId/vehicle', verifyShopInstalled, async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { orderId } = req.params;
    const { vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_info_notes } = req.body;

    console.log(`🚗 Updating vehicle info for order ${orderId}...`);

    // Get shop ID
    const [rows] = await db.execute(
      'SELECT id FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = rows[0].id;

    // Update vehicle info in database
    await db.execute(
      `UPDATE orders
       SET vehicle_year = ?,
           vehicle_make = ?,
           vehicle_model = ?,
           vehicle_trim = ?,
           vehicle_info_notes = ?,
           updated_at = NOW()
       WHERE id = ? AND shop_id = ?`,
      [
        vehicle_year || null,
        vehicle_make || null,
        vehicle_model || null,
        vehicle_trim || null,
        vehicle_info_notes || null,
        orderId,
        shopId
      ]
    );

    console.log(`✅ Updated vehicle info for order ${orderId}`);

    res.json({
      success: true,
      message: 'Vehicle information updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating vehicle info:', error);
    res.status(500).json({
      error: 'Failed to update vehicle information',
      message: error.message
    });
  }
});

/**
 * Get single order by Shopify order ID
 */
router.get('/:orderId', verifyShopInstalled, async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { orderId } = req.params;

    console.log(`📦 Fetching order ${orderId} for ${shop}...`);

    // Get access token
    const [rows] = await db.execute(
      'SELECT id, access_token FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0 || !rows[0].access_token) {
      return res.status(404).json({ error: 'Shop not found or not authenticated' });
    }

    const shopId = rows[0].id;
    const accessToken = rows[0].access_token;

    // Create Shopify REST client
    const client = new shopify.clients.Rest({
      session: { shop, accessToken }
    });

    // Fetch specific order from Shopify
    const response = await client.get({
      path: `orders/${orderId}`
    });

    console.log(`✅ Retrieved order ${orderId}`);

    // Also get line items from database if available
    const [items] = await db.execute(
      'SELECT * FROM order_items WHERE shopify_order_id = ? AND shop_id = ?',
      [orderId, shopId]
    );

    res.json({
      success: true,
      order: response.body.order,
      items: items
    });

  } catch (error) {
    console.error('❌ Error fetching order:', error);
    res.status(500).json({
      error: 'Failed to fetch order',
      message: error.message
    });
  }
});

/**
 * Process order on SDW
 * Triggers the Python SDW automation script with pre-configured options
 */
/**
 * Background function to process SDW order
 */
async function processSDWInBackground(jobId, config) {
  const { getJob, updateJobProgress } = await import('../services/sdwJobManager.js');
  const job = getJob(jobId);

  try {
    job.setProcessing('calculate');
    updateJobProgress(jobId, 'Launching browser automation...', 'launching_browser');

    const pythonScript = path.join(__dirname, '../../workers/sdw_processor.py');
    const args = [
      '--order-number', config.orderNumber,
      '--card', config.card,
      '--mode', config.mode,
      '--job-id', jobId
    ];

    if (config.vehicleString) {
      args.push('--vehicle', config.vehicleString);
    }

    if (config.mode === 'quote' && config.quoteLink) {
      args.push('--quote-link', config.quoteLink);
    }

    if (config.selectedLineItems.length > 0) {
      args.push('--selected-items', JSON.stringify(config.selectedLineItems));
    }

    console.log(`🐍 Spawning Python for job ${jobId}`);

    // Use -u flag for unbuffered Python output (real-time logs)
    const pythonProcess = spawn('python3', ['-u', pythonScript, ...args], {
      cwd: path.join(__dirname, '../../workers')
    });

    // Store process reference for cancellation
    job.pythonProcess = pythonProcess;

    // Capture output and update progress
    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString().trim();
      console.log(`[Job ${jobId}] ${text}`);

      // Split by newlines and process each line (stdout can receive multiple lines at once)
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      for (const line of lines) {
        // Check for interactive prompt events first
        if (line.startsWith('[JOB_EVENT]')) {
          try {
            const jsonStr = line.substring('[JOB_EVENT]'.length).trim();
            const event = JSON.parse(jsonStr);

            if (event.event === 'user_input_required') {
              console.log(`🔔 User input required for job ${jobId}: ${event.prompt_type}`);
              job.setAwaitingUserInput(event.prompt_type, event.prompt_data);
              updateJobProgress(jobId, 'Waiting for user input...', 'awaiting_user_input');
            }
          } catch (e) {
            console.error(`❌ Failed to parse JOB_EVENT: ${e.message}`);
          }
        }
        // Parse output for progress updates based on actual Python script output
        else if (line.includes('Fetching order')) {
          updateJobProgress(jobId, 'Fetching order from Shopify...', 'fetching_order');
        } else if (line.includes('Initializing browser')) {
          updateJobProgress(jobId, 'Launching browser automation...', 'launching_browser');
        } else if (line.includes('Logging into SDW')) {
          updateJobProgress(jobId, 'Logging into SDW...', 'logging_in');
        } else if (line.includes('Extracting vehicle')) {
          updateJobProgress(jobId, 'Extracting vehicle information...', 'extracting_vehicle');
        } else if (line.includes('Found') && line.includes('item(s) to process')) {
          updateJobProgress(jobId, line, 'items_found');
        } else if (line.includes('Processing:')) {
          updateJobProgress(jobId, line, 'processing_item');
        } else if (line.includes('Successfully added') && line.includes('to cart')) {
          updateJobProgress(jobId, 'Items added to cart successfully', 'cart_updated');
        } else if (line.includes('Proceeding to checkout')) {
          updateJobProgress(jobId, 'Proceeding to checkout...', 'checkout');
        } else if (line.includes('Filling payment')) {
          updateJobProgress(jobId, 'Filling payment information...', 'payment');
        } else if (line.includes('Waiting for shipping')) {
          updateJobProgress(jobId, 'Calculating shipping cost...', 'calculating_shipping');
        } else if (line.startsWith('ITEMS_TO_PROCESS_JSON:')) {
          // Parse items being processed
          try {
            const jsonStr = line.substring('ITEMS_TO_PROCESS_JSON:'.length);
            const items = JSON.parse(jsonStr);
            job.orderItems = items;
            console.log(`📦 Stored ${items.length} order items in job state`);
          } catch (e) {
            console.error(`❌ Failed to parse ITEMS_TO_PROCESS_JSON: ${e.message}`);
          }
        } else if (line.startsWith('ORDER_SUMMARY_JSON:')) {
          // Parse order summary
          try {
            const jsonStr = line.substring('ORDER_SUMMARY_JSON:'.length);
            const summary = JSON.parse(jsonStr);
            job.orderSummary = summary;
            console.log(`📋 Stored order summary in job state`);
          } catch (e) {
            console.error(`❌ Failed to parse ORDER_SUMMARY_JSON: ${e.message}`);
          }
        } else if (line.startsWith('ORDER_COMPLETE_JSON:')) {
          // Parse completion data
          try {
            const jsonStr = line.substring('ORDER_COMPLETE_JSON:'.length);
            const completionData = JSON.parse(jsonStr);
            job.completionData = completionData;
            job.setCompleted();
            console.log(`✅ Order completed with invoice: ${completionData.invoice_number}`);
          } catch (e) {
            console.error(`❌ Failed to parse ORDER_COMPLETE_JSON: ${e.message}`);
          }
        } else if (line.startsWith('ORDER_FAILED_JSON:')) {
          // Parse failure data
          try {
            const jsonStr = line.substring('ORDER_FAILED_JSON:'.length);
            const failureData = JSON.parse(jsonStr);
            job.failureData = failureData;
            job.setFailed(failureData.error_message);
            console.log(`❌ Order failed: ${failureData.error_message}`);
          } catch (e) {
            console.error(`❌ Failed to parse ORDER_FAILED_JSON: ${e.message}`);
          }
        } else if (line.startsWith('SHIPPING_CALCULATED:')) {
          // Parse shipping info: SHIPPING_CALCULATED:45.99:345.99 (legacy format)
          const parts = line.split(':');
          if (parts.length === 3) {
            const shippingCost = parseFloat(parts[1]);
            const totalPrice = parseFloat(parts[2]);
            console.log(`💰 Parsed shipping: $${shippingCost}, total: $${totalPrice}`);
            job.setCalculateComplete(totalPrice, shippingCost);
            console.log(`✅ Job ${jobId} status set to: ${job.status}`);
          }
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString().trim();
      console.error(`[Job ${jobId} Error] ${text}`);
      updateJobProgress(jobId, `Error: ${text}`, 'error');
    });

    pythonProcess.on('close', (code) => {
      // Don't mark as failed if job was cancelled by user or is awaiting confirmation
      if (code !== 0 && job.status !== 'awaiting_confirmation' && job.status !== 'cancelled') {
        job.setFailed(`Process exited with code ${code}`);
      }
      console.log(`✅ Job ${jobId} Python process exited with code ${code}`);
    });

  } catch (error) {
    console.error(`❌ Error in background processing for job ${jobId}:`, error);
    job.setFailed(error.message);
  }
}

/**
 * Start SDW processing (Phase 1: Calculate shipping/total)
 * Returns a job ID for tracking progress
 */
router.post('/process-sdw/start', verifyShopInstalled, async (req, res) => {
  try {
    const {
      orderNumber,
      shopifyOrderId,
      selectedLineItems,
      vehicle,
      card,
      mode,
      quoteLink
    } = req.body;

    // Validate required fields
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }

    if (selectedLineItems.length === 0) {
      return res.status(400).json({ error: 'No items selected' });
    }

    // Validate card selection (whitelist to prevent command injection)
    const VALID_CARDS = ['1', '2', '3', '4', '5'];
    if (!VALID_CARDS.includes(card)) {
      return res.status(400).json({ error: 'Invalid card selection' });
    }

    // Validate mode (whitelist to prevent command injection)
    const VALID_MODES = ['manual', 'quote'];
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: 'Invalid processing mode' });
    }

    // Sanitize order number (allow only alphanumeric and common order characters)
    if (!/^[A-Z0-9#-]+$/i.test(orderNumber)) {
      return res.status(400).json({ error: 'Invalid order number format' });
    }

    // Validate quote link domain if provided
    if (mode === 'quote') {
      if (!quoteLink) {
        return res.status(400).json({ error: 'Quote link is required for quote mode' });
      }
      if (!quoteLink.startsWith('https://www.sdwheelwholesale.com/')) {
        return res.status(400).json({ error: 'Invalid quote link domain. Must be from sdwheelwholesale.com' });
      }
    }

    // Create job
    const { createJob, updateJobProgress } = await import('../services/sdwJobManager.js');
    const job = createJob(orderNumber.replace('#', ''));

    // Build vehicle string
    const vehicleParts = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean);
    const vehicleString = vehicleParts.join(' ');

    console.log(`🚀 Starting SDW job ${job.jobId} for order ${orderNumber}`);
    updateJobProgress(job.jobId, `Starting SDW processing for order ${orderNumber}`, 'initializing');

    // Return job ID immediately
    res.json({
      success: true,
      jobId: job.jobId,
      message: 'SDW processing started. Poll /api/orders/sdw-job/{jobId} for progress.',
      orderNumber
    });

    // Start processing in background
    processSDWInBackground(job.jobId, {
      orderNumber: orderNumber.replace('#', ''),
      selectedLineItems,
      vehicleString,
      card,
      mode,
      quoteLink
    });

  } catch (error) {
    console.error('❌ Error starting SDW processing:', error);
    res.status(500).json({
      error: 'Failed to start SDW processing',
      message: error.message
    });
  }
});

/**
 * Get SDW job status and progress
 */
router.get('/sdw-job/:jobId', verifyShopInstalled, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { getJob } = await import('../services/sdwJobManager.js');
    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const status = job.getStatus();
    // Only log when status changes to something important
    if (status.status === 'awaiting_confirmation' || status.status === 'completed' || status.status === 'failed') {
      console.log(`📊 Job ${jobId} status: ${status.status}`);
    }
    res.json(status);

  } catch (error) {
    console.error('❌ Error fetching job status:', error);
    res.status(500).json({
      error: 'Failed to fetch job status',
      message: error.message
    });
  }
});

/**
 * Confirm and complete SDW purchase (Phase 2)
 */
router.post('/sdw-job/:jobId/confirm', verifyShopInstalled, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { getJob, updateJobProgress } = await import('../services/sdwJobManager.js');
    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'awaiting_confirmation') {
      return res.status(400).json({
        error: 'Job is not awaiting confirmation',
        currentStatus: job.status
      });
    }

    console.log(`✅ User confirmed purchase for job ${jobId}`);
    updateJobProgress(jobId, 'User confirmed. Completing purchase...', 'completing');

    job.setProcessing('purchase');

    // Create signal file for Python process to read
    const fs = await import('fs').then(m => m.promises);
    const signalDir = '/tmp/sdw_signals';

    try {
      await fs.mkdir(signalDir, { recursive: true });

      // Extract order number from job
      const orderNumber = job.orderNumber;
      const confirmFile = `${signalDir}/confirm_${orderNumber}.txt`;

      await fs.writeFile(confirmFile, 'CONFIRMED');
      console.log(`📝 Created signal file: ${confirmFile}`);

    } catch (err) {
      console.error('❌ Error creating signal file:', err);
    }

    res.json({
      success: true,
      message: 'Purchase confirmation received. Completing order...'
    });

  } catch (error) {
    console.error('❌ Error confirming SDW purchase:', error);
    res.status(500).json({
      error: 'Failed to confirm purchase',
      message: error.message
    });
  }
});

/**
 * Submit user input response for interactive prompts
 */
router.post('/sdw-job/:jobId/user-input', verifyShopInstalled, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { response } = req.body;

    // Validate jobId format to prevent path traversal (only allow alphanumeric, dash, underscore)
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const { getJob } = await import('../services/sdwJobManager.js');
    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'awaiting_user_input') {
      return res.status(400).json({
        error: 'Job is not awaiting user input',
        currentStatus: job.status
      });
    }

    console.log(`💬 User input received for job ${jobId}:`, response);

    // Write response file for Python to read
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    const promptDir = path.join(__dirname, '../../workers/job_prompts');

    try {
      await fs.mkdir(promptDir, { recursive: true });
      const responseFile = path.join(promptDir, `${jobId}_response.json`);
      await fs.writeFile(responseFile, JSON.stringify(response, null, 2));

      // Clear the prompt from job state
      job.clearUserInputPrompt();

      res.json({
        success: true,
        message: 'User response received. Resuming processing...'
      });

    } catch (err) {
      res.status(500).json({
        error: 'Failed to save response',
        message: err.message
      });
    }

  } catch (error) {
    console.error('❌ Error handling user input:', error);
    res.status(500).json({
      error: 'Failed to process user input',
      message: error.message
    });
  }
});

// Cancel SDW job processing
router.post('/sdw-job/:jobId/cancel', verifyShopInstalled, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { getJob } = await import('../services/sdwJobManager.js');
    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `Job ${jobId} does not exist`
      });
    }

    // Cancel the job
    job.cancel();

    console.log(`❌ Job ${jobId} cancelled by user`);

    res.json({
      success: true,
      message: 'Job cancelled successfully',
      status: job.getStatus()
    });

  } catch (error) {
    console.error('❌ Error cancelling job:', error);
    res.status(500).json({
      error: 'Failed to cancel job',
      message: error.message
    });
  }
});

export default router;
