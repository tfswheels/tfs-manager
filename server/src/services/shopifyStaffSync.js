/**
 * Shopify Staff Sync Service
 * Syncs staff members from Shopify store to local database for ticketing system
 */

import db from '../config/database.js';
import { shopify } from '../config/shopify.js';

/**
 * Fetch all staff members from Shopify using GraphQL Admin API
 * @param {string} shop - Shop domain (e.g., '2f3d7a-2.myshopify.com')
 * @param {string} accessToken - Shop access token
 * @returns {Promise<Array>} Array of staff members
 */
export async function fetchShopifyStaff(shop, accessToken) {
  try {
    const client = new shopify.clients.Graphql({ session: { shop, accessToken } });

    const query = `
      query {
        shop {
          staffMembers(first: 250) {
            edges {
              node {
                id
                firstName
                lastName
                email
                phone
                locale
                avatar {
                  url
                }
                isShopOwner
                active
              }
            }
          }
        }
      }
    `;

    const response = await client.query({ data: query });

    if (!response.body.data || !response.body.data.shop) {
      throw new Error('Invalid response from Shopify API');
    }

    const staffMembers = response.body.data.shop.staffMembers.edges.map(edge => {
      const node = edge.node;

      // Extract numeric ID from global ID (gid://shopify/StaffMember/123456)
      const shopifyStaffId = node.id ? node.id.split('/').pop() : null;

      return {
        shopify_staff_id: shopifyStaffId,
        email: node.email,
        first_name: node.firstName || '',
        last_name: node.lastName || '',
        full_name: [node.firstName, node.lastName].filter(Boolean).join(' ') || node.email,
        phone: node.phone || null,
        locale: node.locale || 'en',
        avatar_url: node.avatar?.url || null,
        is_shop_owner: node.isShopOwner || false,
        shopify_active: node.active !== false
      };
    });

    return staffMembers;
  } catch (error) {
    console.error('❌ Error fetching Shopify staff:', error);
    throw new Error(`Failed to fetch Shopify staff: ${error.message}`);
  }
}

/**
 * Sync staff members from Shopify to database
 * @param {number} shopId - Shop ID in database
 * @param {string} shop - Shop domain
 * @param {string} accessToken - Shop access token
 * @returns {Promise<Object>} Sync results
 */
