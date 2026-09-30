const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { getDb } = require('../db/init');
const { requireAuth } = require('../middleware/auth');

// Google OAuth client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// Apple JWKS client for verifying Apple id_tokens
const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 86400000 // 24 hours
});

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
    
    if (!user) {
      return res.render('customer/login', { pageTitle: 'Connexion', error: 'Email ou mot de passe incorrect.' });
    }

    // Social-only users don't have a password
    if (!user.password_hash) {
      const provider = user.auth_provider === 'apple' ? 'Apple' : 'Google';
      return res.render('customer/login', { pageTitle: 'Connexion', error: `Ce compte utilise ${provider} pour se connecter. Utilisez le bouton "Continuer avec ${provider}" ci-dessous.` });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
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

// ============================================================
// SOCIAL AUTHENTICATION
// ============================================================

/**
 * Find an existing user by social provider ID or email, or create a new one.
 * Handles account linking when an existing email-based account matches.
 */
async function findOrCreateSocialUser({ provider, providerId, email, name, avatarUrl, emailVerified }) {
  const db = getDb();
  const providerColumn = provider === 'google' ? 'google_id' : 'apple_id';

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
  // Preserve cart before regenerating
  const cart = req.session.cart || [];
  const returnTo = req.session.returnTo;

  req.session.regenerate((err) => {
    if (err) {
      console.error('Session regenerate error:', err);
      return callback(err);
    }
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.full_name;
    req.session.cart = cart; // Restore cart

    let redirectTo = returnTo || '/compte';
    if (user.role === 'admin') {
      redirectTo = '/admin';
    }
    callback(null, redirectTo);
  });
}

// Rate limiter for social auth initiation (prevent abuse)
const socialAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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

// ============================================================
// APPLE OAUTH
// ============================================================

/**
 * Generate Apple client secret JWT.
 * Apple requires a dynamically generated JWT signed with the .p8 private key.
 */
function generateAppleClientSecret() {
  const privateKey = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_SERVICES_ID;

  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '180d',
    audience: 'https://appleid.apple.com',
    issuer: teamId,
    subject: clientId,
    keyid: keyId
  });

  return token;
}

/**
 * Verify Apple's id_token using Apple's JWKS public keys.
 */
async function verifyAppleIdToken(idToken) {
  // Decode the token header to get the key ID
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) throw new Error('Invalid Apple id_token');

  // Get the signing key from Apple's JWKS
  const key = await appleJwksClient.getSigningKey(decoded.header.kid);
  const publicKey = key.getPublicKey();

  // Verify the token
  const payload = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience: process.env.APPLE_SERVICES_ID
  });

  return payload;
}

// Initiate Apple OAuth flow
router.get('/auth/apple', socialAuthLimiter, (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  req.session.oauthNonce = nonce;

  const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/compte/auth/apple/callback`;

  const params = new URLSearchParams({
    client_id: process.env.APPLE_SERVICES_ID,
    redirect_uri: redirectUri,
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state: state,
    nonce: crypto.createHash('sha256').update(nonce).digest('hex')
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

// Apple OAuth callback (Apple sends POST with form data)
router.post('/auth/apple/callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const { code, state, id_token: idToken, user: userDataStr } = req.body;

    // CSRF: Verify state parameter
    if (!state || state !== req.session.oauthState) {
      console.error('Apple OAuth: Invalid state parameter');
      return res.redirect('/compte/connexion');
    }
    delete req.session.oauthState;

    if (!code || !idToken) {
      return res.redirect('/compte/connexion');
    }

    // Verify the id_token from Apple
    const payload = await verifyAppleIdToken(idToken);

    // Verify nonce
    const expectedNonce = crypto.createHash('sha256').update(req.session.oauthNonce || '').digest('hex');
    if (payload.nonce !== expectedNonce) {
      console.error('Apple OAuth: Invalid nonce');
      return res.redirect('/compte/connexion');
    }
    delete req.session.oauthNonce;

    const appleId = payload.sub;
    const email = payload.email || null;
    const emailVerified = payload.email_verified === 'true' || payload.email_verified === true;

    // Apple only sends user data (name) on the FIRST sign-in
    let fullName = 'Utilisateur Apple';
    if (userDataStr) {
      try {
        const userData = typeof userDataStr === 'string' ? JSON.parse(userDataStr) : userDataStr;
        if (userData.name) {
          const parts = [userData.name.firstName, userData.name.lastName].filter(Boolean);
          if (parts.length > 0) fullName = parts.join(' ');
        }
      } catch (e) {
        console.error('Error parsing Apple user data:', e);
      }
    }

    // Find or create user
    const user = await findOrCreateSocialUser({
      provider: 'apple',
      providerId: appleId,
      email,
      name: fullName,
      avatarUrl: null,
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
    console.error('Apple OAuth error:', err);
    res.render('customer/login', { pageTitle: 'Connexion', error: 'Erreur lors de la connexion avec Apple. Veuillez réessayer.' });
  }
});

// Logout
router.get('/deconnexion', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
