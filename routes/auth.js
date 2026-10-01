const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('../db/init');
const { requireAuth } = require('../middleware/auth');
const { validateLengths, validatePassword, invalidateOtherSessions } = require('../utils/validation');

// Google OAuth client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

const PostgresStore = require('../utils/rate-limit-store');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: new PostgresStore({ prefix: 'rl_login:' }),
  handler: (req, res) => res.render('customer/login', { pageTitle: 'Connexion', error: 'Trop de tentatives de connexion. Veuillez réessayer plus tard.' })
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: new PostgresStore({ prefix: 'rl_register:' }),
  handler: (req, res) => res.render('customer/register', { pageTitle: 'Créer un compte', error: 'Trop de tentatives de création de compte. Veuillez réessayer plus tard.', form: req.body || {} })
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: new PostgresStore({ prefix: 'rl_forgot_ip:' }),
  handler: (req, res) => res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: 'Trop de demandes depuis cette adresse. Veuillez réessayer plus tard.', success: null })
});

const forgotEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: new PostgresStore({ prefix: 'rl_forgot_email:' }),
  keyGenerator: (req) => req.body.email ? req.body.email.trim().toLowerCase() : req.ip,
  handler: (req, res) => res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: null, success: 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.' })
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  store: new PostgresStore({ prefix: 'rl_reset:' }),
  handler: (req, res) => res.status(429).send('Trop de tentatives. Veuillez réessayer plus tard.')
});

/**
 * Validates and sanitizes the returnTo URL to prevent Open Redirects.
 * Must start with exactly one forward slash, not followed by a slash or backslash.
 */
function getSafeRedirectUrl(url, defaultUrl = '/compte') {
  if (typeof url === 'string' && (url === '/' || /^\/[^\/\\]/.test(url))) {
    return url;
  }
  return defaultUrl;
}

// Login page
router.get('/connexion', (req, res) => {
  if (req.session.userId) return res.redirect(getSafeRedirectUrl(req.session.returnTo, '/compte'));
  res.render('customer/login', { pageTitle: 'Connexion', error: null });
});

