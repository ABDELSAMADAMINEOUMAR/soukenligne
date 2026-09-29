const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => res.render('customer/login', { pageTitle: 'Connexion', error: 'Trop de tentatives de connexion. Veuillez réessayer plus tard.' })
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: 'Trop de demandes. Veuillez réessayer plus tard.', success: null })
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler: (req, res) => res.status(429).send('Trop de tentatives. Veuillez réessayer plus tard.')
});

// Login page
router.get('/connexion', (req, res) => {
  if (req.session.userId) return res.redirect(req.session.returnTo || '/compte');
  res.render('customer/login', { pageTitle: 'Connexion', error: null });
});

router.post('/connexion', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = getDb();
    const userRes = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = userRes.rows[0];
    
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.render('customer/login', { pageTitle: 'Connexion', error: 'Email ou mot de passe incorrect.' });
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.render('customer/login', { pageTitle: 'Connexion', error: 'Erreur serveur.' });
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
  } catch (err) {
    console.error(err);
    res.render('customer/login', { pageTitle: 'Connexion', error: 'Erreur serveur.' });
  }
});

// Register page
router.get('/inscription', (req, res) => {
  if (req.session.userId) return res.redirect('/compte');
  res.render('customer/register', { pageTitle: 'Créer un compte', error: null, form: {} });
});

router.post('/inscription', async (req, res) => {
  try {
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

    if (password.length < 12) {
      return res.render('customer/register', {
        pageTitle: 'Créer un compte', error: 'Le mot de passe doit contenir au moins 12 caractères.',
        form: { full_name, email, phone, whatsapp }
      });
    }

    const existsRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existsRes.rows.length > 0) {
      return res.render('customer/register', {
        pageTitle: 'Créer un compte', error: 'Un compte avec cet email existe déjà.',
        form: { full_name, email, phone, whatsapp }
      });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.query(
      'INSERT INTO users (full_name, email, phone, whatsapp, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [full_name, email, phone || null, whatsapp || null, hash]
    );

    req.session.userId = result.rows[0].id;
    req.session.userRole = 'customer';
    req.session.userName = full_name;

    const returnTo = req.session.returnTo;
    delete req.session.returnTo;
    res.redirect(returnTo || '/compte');
  } catch (err) {
    console.error(err);
    res.render('customer/register', { pageTitle: 'Créer un compte', error: 'Erreur serveur.', form: req.body });
  }
});

// Forgot Password
router.get('/mot-de-passe-oublie', (req, res) => {
  res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: null, success: null });
});

router.post('/mot-de-passe-oublie', forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const db = getDb();
    const userRes = await db.query("SELECT id FROM users WHERE email = $1 AND role = 'admin' AND is_active = true", [email]);
    const user = userRes.rows[0];

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate old tokens
      await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
      
      await db.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, expiresAt]
      );

      const resetLink = `${req.protocol}://${req.get('host')}/compte/reinitialiser-mot-de-passe?token=${resetToken}`;
      
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 465,
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: `"Admin Baron Technology" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Réinitialisation de mot de passe',
        text: `Cliquez sur ce lien pour réinitialiser votre mot de passe : ${resetLink}\nCe lien expirera dans une heure.`
      });
    }

    res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: null, success: 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.' });
  } catch (err) {
    console.error(err);
    res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: 'Erreur serveur.', success: null });
  }
});

// Reset Password
router.get('/reinitialiser-mot-de-passe', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/compte/connexion');
  res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: null, token });
});

router.post('/reinitialiser-mot-de-passe', resetLimiter, async (req, res) => {
  try {
    const { token, password, password_confirm } = req.body;
    
    if (password !== password_confirm) {
      return res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: 'Les mots de passe ne correspondent pas.', token });
    }
    
    if (password.length < 12) {
      return res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: 'Le mot de passe doit contenir au moins 12 caractères.', token });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDb();
    
    const tokenRes = await db.query('SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP', [tokenHash]);
    const resetRecord = tokenRes.rows[0];

    if (!resetRecord) {
      return res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: 'Le lien est invalide ou a expiré.', token });
    }

    // Verify it is an admin
    const userRes = await db.query("SELECT id FROM users WHERE id = $1 AND role = 'admin'", [resetRecord.user_id]);
    if (userRes.rows.length === 0) {
      return res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: 'Non autorisé.', token });
    }

    const newHash = bcrypt.hashSync(password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, resetRecord.user_id]);
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [resetRecord.user_id]);

    res.redirect('/compte/connexion');
  } catch (err) {
    console.error(err);
    res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: 'Erreur serveur.', token: req.body.token });
  }
});

// Account dashboard
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const ordersRes = await db.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [req.session.userId]);
    res.render('customer/account', { pageTitle: 'Mon compte', user: userRes.rows[0], orders: ordersRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Order detail
router.get('/commande/:orderNumber', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const orderRes = await db.query('SELECT * FROM orders WHERE order_number = $1 AND user_id = $2', [req.params.orderNumber, req.session.userId]);
    const order = orderRes.rows[0];
    if (!order) return res.status(404).render('404', { pageTitle: 'Commande non trouvée' });
    
    const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    res.render('customer/order-detail', { pageTitle: `Commande ${order.order_number}`, order, items: itemsRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Cancel order
router.post('/commande/:orderNumber/annuler', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    
    // Verify order exists, belongs to user, and is pending
    const orderRes = await db.query('SELECT id, status FROM orders WHERE order_number = $1 AND user_id = $2', [req.params.orderNumber, req.session.userId]);
    const order = orderRes.rows[0];
    
    if (!order || order.status !== 'pending') {
      return res.redirect(`/compte/commande/${req.params.orderNumber}`);
    }

    const itemsRes = await db.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [order.id]);
    
    await db.query('BEGIN');
    await db.query('UPDATE orders SET status = $1, admin_seen_cancellation = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['cancelled', order.id]);
    for (const item of itemsRes.rows) {
      await db.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [item.quantity, item.product_id]);
    }
    await db.query('COMMIT');

    res.redirect(`/compte/commande/${req.params.orderNumber}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/compte`);
  }
});

// Edit profile
router.post('/profil', requireAuth, async (req, res) => {
  try {
    const { full_name, phone, whatsapp } = req.body;
    const db = getDb();
    await db.query(
      'UPDATE users SET full_name = $1, phone = $2, whatsapp = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [full_name, phone || null, whatsapp || null, req.session.userId]
    );
    req.session.userName = full_name;
    res.redirect('/compte#profile');
  } catch (err) {
    console.error(err);
    res.redirect('/compte');
  }
});

// Logout
router.get('/deconnexion', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
