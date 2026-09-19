const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// View cart
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const zonesRes = await db.query('SELECT * FROM delivery_zones WHERE is_active = true ORDER BY fee ASC');
    res.render('cart', { zones: zonesRes.rows, pageTitle: 'Mon panier' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Add to cart
router.post('/ajouter', (req, res) => {
  const { product_id, quantity } = req.body;
  const qty = Math.max(1, parseInt(quantity) || 1);
  
  if (!req.session.cart) req.session.cart = [];
  
  const existing = req.session.cart.find(i => i.product_id === parseInt(product_id));
  if (existing) {
    existing.quantity += qty;
  } else {
    req.session.cart.push({ product_id: parseInt(product_id), quantity: qty });
  }

  if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.query.ajax) {
    const count = req.session.cart.reduce((s, i) => s + i.quantity, 0);
    return res.json({ success: true, cartCount: count });
  }
  res.redirect(req.headers.referer || '/panier');
});

// Update quantity
router.post('/modifier', (req, res) => {
  const { product_id, quantity } = req.body;
  const qty = Math.max(0, parseInt(quantity) || 0);
  
  if (!req.session.cart) req.session.cart = [];
  
  if (qty <= 0) {
    req.session.cart = req.session.cart.filter(i => i.product_id !== parseInt(product_id));
  } else {
    const existing = req.session.cart.find(i => i.product_id === parseInt(product_id));
    if (existing) existing.quantity = qty;
  }

  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    const count = req.session.cart.reduce((s, i) => s + i.quantity, 0);
    return res.json({ success: true, cartCount: count });
  }
  res.redirect('/panier');
});

// Remove item
router.post('/supprimer', (req, res) => {
  const { product_id } = req.body;
  if (!req.session.cart) req.session.cart = [];
  req.session.cart = req.session.cart.filter(i => i.product_id !== parseInt(product_id));
  
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    const count = req.session.cart.reduce((s, i) => s + i.quantity, 0);
    return res.json({ success: true, cartCount: count });
  }
  res.redirect('/panier');
});

module.exports = router;
