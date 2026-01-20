import express from 'express';
import { shopify } from '../config/shopify.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get all orders - Fetch from Shopify and sync to database
 */
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';
    const limit = parseInt(req.query.limit) || 250;

    console.log(`📦 Fetching orders for ${shop}...`);

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

    // Fetch orders from Shopify
    const response = await client.get({
      path: 'orders',
      query: {
        limit: limit,
        status: 'any',
        fields: 'id,name,created_at,updated_at,customer,total_price,financial_status,fulfillment_status,line_items,tags,note'
      }
    });

    const orders = response.body.orders || [];

    console.log(`✅ Retrieved ${orders.length} orders from Shopify`);

    // Sync orders to database for caching
    for (const order of orders) {
      try {
        const customerName = order.customer?.default_address?.name ||
                            (order.customer?.first_name && order.customer?.last_name
                              ? `${order.customer.first_name} ${order.customer.last_name}`
                              : 'Guest');

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
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            customer_name = VALUES(customer_name),
            customer_email = VALUES(customer_email),
            total_price = VALUES(total_price),
            financial_status = VALUES(financial_status),
            fulfillment_status = VALUES(fulfillment_status),
            tags = VALUES(tags),
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
            order.created_at
          ]
        );
      } catch (dbError) {
        console.error(`⚠️ Failed to sync order ${order.name}:`, dbError.message);
      }
    }

    res.json({
      success: true,
      count: orders.length,
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

export default router;
