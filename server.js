const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const { initDatabase, getDb } = require('./db/init');
const { loadUser } = require('./middleware/auth');
const { loadCart } = require('./middleware/cart');
const { loadHelpers } = require('./middleware/helpers');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const crypto = require('crypto');
const helmet = require('helmet');

app.disable('x-powered-by');

let supabaseHost = '';
if (process.env.SUPABASE_URL) {
  try {
    supabaseHost = new URL(process.env.SUPABASE_URL).hostname;
  } catch (e) {
    console.error('Invalid SUPABASE_URL for CSP config');
  }
}

// Generate nonce per request
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('hex');
  next();
});

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"].concat(supabaseHost ? [`https://${supabaseHost}`] : []),
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  hsts: false, // Managed manually below
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true
}));

// Apply HSTS only for HTTPS/production
app.use((req, res, next) => {
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const pgSession = require('connect-pg-simple')(session);

if (!process.env.SESSION_SECRET) {
  console.error("FATAL ERROR: SESSION_SECRET environment variable is missing.");
  process.exit(1);
}

// Session (PostgreSQL backed for serverless persistence)
app.set('trust proxy', 1);
app.use(session({
  store: new pgSession({
    pool: getDb(),
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Initialize CSRF protection
const { csrfSync } = require('csrf-sync');
const { generateToken, csrfSynchronisedProtection } = csrfSync({
  getTokenFromRequest: (req) => {
    if (req.body && req.body._csrf) {
      return req.body._csrf;
    }
    return req.headers['x-csrf-token'];
  }
});

// Provide CSRF token to all templates
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  next();
});

// Global middleware
app.use(loadUser);
app.use(loadCart);
app.use(loadHelpers);

// Apply CSRF protection globally to all state-changing routes
app.use(csrfSynchronisedProtection);

const rateLimit = require('express-rate-limit');
const PostgresStore = require('./utils/rate-limit-store');

// Global rate limiter for state-changing actions (customer POST operations like cart, profile)
const globalPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  store: new PostgresStore({ prefix: 'rl_global_post:' }),
  handler: (req, res) => res.status(429).send('Trop de requêtes. Veuillez réessayer plus tard.')
});

app.use((req, res, next) => {
  // Apply only to general POST requests that aren't already covered by stricter route-specific limiters
  if (req.method === 'POST') {
    return globalPostLimiter(req, res, next);
  }
  next();
});

// Routes
app.use('/', require('./routes/shop'));
app.use('/panier', require('./routes/cart'));
app.use('/compte', require('./routes/auth'));
app.use('/commande', require('./routes/checkout'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { pageTitle: 'Page non trouvée' });
});

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error('Invalid CSRF token:', err);
    return res.status(403).send('Action non autorisée (CSRF invalide).');
  }
  console.error(err);
  res.status(500).send('Erreur interne du serveur');
});

// Start server if run directly (e.g. node server.js or Render deployment)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🛒 Baron Technology est en ligne !`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Admin: http://localhost:${PORT}/admin\n`);
  });
}

// Export the Express app for Vercel Serverless Functions
module.exports = app;
