const express = require('express');
const router = express.Router();
const { getDb, getSettings } = require('../db/init');
const { requireAuth } = require('../middleware/auth');
const crypto = require('crypto');

function generateOrderNumber() {
  const date = new Date();
  const prefix = 'SEL';
  const yr = date.getFullYear().toString().slice(-2);
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${yr}${mo}-${rand}`;
}

// Checkout page — allows guests and logged-in users
router.get('/', async (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/panier');
  
  try {
    const db = getDb();
    let user = null;
    let defaultAddr = null;
    
    if (req.session.userId) {
      const userRes = await db.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
      user = userRes.rows[0];
      const addrRes = await db.query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC LIMIT 1', [req.session.userId]);
      defaultAddr = addrRes.rows[0];
    }
    
    const zonesRes = await db.query('SELECT * FROM delivery_zones WHERE is_active = true ORDER BY fee ASC');
    const settings = await getSettings();
    const defaultFee = parseInt(settings.default_delivery_fee) || 0;

    const error = req.query.error ? 'Une erreur est survenue lors de la création de la commande. Veuillez réessayer.' : null;

    res.render('checkout', {
      pageTitle: 'Passer la commande',
      user, defaultAddr, zones: zonesRes.rows, defaultFee, error
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Place order
router.post('/confirmer', async (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/panier');
  
  try {
    const db = getDb();
    const { delivery_full_name, delivery_phone, delivery_city, delivery_neighborhood, delivery_address, delivery_landmark, delivery_notes, delivery_zone_id } = req.body;

    // Calculate totals from cart
    let subtotal = 0;
    const cartItems = [];
    for (const item of req.session.cart) {
      const productRes = await db.query('SELECT * FROM products WHERE id = $1 AND status = $2 AND is_available = true', [item.product_id, 'active']);
      const product = productRes.rows[0];
      if (!product) continue;
      const price = product.discount_price || product.price;
      const qty = Math.min(item.quantity, product.stock_quantity);
      if (qty <= 0) continue;
      subtotal += price * qty;
      cartItems.push({ product, price, quantity: qty });
    }

    if (cartItems.length === 0) return res.redirect('/panier');

    // Get delivery fee and city name from zone
    const settings = await getSettings();
    let deliveryFee = parseInt(settings.default_delivery_fee) || 0;
    let finalCity = delivery_city || ''; // Fallback for no zones
    if (delivery_zone_id) {
      const zoneRes = await db.query('SELECT name, fee FROM delivery_zones WHERE id = $1', [parseInt(delivery_zone_id)]);
      const zone = zoneRes.rows[0];
      if (zone) {
        deliveryFee = zone.fee;
        finalCity = zone.name;
      }
    }

    const total = subtotal + deliveryFee;
    const orderNumber = generateOrderNumber();

    await db.query('BEGIN');

    let finalUserId = req.session.userId;
    if (!finalUserId) {
      const guestEmail = 'guest_' + Date.now() + '@soukenligne.td';
      const guestRes = await db.query(
        "INSERT INTO users (full_name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, 'guest') RETURNING id",
        [delivery_full_name, guestEmail, delivery_phone, 'GUEST_NO_LOGIN']
      );
      finalUserId = guestRes.rows[0].id;
      req.session.userId = finalUserId;
      req.session.userRole = 'guest';
    }

    const orderRes = await db.query(`
      INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, payment_method, status,
        delivery_full_name, delivery_phone, delivery_city, delivery_neighborhood, delivery_address, delivery_landmark, delivery_notes)
      VALUES ($1, $2, $3, $4, $5, 'cash_on_delivery', 'pending', $6, $7, $8, $9, $10, $11, $12) RETURNING id
    `, [
      orderNumber, finalUserId, subtotal, deliveryFee, total,
      delivery_full_name, delivery_phone, finalCity, delivery_neighborhood,
      delivery_address, delivery_landmark || null, delivery_notes || null
    ]);
    
    const orderId = orderRes.rows[0].id;

    for (const item of cartItems) {
      await db.query(`
        INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [orderId, item.product.id, item.product.name, item.price, item.quantity, item.price * item.quantity]);
      
      await db.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2', [item.quantity, item.product.id]);
    }

    // Save address
    const addrRes = await db.query('SELECT id FROM addresses WHERE user_id = $1', [finalUserId]);
    if (addrRes.rows.length === 0) {
      await db.query(`INSERT INTO addresses (user_id, full_name, phone, city, neighborhood, address_line, landmark, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`, 
        [finalUserId, delivery_full_name, delivery_phone, finalCity, delivery_neighborhood, delivery_address, delivery_landmark || null]);
    }

    await db.query('COMMIT');
    req.session.cart = [];
    res.redirect(`/commande/confirmation/${orderNumber}`);

  } catch (err) {
    console.error('Order error:', err);
    res.redirect('/commande?error=1');
  }
});

// Order confirmation
router.get('/confirmation/:orderNumber', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const orderRes = await db.query('SELECT * FROM orders WHERE order_number = $1 AND user_id = $2', [req.params.orderNumber, req.session.userId]);
    const order = orderRes.rows[0];
    if (!order) return res.redirect('/compte');
    
    const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    
    res.render('order-confirmation', {
      pageTitle: 'Commande confirmée',
      order, items: itemsRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
