import express from 'express';
import { verifyShopInstalled } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get all orders with pagination and filtering
 */
router.get('/', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { page = 1, limit = 50, status, search } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM orders WHERE shop_id = ?';
    const params = [shopId];

    if (status) {
      query += ' AND financial_status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [orders] = await db.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE shop_id = ?';
    const countParams = [shopId];

    if (status) {
      countQuery += ' AND financial_status = ?';
      countParams.push(status);
    }

    if (search) {
      countQuery += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countResult] = await db.execute(countQuery, countParams);

    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * Get single order by ID with items
 */
router.get('/:id', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { id } = req.params;

    const [orders] = await db.execute(
      'SELECT * FROM orders WHERE id = ? AND shop_id = ?',
      [id, shopId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const [items] = await db.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [id]
    );

    res.json({
      order: orders[0],
      items
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

export default router;
