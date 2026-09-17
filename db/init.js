const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'soukenligne.db');

let db = null;
let sqliteReady = null;

// Wrapper to mimic better-sqlite3 API using sql.js
class PreparedStatement {
  constructor(database, sql) {
    this._db = database;
    this._sql = sql;
  }

  run(...params) {
    const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this._db.run(this._sql, flat);
    const lastId = this._db.exec("SELECT last_insert_rowid() as id");
    const changes = this._db.getRowsModified();
    if (!this._db._inTransaction) _saveDb();
    return {
      lastInsertRowid: lastId.length > 0 ? lastId[0].values[0][0] : 0,
      changes: changes
    };
  }

  get(...params) {
    const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (flat.length > 0) stmt.bind(flat);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        return row;
      }
      return undefined;
    } finally {
      if (stmt) stmt.free();
    }
  }

  all(...params) {
    const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (flat.length > 0) stmt.bind(flat);
      const rows = [];
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        rows.push(row);
      }
      return rows;
    } finally {
      if (stmt) stmt.free();
    }
  }
}

// Wrapper around sql.js Database to provide better-sqlite3-like API
class DatabaseWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    return new PreparedStatement(this._db, sql);
  }

  exec(sql) {
    this._db.run(sql);
    if (!this._db._inTransaction) _saveDb();
  }

  pragma(str) {
    try {
      this._db.run(`PRAGMA ${str}`);
    } catch (e) { /* ignore pragma errors */ }
  }

  transaction(fn) {
    return (...args) => {
      this._db._inTransaction = true;
      this._db.run("BEGIN TRANSACTION");
      try {
        const result = fn(...args);
        this._db.run("COMMIT");
        this._db._inTransaction = false;
        _saveDb();
        return result;
      } catch (e) {
        console.error('Transaction wrapper caught error:', e);
        try {
          this._db.run("ROLLBACK");
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
        this._db._inTransaction = false;
        throw e;
      }
    };
  }
}

function _saveDb() {
  if (!db) return;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = db._db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

function getDb() {
  if (db) return db;

  // sql.js must be initialized synchronously for the rest of the app.
  // We use initSqlJs cached promise approach.
  if (!sqliteReady) {
    // Synchronous initialization using the wasm file from node_modules
    const SQL = require('sql.js');

    // For synchronous startup, we'll use a blocking approach
    throw new Error('Database not initialized. Call initDatabase() first and await it.');
  }
  return db;
}

async function initDatabase() {
  if (db) return db;

  const SQL = await initSqlJs();

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  db = new DatabaseWrapper(sqlDb);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initTables();
  return db;
}

function initTables() {
  db._db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image TEXT,
      parent_id INTEGER REFERENCES categories(id),
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      is_available INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      meta_title TEXT,
      meta_description TEXT,
      og_image TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER DEFAULT 0,
      is_primary INTEGER DEFAULT 0
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      whatsapp TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'customer',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT,
      phone TEXT,
      city TEXT,
      neighborhood TEXT,
      address_line TEXT,
      landmark TEXT,
      notes TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
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
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      product_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    )
  `);
  db._db.run(`
    CREATE TABLE IF NOT EXISTS delivery_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      fee INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )
  `);

  // Indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug)",
    "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)",
    "CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured)",
    "CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)",
    "CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)",
    "CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)"
  ];
  for (const idx of indexes) {
    db._db.run(idx);
  }

  // Default settings
  const defaultSettings = {
    store_name: 'SoukEnLigne',
    store_tagline: 'Votre marché en ligne au Tchad',
    store_description: 'La première plateforme e-commerce du Tchad. Achetez en ligne, payez à la livraison.',
    whatsapp_number: '23566000000',
    store_phone: '+235 66 00 00 00',
    store_email: 'contact@soukenligne.td',
    store_address: "N'Djaména, Tchad",
    currency: 'FCFA',
    currency_code: 'XAF',
    default_delivery_fee: '1500',
    meta_title: 'SoukEnLigne — Achetez en ligne au Tchad',
    meta_description: 'SoukEnLigne est la plateforme e-commerce du Tchad. Découvrez nos produits, commandez en ligne et payez à la livraison.',
    facebook_url: '',
    instagram_url: '',
    tiktok_url: ''
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  // Create admin user if not exists
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
      'Administrateur', 'admin@soukenligne.td', '+23566000000', hash, 'admin'
    );
  }

  _saveDb();
}

function getSetting(key) {
  const d = getDb();
  const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getSettings() {
  const d = getDb();
  const rows = d.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

function setSetting(key, value) {
  const d = getDb();
  d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

module.exports = { getDb, initDatabase, getSetting, getSettings, setSetting };
