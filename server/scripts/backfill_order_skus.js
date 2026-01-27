import { shopify } from '../src/config/shopify.js';
import db from '../src/config/database.js';

/**
 * Backfill SKU data for existing orders
 * Fetches orders from Shopify and updates the database with SKU information
 */
async function backfillSKUs() {
  try {
    console.log('🔄 Starting SKU backfill for existing orders...\n');

    const shop = '2f3d7a-2.myshopify.com';

    // Get shop info and access token
    const [shops] = await db.execute(
      'SELECT id, access_token FROM shops WHERE shop_name = ?',
      [shop]
    );

    if (shops.length === 0 || !shops[0].access_token) {
      console.error('❌ Shop not found or missing access token');
      process.exit(1);
    }

    const shopId = shops[0].id;
    const accessToken = shops[0].access_token;

    // Get all orders that have line items without SKUs
    const [ordersNeedingSKU] = await db.execute(`
      SELECT DISTINCT o.shopify_order_id, o.order_number, o.created_at
      FROM orders o
      INNER JOIN order_items oi ON o.shopify_order_id = oi.shopify_order_id
      WHERE oi.sku IS NULL AND o.shop_id = ?
      ORDER BY o.created_at DESC
    `, [shopId]);

    console.log(`📊 Found ${ordersNeedingSKU.length} orders with missing SKU data\n`);

    if (ordersNeedingSKU.length === 0) {
      console.log('✅ All orders already have SKU data!');
      process.exit(0);
    }

    // Create Shopify REST client
    const client = new shopify.clients.Rest({
      session: {
        shop: shop,
        accessToken: accessToken
      }
    });

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let totalSKUsUpdated = 0;

    for (const orderRecord of ordersNeedingSKU) {
      try {
        console.log(`  Processing order ${orderRecord.order_number} (${orderRecord.shopify_order_id})...`);

        // Fetch order from Shopify REST API
        const response = await client.get({
          path: `orders/${orderRecord.shopify_order_id}`
        });

        const order = response.body.order;

        if (!order || !order.line_items || order.line_items.length === 0) {
          console.log(`    ⚠️  No line items found, skipping`);
          skipped++;
          continue;
        }

        // Update each line item with SKU
        let orderUpdated = false;
        for (const item of order.line_items) {
          if (item.sku) {
            const [result] = await db.execute(
              `UPDATE order_items
               SET sku = ?
               WHERE shopify_order_id = ? AND variant_id = ? AND sku IS NULL`,
              [item.sku, orderRecord.shopify_order_id, item.variant_id]
            );

            if (result.affectedRows > 0) {
              console.log(`    ✓ Updated SKU: ${item.sku} for variant ${item.variant_id}`);
              totalSKUsUpdated++;
              orderUpdated = true;
            }
          }
        }

        if (orderUpdated) {
          updated++;
        } else {
          skipped++;
        }

        // Rate limit: wait 500ms between requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`    ❌ Failed to process order ${orderRecord.order_number}:`, error.message);
        errors++;
      }
    }

    console.log('\n✅ SKU backfill complete!');
    console.log(`   Orders updated: ${updated}`);
    console.log(`   Total SKUs added: ${totalSKUsUpdated}`);
    console.log(`   Orders skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);

    process.exit(0);

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

backfillSKUs();
