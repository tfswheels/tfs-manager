import express from 'express';
import { shopify } from '../config/shopify.js';
import db from '../config/database.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
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
    let query = `
      SELECT
        id,
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
        vehicle_info_notes,
        created_at,
        updated_at
      FROM orders
      WHERE shop_id = ?
    `;

    const params = [shopId];

    // Add search filter
    if (search.trim()) {
      query += ` AND (
        order_number LIKE ? OR
        customer_name LIKE ? OR
        customer_email LIKE ?
      )`;
      const searchPattern = `%${search.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Add ordering and pagination
    // Note: LIMIT and OFFSET are safe to insert directly since they're validated integers
    const offset = (page - 1) * limit;
    query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    // Fetch orders from database
    const [orders] = await db.execute(query, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE shop_id = ?';
    const countParams = [shopId];

    if (search.trim()) {
      countQuery += ` AND (
        order_number LIKE ? OR
        customer_name LIKE ? OR
        customer_email LIKE ?
      )`;
      const searchPattern = `%${search.trim()}%`;
      countParams.push(searchPattern, searchPattern, searchPattern);
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
router.post('/sync', async (req, res) => {
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
router.get('/:shopifyOrderId/details', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const { shopifyOrderId } = req.params;

    console.log(`📋 Fetching order details for ${shopifyOrderId}...`);

    // Get access token
    const [rows] = await db.execute(
      'SELECT access_token FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (rows.length === 0 || !rows[0].access_token) {
      return res.status(404).json({
        error: 'Shop not found or not authenticated'
      });
    }

    const accessToken = rows[0].access_token;

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
router.patch('/:orderId/vehicle', async (req, res) => {
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
router.get('/:orderId', async (req, res) => {
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
router.post('/process-sdw', async (req, res) => {
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

    console.log(`🚀 Starting SDW processing for order ${orderNumber}...`);
    console.log(`   Selected items: ${selectedLineItems.length}`);
    console.log(`   Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`);
    console.log(`   Card: ${card}, Mode: ${mode}`);

    // Build vehicle string
    const vehicleParts = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean);
    const vehicleString = vehicleParts.join(' ');

    // Validate
    if (!orderNumber) {
      return res.status(400).json({
        error: 'Order number is required'
      });
    }

    if (selectedLineItems.length === 0) {
      return res.status(400).json({
        error: 'No items selected'
      });
    }

    if (mode === 'quote' && !quoteLink) {
      return res.status(400).json({
        error: 'Quote link is required for quote mode'
      });
    }

    // Spawn Python subprocess to run SDW automation
    const pythonScript = path.join(__dirname, '../../workers/sdw_processor.py');

    const args = [
      '--order-number', orderNumber.replace('#', ''),
      '--card', card,
      '--mode', mode
    ];

    if (vehicleString) {
      args.push('--vehicle', vehicleString);
    }

    if (mode === 'quote' && quoteLink) {
      args.push('--quote-link', quoteLink);
    }

    if (selectedLineItems.length > 0) {
      args.push('--selected-items', JSON.stringify(selectedLineItems));
    }

    console.log(`🐍 Spawning Python subprocess...`);
    console.log(`   Script: ${pythonScript}`);
    console.log(`   Args: ${JSON.stringify(args)}`);

    const pythonProcess = spawn('python3', [pythonScript, ...args], {
      cwd: path.join(__dirname, '../../workers')
    });

    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(`[Python] ${text.trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.error(`[Python Error] ${text.trim()}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`✅ Python process exited with code ${code}`);
    });

    // Return immediately - process runs in background
    res.json({
      success: true,
      message: `SDW processing started for order ${orderNumber}. Check server logs for progress.`,
      details: {
        orderNumber,
        itemCount: selectedLineItems.length,
        vehicle: vehicleString,
        card,
        mode,
        status: 'processing'
      },
      note: 'This is currently running a stub. Full SDW automation requires refactoring the Python script to be non-interactive.'
    });

  } catch (error) {
    console.error('❌ Error starting SDW processing:', error);
    res.status(500).json({
      error: 'Failed to start SDW processing',
      message: error.message
    });
  }
});

export default router;
