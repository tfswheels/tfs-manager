import express from 'express';
import db from '../config/database.js';

const router = express.Router();

/**
 * Get all brands from the database
 */
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop || '2f3d7a-2.myshopify.com';

    console.log(`📋 Fetching brands for ${shop}...`);

    // Query tfs-db database for brands from shopify_products table
    const [rows] = await db.execute(
      `SELECT DISTINCT vendor as brand
       FROM \`tfs-db\`.shopify_products
       WHERE vendor IS NOT NULL AND vendor != ''
       ORDER BY vendor ASC`
    );

    const brands = rows.map(row => row.brand);

    console.log(`✅ Retrieved ${brands.length} brands`);

    res.json({ brands });
  } catch (error) {
    console.error('❌ Get brands error:', error);
    res.status(500).json({ error: 'Failed to fetch brands' });
  }
});

export default router;
