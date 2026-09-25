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
    
    // Migrate old SoukEnLigne branding to Baron Technology
    await db.query("UPDATE settings SET value = 'Baron Technology' WHERE key = 'store_name' AND value = 'SoukEnLigne'");
    await db.query("UPDATE settings SET value = 'Votre satisfaction est notre priorité' WHERE key = 'store_tagline' AND value LIKE '%march%Tchad%'");
    await db.query("UPDATE settings SET value = 'Baron Technology — Votre satisfaction est notre priorité. Achetez en ligne, payez à la livraison.' WHERE key = 'store_description' AND value LIKE '%SoukEnLigne%'");
    await db.query("UPDATE settings SET value = '23566731494' WHERE key = 'whatsapp_number' AND value = '23566000000'");
    await db.query("UPDATE settings SET value = '+235 66 73 14 94' WHERE key = 'store_phone' AND value LIKE '%66 00 00 00%'");
    await db.query("UPDATE settings SET value = 'barontechnologyltd@gmail.com' WHERE key = 'store_email' AND value LIKE '%soukenligne%'");
    await db.query("UPDATE settings SET value = 'Dinguessou, Autour du rond point Pence' WHERE key = 'store_address' AND value LIKE '%Djam%'");
    await db.query("UPDATE settings SET value = 'Baron Technology — Votre satisfaction est notre priorité' WHERE key = 'meta_title' AND value LIKE '%SoukEnLigne%'");
    await db.query("UPDATE settings SET value = 'Baron Technology est votre boutique en ligne au Tchad. Découvrez nos produits, commandez en ligne et payez à la livraison.' WHERE key = 'meta_description' AND value LIKE '%SoukEnLigne%'");

    const productCountRes = await db.query('SELECT COUNT(*) as c FROM products');
    if (parseInt(productCountRes.rows[0].c) === 0) {
      const { runSeed } = require('./db/seed');
      await runSeed();
    }
  } catch (err) {
    console.error('Error checking seed data or altering tables:', err);
  }

  app.listen(PORT, () => {
    console.log(`\n🛒 Baron Technology est en ligne !`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Admin: http://localhost:${PORT}/admin`);
    console.log(`   → Email: admin@barontechnology.td`);
    console.log(`   → Mot de passe: admin123\n`);
  });
}

start().catch(err => {
  console.error('Erreur de démarrage:', err);
  process.exit(1);
});
