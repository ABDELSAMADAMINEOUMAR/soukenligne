const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

// Login page
router.get('/connexion', (req, res) => {
  if (req.session.userId) return res.redirect(req.session.returnTo || '/compte');
  res.render('customer/login', { pageTitle: 'Connexion', error: null });
});

router.post('/connexion', (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
  
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('customer/login', { pageTitle: 'Connexion', error: 'Email ou mot de passe incorrect.' });
  }

  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.userName = user.full_name;

  let returnTo = req.session.returnTo || '/compte';
  if (user.role === 'admin') {
    returnTo = '/admin';
  }
  delete req.session.returnTo;
  res.redirect(returnTo);
});

// Register page
router.get('/inscription', (req, res) => {
  if (req.session.userId) return res.redirect('/compte');
  res.render('customer/register', { pageTitle: 'Créer un compte', error: null, form: {} });
});

router.post('/inscription', (req, res) => {
  const { full_name, email, phone, whatsapp, password, password_confirm } = req.body;
  const db = getDb();

  if (!full_name || !email || !password) {
    return res.render('customer/register', {
      pageTitle: 'Créer un compte', error: 'Veuillez remplir tous les champs obligatoires.',
      form: { full_name, email, phone, whatsapp }
    });
  }

  if (password !== password_confirm) {
    return res.render('customer/register', {
      pageTitle: 'Créer un compte', error: 'Les mots de passe ne correspondent pas.',
      form: { full_name, email, phone, whatsapp }
    });
  }

  if (password.length < 6) {
    return res.render('customer/register', {
      pageTitle: 'Créer un compte', error: 'Le mot de passe doit contenir au moins 6 caractères.',
      form: { full_name, email, phone, whatsapp }
    });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) {
    return res.render('customer/register', {
      pageTitle: 'Créer un compte', error: 'Un compte avec cet email existe déjà.',
      form: { full_name, email, phone, whatsapp }
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (full_name, email, phone, whatsapp, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(full_name, email, phone || null, whatsapp || null, hash);

  req.session.userId = result.lastInsertRowid;
  req.session.userRole = 'customer';
  req.session.userName = full_name;

  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  res.redirect(returnTo || '/compte');
});

// Account dashboard
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.session.userId);
  res.render('customer/account', { pageTitle: 'Mon compte', user, orders });
});

// Order detail
router.get('/commande/:orderNumber', requireAuth, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?').get(req.params.orderNumber, req.session.userId);
  if (!order) return res.status(404).render('404', { pageTitle: 'Commande non trouvée' });
  
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('customer/order-detail', { pageTitle: `Commande ${order.order_number}`, order, items });
});

// Cancel order
router.post('/commande/:orderNumber/annuler', requireAuth, (req, res) => {
  const db = getDb();
  
  // Verify order exists, belongs to user, and is pending
  const order = db.prepare('SELECT id, status FROM orders WHERE order_number = ? AND user_id = ?').get(req.params.orderNumber, req.session.userId);
  
  if (!order || order.status !== 'pending') {
    return res.redirect(`/compte/commande/${req.params.orderNumber}`);
  }

  const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
  const updateStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?');
  const updateOrder = db.prepare('UPDATE orders SET status = "cancelled", updated_at = datetime("now") WHERE id = ?');

  db.transaction(() => {
    updateOrder.run(order.id);
    for (const item of items) {
      updateStock.run(item.quantity, item.product_id);
    }
  })();

  res.redirect(`/compte/commande/${req.params.orderNumber}`);
});

// Edit profile
router.post('/profil', requireAuth, (req, res) => {
  const { full_name, phone, whatsapp } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET full_name = ?, phone = ?, whatsapp = ?, updated_at = datetime("now") WHERE id = ?')
    .run(full_name, phone || null, whatsapp || null, req.session.userId);
  req.session.userName = full_name;
  res.redirect('/compte#profile');
});

// Logout
router.get('/deconnexion', (req, res) => {
  const cart = req.session.cart;
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