router.post('/connexion', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = getDb();
    const userRes = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    const user = userRes.rows[0];
    
    if (!user) {
      return res.render('customer/login', { pageTitle: 'Connexion', error: 'Email ou mot de passe incorrect.' });
    }

    // Social-only users don't have a password
    if (!user.password_hash) {
      return res.render('customer/login', { pageTitle: 'Connexion', error: 'Email ou mot de passe incorrect.' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.render('customer/login', { pageTitle: 'Connexion', error: 'Email ou mot de passe incorrect.' });
    }

    establishSession(req, res, user, (err, redirectTo) => {
      if (err) {
        return res.render('customer/login', { pageTitle: 'Connexion', error: 'Erreur serveur.' });
      }
      res.redirect(redirectTo);
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

router.post('/inscription', registerLimiter, async (req, res) => {
  try {
    const { full_name, email, phone, whatsapp, password, password_confirm } = req.body;
    const db = getDb();

    if (!full_name || !email || !password) {
      return res.render('customer/register', {
        pageTitle: 'Créer un compte', error: 'Veuillez remplir tous les champs obligatoires.',
        form: { full_name, email, phone, whatsapp }
      });
    }

    const lengthErr = validateLengths(req.body, { full_name: 'full_name', email: 'email', phone: 'phone', whatsapp: 'whatsapp' });
    if (lengthErr) {
      return res.render('customer/register', { pageTitle: 'Créer un compte', error: lengthErr, form: { full_name, email, phone, whatsapp } });
    }

    if (password !== password_confirm) {
      return res.render('customer/register', {
        pageTitle: 'Créer un compte', error: 'Les mots de passe ne correspondent pas.',
        form: { full_name, email, phone, whatsapp }
      });
    }

    const pwdErr = validatePassword(password);
    if (pwdErr) {
      return res.render('customer/register', {
        pageTitle: 'Créer un compte', error: pwdErr,
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

    const user = { id: result.rows[0].id, role: 'customer', full_name };
    
    establishSession(req, res, user, (err, redirectTo) => {
      if (err) {
        return res.render('customer/register', { pageTitle: 'Créer un compte', error: 'Erreur serveur.', form: req.body });
      }
      res.redirect(redirectTo);
    });
  } catch (err) {
    console.error(err);
    res.render('customer/register', { pageTitle: 'Créer un compte', error: 'Erreur serveur.', form: req.body });
  }
});

// Forgot Password
router.get('/mot-de-passe-oublie', (req, res) => {
  res.render('customer/forgot-password', { pageTitle: 'Mot de passe oublié', error: null, success: null });
});

router.post('/mot-de-passe-oublie', forgotLimiter, forgotEmailLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const db = getDb();
    const userRes = await db.query("SELECT id FROM users WHERE email = $1 AND is_active = true", [email]);
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
    
    const pwdErr = validatePassword(password);
    if (pwdErr) {
      return res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: pwdErr, token });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDb();
    
    const tokenRes = await db.query('SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP', [tokenHash]);
    const resetRecord = tokenRes.rows[0];

    if (!resetRecord) {
      return res.render('customer/reset-password', { pageTitle: 'Réinitialiser le mot de passe', error: 'Le lien est invalide ou a expiré.', token });
    }

    // Admin role restriction removed to allow customer resets

    const newHash = bcrypt.hashSync(password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, resetRecord.user_id]);
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [resetRecord.user_id]);

    // Invalidate all existing sessions for this user (attacker sessions included)
    await invalidateOtherSessions(db, resetRecord.user_id, null);

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
    const client = await db.connect();
    let isCancelled = false;
    
    try {
      await client.query('BEGIN');

      // Atomic cancellation
      const updateRes = await client.query(`
        UPDATE orders 
        SET status = 'cancelled', admin_seen_cancellation = false, updated_at = CURRENT_TIMESTAMP 
        WHERE order_number = $1 AND user_id = $2 AND status = 'pending'
        RETURNING id
      `, [req.params.orderNumber, req.session.userId]);

      if (updateRes.rows.length > 0) {
        const orderId = updateRes.rows[0].id;
        const itemsRes = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
        
        for (const item of itemsRes.rows) {
          await client.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [item.quantity, item.product_id]);
        }
        isCancelled = true;
      }
      
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { console.error('Rollback failed:', e); }
      console.error(err);
      return res.redirect(`/compte`);
    } finally {
      client.release();
    }

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

    const lengthErr = validateLengths(req.body, { full_name: 'full_name', phone: 'phone', whatsapp: 'whatsapp' });
    if (lengthErr) {
      return res.redirect('/compte?error=input_too_long');
    }
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

// ============================================================
// SOCIAL AUTHENTICATION
// ============================================================

/**
 * Find an existing user by social provider ID or email, or create a new one.
 * Handles account linking when an existing email-based account matches.
 */
async function findOrCreateSocialUser({ provider, providerId, email, name, avatarUrl, emailVerified }) {
  const db = getDb();
  const providerColumn = 'google_id';

  // Step 1: Find by provider ID (fastest path for returning social users)
  const byProviderId = await db.query(`SELECT * FROM users WHERE ${providerColumn} = $1 AND is_active = true`, [providerId]);
  if (byProviderId.rows[0]) {
    return byProviderId.rows[0];
  }

  // Step 2: Find by email (account linking for existing password-based accounts)
  if (email && emailVerified) {
    const byEmail = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
    if (byEmail.rows[0]) {
      // Link the social account to the existing user
      await db.query(
        `UPDATE users SET ${providerColumn} = $1, avatar_url = COALESCE(avatar_url, $2), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [providerId, avatarUrl || null, byEmail.rows[0].id]
      );
      const updated = await db.query('SELECT * FROM users WHERE id = $1', [byEmail.rows[0].id]);
      return updated.rows[0];
    }
  }

  // Step 3: Create a new user (no password, social-only)
  const result = await db.query(
    `INSERT INTO users (full_name, email, ${providerColumn}, auth_provider, avatar_url)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name || 'Utilisateur', email, providerId, provider, avatarUrl || null]
  );
  return result.rows[0];
}

/**
 * Establish a session for the authenticated user.
 * Preserves cart data across session.regenerate().
 */
function establishSession(req, res, user, callback) {
  const cart = req.session.cart || [];
  const returnTo = getSafeRedirectUrl(req.session.returnTo, '/compte');

  req.session.regenerate((err) => {
    if (err) {
      console.error('Session regenerate error:', err);
      return callback(err);
    }
    
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.full_name;
    req.session.cart = cart; // Restore cart

    let redirectTo = returnTo;
    if (user.role === 'admin') {
      redirectTo = '/admin';
    }

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error:', saveErr);
        return callback(saveErr);
      }
      callback(null, redirectTo);
    });
  });
}

// Rate limiter for social auth initiation (prevent abuse)
const socialAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store: new PostgresStore({ prefix: 'rl_social:' }),
  handler: (req, res) => res.redirect('/compte/connexion')
});

// ============================================================
// GOOGLE OAUTH
// ============================================================

// Initiate Google OAuth flow
router.get('/auth/google', socialAuthLimiter, (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;

  const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/compte/auth/google/callback`;

  const authUrl = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state: state,
    redirect_uri: redirectUri,
    prompt: 'select_account'
  });

  res.redirect(authUrl);
});

// Google OAuth callback
router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    // CSRF: Verify state parameter
    if (!state || state !== req.session.oauthState) {
      console.error('Google OAuth: Invalid state parameter');
      return res.redirect('/compte/connexion');
    }
    delete req.session.oauthState;

    if (!code) {
      // User denied consent or error occurred
      return res.redirect('/compte/connexion');
    }

    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/compte/auth/google/callback`;

    // Exchange authorization code for tokens
    const { tokens } = await googleClient.getToken({ code, redirect_uri: redirectUri });

    // Verify the id_token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || payload.email;
    const avatarUrl = payload.picture || null;
    const emailVerified = payload.email_verified === true;

    // Find or create user
    const user = await findOrCreateSocialUser({
      provider: 'google',
      providerId: googleId,
      email,
      name,
      avatarUrl,
      emailVerified
    });

    // Establish session
    establishSession(req, res, user, (err, redirectTo) => {
      if (err) {
        return res.render('customer/login', { pageTitle: 'Connexion', error: 'Erreur serveur.' });
      }
      res.redirect(redirectTo);
    });

  } catch (err) {
    console.error('Google OAuth error:', err);
    res.render('customer/login', { pageTitle: 'Connexion', error: 'Erreur lors de la connexion avec Google. Veuillez réessayer.' });
  }
});
// Logout
router.post('/deconnexion', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