export async function syncStaffMembers(shopId, shop, accessToken) {
  try {
    console.log(`📋 Syncing staff members for shop ${shop}...`);

    // Fetch staff from Shopify
    const shopifyStaff = await fetchShopifyStaff(shop, accessToken);

    console.log(`✅ Found ${shopifyStaff.length} staff members in Shopify`);

    let added = 0;
    let updated = 0;
    let deactivated = 0;
    const errors = [];

    // Process each staff member
    for (const staff of shopifyStaff) {
      try {
        // Check if staff member exists
        const [existing] = await db.execute(
          `SELECT id, shopify_active FROM staff_users
           WHERE shop_id = ? AND shopify_staff_id = ?`,
          [shopId, staff.shopify_staff_id]
        );

        if (existing.length > 0) {
          // Update existing staff member
          await db.execute(
            `UPDATE staff_users
             SET email = ?,
                 first_name = ?,
                 last_name = ?,
                 full_name = ?,
                 phone = ?,
                 locale = ?,
                 avatar_url = ?,
                 is_shop_owner = ?,
                 shopify_active = ?,
                 is_active = ?,
                 last_synced_at = NOW(),
                 sync_error = NULL,
                 updated_at = NOW()
             WHERE id = ?`,
            [
              staff.email,
              staff.first_name,
              staff.last_name,
              staff.full_name,
              staff.phone,
              staff.locale,
              staff.avatar_url,
              staff.is_shop_owner,
              staff.shopify_active,
              staff.shopify_active, // Also update is_active based on Shopify status
              existing[0].id
            ]
          );

          updated++;
          console.log(`  ✏️  Updated: ${staff.full_name} <${staff.email}>`);
        } else {
          // Insert new staff member
          const role = staff.is_shop_owner ? 'admin' : 'agent';

          await db.execute(
            `INSERT INTO staff_users (
              shop_id,
              shopify_staff_id,
              email,
              first_name,
              last_name,
              full_name,
              phone,
              locale,
              avatar_url,
              role,
              is_shop_owner,
              shopify_active,
              is_active,
              last_synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              shopId,
              staff.shopify_staff_id,
              staff.email,
              staff.first_name,
              staff.last_name,
              staff.full_name,
              staff.phone,
              staff.locale,
              staff.avatar_url,
              role,
              staff.is_shop_owner,
              staff.shopify_active,
              staff.shopify_active
            ]
          );

          added++;
          console.log(`  ➕ Added: ${staff.full_name} <${staff.email}>`);
        }
      } catch (staffError) {
        console.error(`  ❌ Error syncing ${staff.email}:`, staffError.message);
        errors.push({
          email: staff.email,
          error: staffError.message
        });
      }
    }

    // Deactivate staff members that no longer exist in Shopify
    const shopifyStaffIds = shopifyStaff.map(s => s.shopify_staff_id);

    if (shopifyStaffIds.length > 0) {
      const placeholders = shopifyStaffIds.map(() => '?').join(',');
      const [deactivateResult] = await db.execute(
        `UPDATE staff_users
         SET is_active = FALSE,
             shopify_active = FALSE,
             updated_at = NOW()
         WHERE shop_id = ?
           AND shopify_staff_id IS NOT NULL
           AND shopify_staff_id NOT IN (${placeholders})
           AND is_active = TRUE`,
        [shopId, ...shopifyStaffIds]
      );

      deactivated = deactivateResult.affectedRows;

      if (deactivated > 0) {
        console.log(`  🔒 Deactivated ${deactivated} staff members no longer in Shopify`);
      }
    }

    const result = {
      success: true,
      total: shopifyStaff.length,
      added,
      updated,
      deactivated,
      errors: errors.length > 0 ? errors : null
    };

    console.log('\n✅ Staff sync completed!');
    console.log(`   Total in Shopify: ${result.total}`);
    console.log(`   Added: ${added}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Deactivated: ${deactivated}`);

    if (errors.length > 0) {
      console.log(`   ⚠️  Errors: ${errors.length}`);
    }

    return result;
  } catch (error) {
    console.error('❌ Staff sync failed:', error);

    // Log sync error for all staff
    await db.execute(
      `UPDATE staff_users
       SET sync_error = ?,
           updated_at = NOW()
       WHERE shop_id = ?`,
      [error.message, shopId]
    );

    throw error;
  }
}

/**
 * Get staff member by ID
 * @param {number} staffId - Staff ID
 * @returns {Promise<Object|null>} Staff member or null
 */
export async function getStaffById(staffId) {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM staff_users WHERE id = ?`,
      [staffId]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('❌ Error getting staff by ID:', error);
    return null;
  }
}

/**
 * Get all active staff members for a shop
 * @param {number} shopId - Shop ID
 * @returns {Promise<Array>} Array of staff members
 */
export async function getActiveStaff(shopId) {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM staff_users
       WHERE shop_id = ?
         AND is_active = TRUE
       ORDER BY is_shop_owner DESC, full_name ASC`,
      [shopId]
    );

    return rows;
  } catch (error) {
    console.error('❌ Error getting active staff:', error);
    return [];
  }
}

/**
 * Get staff member by Shopify Staff ID
 * @param {number} shopId - Shop ID
 * @param {string} shopifyStaffId - Shopify Staff ID
 * @returns {Promise<Object|null>} Staff member or null
 */
export async function getStaffByShopifyId(shopId, shopifyStaffId) {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM staff_users
       WHERE shop_id = ? AND shopify_staff_id = ?`,
      [shopId, shopifyStaffId]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('❌ Error getting staff by Shopify ID:', error);
    return null;
  }
}

/**
 * Get staff member by email
 * @param {number} shopId - Shop ID
 * @param {string} email - Staff email
 * @returns {Promise<Object|null>} Staff member or null
 */
export async function getStaffByEmail(shopId, email) {
  try {
    const [rows] = await db.execute(
      `SELECT * FROM staff_users
       WHERE shop_id = ? AND email = ?`,
      [shopId, email]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('❌ Error getting staff by email:', error);
    return null;
  }
}

export default {
  syncStaffMembers,
  fetchShopifyStaff,
  getStaffById,
  getActiveStaff,
  getStaffByShopifyId,
  getStaffByEmail
};
