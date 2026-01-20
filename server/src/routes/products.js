import express from 'express';
import { verifyShopInstalled } from '../middleware/auth.js';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get all products with pagination
 */
router.get('/', verifyShopInstalled, async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { page = 1, limit = 50, search } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM products WHERE shop_id = ?';
    const params = [shopId];

    if (search) {
      query += ' AND (title LIKE ? OR vendor LIKE ? OR product_type LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [products] = await db.execute(query, params);

    res.json({
      products
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

export default router;
