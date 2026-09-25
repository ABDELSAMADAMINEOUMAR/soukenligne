const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

let pool;

async function initDatabase() {
  if (pool) return pool;

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Please set it in your environment variables.');
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  await initTables();
  return pool;
}

function getDb() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

async function initTables() {
  const db = getDb();

  // Create tables using PostgreSQL syntax
  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image TEXT,
      parent_id INTEGER REFERENCES categories(id),
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS delivery_zones (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      fee INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      short_description TEXT,
      price INTEGER NOT NULL,
      discount_price INTEGER,
      category_id INTEGER REFERENCES categories(id),
      brand TEXT,
      sku TEXT,
      stock_quantity INTEGER DEFAULT 0,
      is_available BOOLEAN DEFAULT true,
      is_featured BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'active',
      meta_title TEXT,
      meta_description TEXT,
      og_image TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER DEFAULT 0,
      is_primary BOOLEAN DEFAULT false
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      whatsapp TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'customer',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS addresses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT,
      phone TEXT,
      city TEXT,
      neighborhood TEXT,
      address_line TEXT,
      landmark TEXT,
      notes TEXT,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id),
      subtotal INTEGER NOT NULL,
      delivery_fee INTEGER DEFAULT 0,
      total INTEGER NOT NULL,
      payment_method TEXT DEFAULT 'cash_on_delivery',
      status TEXT DEFAULT 'pending',
      delivery_full_name TEXT,
      delivery_phone TEXT,
      delivery_city TEXT,
      delivery_neighborhood TEXT,
      delivery_address TEXT,
      delivery_landmark TEXT,
      delivery_notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      product_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)',
    'CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)',
    'CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)',
    'CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number)',
    'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)'
  ];

  for (const idx of indexes) {
    await db.query(idx);
  }

  // Default settings
  const defaultSettings = {
    store_name: 'Baron Technology',
    store_tagline: 'Votre satisfaction est notre priorité',
    store_description: 'Baron Technology — Votre satisfaction est notre priorité. Achetez en ligne, payez à la livraison.',
    whatsapp_number: '23566731494',
    store_phone: '+235 66 73 14 94',
    store_email: 'barontechnologyltd@gmail.com',
    store_address: 'Dinguessou, Autour du rond point Pence',
    currency: 'FCFA',
    currency_code: 'XAF',
    default_delivery_fee: '1500',
    meta_title: 'Baron Technology — Votre satisfaction est notre priorité',
    meta_description: 'Baron Technology est votre boutique en ligne au Tchad. Découvrez nos produits, commandez en ligne et payez à la livraison.',
    facebook_url: 'https://facebook.com/barontechnologyltd',
    instagram_url: 'https://instagram.com/barontechnologyltd',
    tiktok_url: 'https://tiktok.com/@barontechnologyltd'
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }

  // Create admin user if not exists
  const adminRes = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (adminRes.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.query('INSERT INTO users (full_name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [
      'Administrateur', 'admin@barontechnology.td', '+23566731494', hash, 'admin'
    ]);
  }
}

async function getSetting(key) {
  const db = getDb();
  const res = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function getSettings() {
  const db = getDb();
  const res = await db.query('SELECT key, value FROM settings');
  const settings = {};
  for (const row of res.rows) settings[row.key] = row.value;
  return settings;
}

async function setSetting(key, value) {
  const db = getDb();
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}

module.exports = { getDb, initDatabase, getSetting, getSettings, setSetting };
