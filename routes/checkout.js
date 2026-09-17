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

// Checkout page — requires login
router.get('/', requireAuth, (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/panier');
  
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const defaultAddr = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC LIMIT 1').get(req.session.userId);
  const zones = db.prepare('SELECT * FROM delivery_zones WHERE is_active = 1 ORDER BY fee ASC').all();
  const settings = getSettings();
  const defaultFee = parseInt(settings.default_delivery_fee) || 0;

  const error = req.query.error ? 'Une erreur est survenue lors de la création de la commande. Veuillez réessayer.' : null;

  res.render('checkout', {
    pageTitle: 'Passer la commande',
    user, defaultAddr, zones, defaultFee, error
  });
});

// Place order
router.post('/confirmer', requireAuth, (req, res) => {
  if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/panier');
  
  const db = getDb();
  const { delivery_full_name, delivery_phone, delivery_city, delivery_neighborhood, delivery_address, delivery_landmark, delivery_notes, delivery_zone_id } = req.body;

  // Calculate totals from cart
  let subtotal = 0;
  const cartItems = [];
  for (const item of req.session.cart) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND status = "active" AND is_available = 1').get(item.product_id);
    if (!product) continue;
    const price = product.discount_price || product.price;
    const qty = Math.min(item.quantity, product.stock_quantity);
    if (qty <= 0) continue;
    subtotal += price * qty;
    cartItems.push({ product, price, quantity: qty });
  }

  if (cartItems.length === 0) return res.redirect('/panier');

  // Get delivery fee and city name from zone
  let deliveryFee = parseInt(getSettings().default_delivery_fee) || 0;
  let finalCity = delivery_city || ''; // Fallback for no zones
  if (delivery_zone_id) {
    const zone = db.prepare('SELECT name, fee FROM delivery_zones WHERE id = ?').get(parseInt(delivery_zone_id));
    if (zone) {
      deliveryFee = zone.fee;
      finalCity = zone.name;
    }
  }

  const total = subtotal + deliveryFee;
  const orderNumber = generateOrderNumber();

  const insertOrder = db.prepare(`
    INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, payment_method, status,
      delivery_full_name, delivery_phone, delivery_city, delivery_neighborhood, delivery_address, delivery_landmark, delivery_notes)
    VALUES (?, ?, ?, ?, ?, 'cash_on_delivery', 'pending', ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity, subtotal)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?');

  const transaction = db.transaction(() => {
    const result = insertOrder.run(
      orderNumber, req.session.userId, subtotal, deliveryFee, total,
      delivery_full_name, delivery_phone, finalCity, delivery_neighborhood,
      delivery_address, delivery_landmark || null, delivery_notes || null
    );
    const orderId = result.lastInsertRowid;

    for (const item of cartItems) {
      insertItem.run(orderId, item.product.id, item.product.name, item.price, item.quantity, item.price * item.quantity);
      updateStock.run(item.quantity, item.product.id);
    }

    // Save address
    const addrExists = db.prepare('SELECT id FROM addresses WHERE user_id = ?').get(req.session.userId);
    if (!addrExists) {
      db.prepare(`INSERT INTO addresses (user_id, full_name, phone, city, neighborhood, address_line, landmark, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(req.session.userId, delivery_full_name, delivery_phone, finalCity, delivery_neighborhood, delivery_address, delivery_landmark || null);
    }

    return orderNumber;
  });

  try {
    const num = transaction();
    req.session.cart = [];
    res.redirect(`/commande/confirmation/${num}`);
  } catch (err) {
    console.error('Order error:', err);
    res.redirect('/commande?error=1');
  }
});

// Order confirmation
router.get('/confirmation/:orderNumber', requireAuth, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?').get(req.params.orderNumber, req.session.userId);
  if (!order) return res.redirect('/compte');
  
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  
  res.render('order-confirmation', {
    pageTitle: 'Commande confirmée',
    order, items
  });
});

module.exports = router;
