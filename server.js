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
    secure: true
  }
}));

// Global middleware
app.use(loadUser);
app.use(loadCart);
app.use(loadHelpers);

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
  console.error(err);
  res.status(500).send('Erreur interne du serveur');
});

// Start server if run directly (e.g. node server.js or Render deployment)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🛒 Baron Technology est en ligne !`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Admin: http://localhost:${PORT}/admin`);
    console.log(`   → Email: admin@barontechnology.td`);
    console.log(`   → Mot de passe: admin123\n`);
  });
}

// Export the Express app for Vercel Serverless Functions
module.exports = app;
