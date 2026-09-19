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

// Session (in-memory store — fine for single-server deployment)
app.use(session({
  secret: process.env.SESSION_SECRET || 'soukenligne-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: false
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

// Initialize database then start server
async function start() {
  await initDatabase();

  // Seed if empty
  const db = getDb();
  try {
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_seen_cancellation BOOLEAN DEFAULT false');
    
    const productCountRes = await db.query('SELECT COUNT(*) as c FROM products');
    if (parseInt(productCountRes.rows[0].c) === 0) {
      const { runSeed } = require('./db/seed');
      await runSeed();
    }
  } catch (err) {
    console.error('Error checking seed data or altering tables:', err);
  }

  app.listen(PORT, () => {
    console.log(`\n🛒 SoukEnLigne est en ligne !`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Admin: http://localhost:${PORT}/admin`);
    console.log(`   → Email: admin@soukenligne.td`);
    console.log(`   → Mot de passe: admin123\n`);
  });
}

start().catch(err => {
  console.error('Erreur de démarrage:', err);
  process.exit(1);
});
