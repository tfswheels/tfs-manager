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
            console.log(`  ✓ Found vehicle in line item properties: ${vehicleInfo}`);
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
      console.log(`  ✓ Found vehicle in order note: ${vehicleInfo}`);
    }
  }

  // 3. Try order-level note_attributes (Shopify order custom attributes)
  if (!vehicleInfo && order.note_attributes && Array.isArray(order.note_attributes)) {
    for (const attr of order.note_attributes) {
      const attrName = attr.name ? attr.name.toLowerCase() : '';
      if (attrName === 'vehicle') {
        vehicleInfo = attr.value;
        console.log(`  ✓ Found vehicle in order note_attributes: ${vehicleInfo}`);
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
 * Sync orders from Shopify to database
 */
router.post('/sync', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const requestedLimit = parseInt(req.query.limit) || 1000; // Increased default to 1000

    // Shopify API has a max limit of 250 per request, so we'll need to paginate
    const perPage = 250;
    const totalToFetch = Math.min(requestedLimit, 2000); // Cap at 2000 total

    console.log(`🔄 Syncing up to ${totalToFetch} orders from Shopify for ${shop}...`);

    // Get access token from database
    const [rows] = await db.execute(
      'SELECT id, access_token FROM shops WHERE shop_name = ?',
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

    if (!accessToken) {
      return res.status(401).json({
        error: 'No access token',
        message: 'Please reinstall the app'
      });
    }

    // Create Shopify REST client
    const client = new shopify.clients.Rest({
      session: {
        shop,
        accessToken
      }
    });

    // Fetch orders with pagination
    let allOrders = [];
    let hasMorePages = true;
    let pageInfo = null;
    let pageCount = 0;
    const maxPages = Math.ceil(totalToFetch / perPage);

    while (hasMorePages && pageCount < maxPages) {
      const queryParams = {
        limit: perPage,
        status: 'any',
        order: 'created_at DESC'
      };

      // Add page_info for pagination (if not first page)
      if (pageInfo) {
        queryParams.page_info = pageInfo;
      }

      console.log(`  📄 Fetching page ${pageCount + 1}/${maxPages}...`);

      const response = await client.get({
        path: 'orders',
        query: queryParams
      });

      const orders = response.body.orders || [];
      allOrders = allOrders.concat(orders);
      pageCount++;

      console.log(`    ✓ Retrieved ${orders.length} orders (total: ${allOrders.length})`);

      // Check if there are more pages using Link header
      // Note: Shopify REST client returns headers as plain object, not Headers object
      const linkHeader = response.headers['link'] || response.headers.link;
      console.log(`    📎 Link header:`, linkHeader ? 'Present' : 'Missing');
      if (linkHeader) {
        console.log(`       Has next? ${linkHeader.includes('rel="next"')}`);
      }

      if (linkHeader && linkHeader.includes('rel="next"')) {
        // Extract page_info from Link header
        const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
        if (nextMatch) {
          pageInfo = nextMatch[1];
        } else {
          hasMorePages = false;
        }
      } else {
        hasMorePages = false;
      }

      // Stop if we've reached the requested limit
      if (allOrders.length >= totalToFetch) {
        hasMorePages = false;
      }
    }

    // Trim to requested limit
    const orders = allOrders.slice(0, totalToFetch);
    console.log(`\n📊 Total orders fetched: ${orders.length}`);

    let syncedCount = 0;
    let vehicleExtractedCount = 0;

    // Sync orders to database
    for (const order of orders) {
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
          console.log(`  ✓ Order ${order.name}: Found vehicle - ${vehicleStr}`);
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
      total: orders.length,
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
