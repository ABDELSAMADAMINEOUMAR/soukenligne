const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const slugify = require('slugify');
const { getDb, getSettings, setSetting } = require('../db/init');
const { requireAdmin } = require('../middleware/auth');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

router.use(requireAdmin);

// Dashboard
router.get('/', (req, res) => {
  const db = getDb();
  const totalProducts = db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'active'").get().c;
  const totalOrders = db.prepare("SELECT COUNT(*) as c FROM orders").get().c;
  const totalCustomers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'customer'").get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE status IN ('confirmed','preparing','out_for_delivery','delivered')").get().t;
  
  const recentOrders = db.prepare(`
    SELECT o.*, u.full_name as customer_name
    FROM orders o LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  const topProducts = db.prepare(`
    SELECT oi.product_name, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY oi.product_name
    ORDER BY total_sold DESC LIMIT 10
  `).all();

  const lowStock = db.prepare("SELECT * FROM products WHERE stock_quantity <= 5 AND status = 'active' ORDER BY stock_quantity ASC LIMIT 10").all();

  res.render('admin/dashboard', {
    pageTitle: 'Tableau de bord', layout: 'admin',
    totalProducts, totalOrders, totalCustomers, pendingOrders, totalRevenue,
    recentOrders, topProducts, lowStock
  });
});

// PRODUCTS
router.get('/produits', (req, res) => {
  const db = getDb();
  const { categorie } = req.query;
  
  let filterClause = '';
  const params = [];
  
  if (categorie) {
    filterClause = 'WHERE p.category_id = ?';
    params.push(parseInt(categorie, 10));
  }

  const products = db.prepare(`
    SELECT p.*, c.name as category_name,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC LIMIT 1) as image
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    ${filterClause}
    ORDER BY p.created_at DESC
  `).all(...params);
  
  res.render('admin/products', { pageTitle: 'Produits', layout: 'admin', products, filterCategory: categorie });
});

router.get('/produits/ajouter', (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all();
  res.render('admin/product-form', { pageTitle: 'Ajouter un produit', layout: 'admin', product: null, categories, error: null });
});

router.post('/produits/ajouter', upload.array('images', 10), (req, res) => {
  const db = getDb();
  const { name, description, short_description, price, discount_price, category_id, brand, sku, stock_quantity, is_available, is_featured, meta_title, meta_description } = req.body;

  const slug = slugify(name, { lower: true, strict: true }) + '-' + Math.random().toString(36).slice(2, 6);

  try {
    const result = db.prepare(`
      INSERT INTO products (name, slug, description, short_description, price, discount_price, category_id, brand, sku, stock_quantity, is_available, is_featured, meta_title, meta_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, description, short_description || null, parseInt(price), discount_price ? parseInt(discount_price) : null,
      category_id ? parseInt(category_id) : null, brand || null, sku || null,
      parseInt(stock_quantity) || 0, is_available ? 1 : 0, is_featured ? 1 : 0,
      meta_title || null, meta_description || null);

    const productId = result.lastInsertRowid;

    if (req.files && req.files.length > 0) {
      const insertImg = db.prepare('INSERT INTO product_images (product_id, image_path, is_primary, sort_order) VALUES (?, ?, ?, ?)');
      req.files.forEach((file, i) => {
        insertImg.run(productId, '/uploads/products/' + file.filename, i === 0 ? 1 : 0, i);
      });
    }

    res.redirect('/admin/produits');
  } catch (err) {
    console.error(err);
    const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all();
    res.render('admin/product-form', { pageTitle: 'Ajouter un produit', layout: 'admin', product: req.body, categories, error: 'Erreur lors de la création du produit.' });
  }
});

router.get('/produits/modifier/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.redirect('/admin/produits');
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all();
  const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC').all(product.id);
  res.render('admin/product-form', { pageTitle: 'Modifier le produit', layout: 'admin', product: { ...product, images }, categories, error: null });
});

router.post('/produits/modifier/:id', upload.array('images', 10), (req, res) => {
  const db = getDb();
  const { name, description, short_description, price, discount_price, category_id, brand, sku, stock_quantity, is_available, is_featured, meta_title, meta_description } = req.body;

  db.prepare(`
    UPDATE products SET name = ?, description = ?, short_description = ?, price = ?, discount_price = ?,
      category_id = ?, brand = ?, sku = ?, stock_quantity = ?, is_available = ?, is_featured = ?,
      meta_title = ?, meta_description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, short_description || null, parseInt(price), discount_price ? parseInt(discount_price) : null,
    category_id ? parseInt(category_id) : null, brand || null, sku || null,
    parseInt(stock_quantity) || 0, is_available ? 1 : 0, is_featured ? 1 : 0,
    meta_title || null, meta_description || null, req.params.id);

  if (req.files && req.files.length > 0) {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?').get(req.params.id);
    let order = (maxOrder && maxOrder.m !== null) ? maxOrder.m + 1 : 0;
    const insertImg = db.prepare('INSERT INTO product_images (product_id, image_path, sort_order) VALUES (?, ?, ?)');
    req.files.forEach((file) => {
      insertImg.run(req.params.id, '/uploads/products/' + file.filename, order++);
    });
  }

  res.redirect('/admin/produits');
});

router.post('/produits/supprimer/:id', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE products SET status = 'deleted' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/produits');
});

router.post('/produits/supprimer-image/:imageId', (req, res) => {
  const db = getDb();
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(req.params.imageId);
  if (img) {
    const filepath = path.join(__dirname, '..', 'public', img.image_path);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    db.prepare('DELETE FROM product_images WHERE id = ?').run(req.params.imageId);
  }
  res.redirect('back');
});

// CATEGORIES
router.get('/categories', (req, res) => {
  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND status = 'active') as product_count
    FROM categories c ORDER BY sort_order ASC
  `).all();
  res.render('admin/categories', { pageTitle: 'Catégories', layout: 'admin', categories });
});

router.post('/categories/ajouter', (req, res) => {
  const { name, description } = req.body;
  const db = getDb();
  const slug = slugify(name, { lower: true, strict: true });
  db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run(name, slug, description || null);
  res.redirect('/admin/categories');
});

router.post('/categories/modifier/:id', (req, res) => {
  const { name, description, is_active } = req.body;
  const db = getDb();
  const slug = slugify(name, { lower: true, strict: true });
  db.prepare('UPDATE categories SET name = ?, slug = ?, description = ?, is_active = ?, updated_at = datetime("now") WHERE id = ?')
    .run(name, slug, description || null, is_active ? 1 : 0, req.params.id);
  res.redirect('/admin/categories');
});

router.post('/categories/supprimer/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/categories');
});

// ORDERS
router.get('/commandes', (req, res) => {
  const db = getDb();
  const { status, search } = req.query;
  let where = [];
  const params = [];
  
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  
  if (search) {
    const searchTerm = `%${search}%`;
    where.push('(o.order_number LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ? OR o.delivery_phone LIKE ?)');
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }
  
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const orders = db.prepare(`
    SELECT o.*, u.full_name as customer_name, u.phone as customer_phone
    FROM orders o LEFT JOIN users u ON o.user_id = u.id
    ${whereClause}
    ORDER BY o.created_at DESC
  `).all(...params);

  res.render('admin/orders', { pageTitle: 'Commandes', layout: 'admin', orders, filterStatus: status || '', search: search || '' });
});

router.get('/commandes/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare(`
    SELECT o.*, u.full_name as customer_name, u.phone as customer_phone, u.email as customer_email, u.whatsapp as customer_whatsapp
    FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.redirect('/admin/commandes');

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin/order-detail', { pageTitle: `Commande ${order.order_number}`, layout: 'admin', order, items });
});

router.post('/commandes/:id/statut', (req, res) => {
  console.log('--- POST /commandes/:id/statut ---');
  console.log('req.params.id:', req.params.id);
  console.log('req.body:', req.body);
  const { status, admin_notes } = req.body;
  const db = getDb();
  db.prepare('UPDATE orders SET status = ?, admin_notes = ?, updated_at = datetime("now") WHERE id = ?')
    .run(status, admin_notes || null, parseInt(req.params.id, 10));
  res.redirect(`/admin/commandes/${req.params.id}`);
});

// CUSTOMERS
router.get('/clients', (req, res) => {
  const db = getDb();
  const customers = db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
      (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id AND status != 'cancelled') as total_spent
    FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC
  `).all();
  res.render('admin/customers', { pageTitle: 'Clients', layout: 'admin', customers });
});

// SETTINGS
router.get('/parametres', (req, res) => {
  const settings = getSettings();
  const db = getDb();
  const zones = db.prepare('SELECT * FROM delivery_zones ORDER BY fee ASC').all();
  res.render('admin/settings', { pageTitle: 'Paramètres', layout: 'admin', settings, zones });
});

router.post('/parametres', (req, res) => {
  const fields = ['store_name', 'store_tagline', 'store_description', 'whatsapp_number', 'store_phone', 'store_email', 'store_address', 'default_delivery_fee', 'meta_title', 'meta_description', 'facebook_url', 'instagram_url', 'tiktok_url'];
  for (const f of fields) {
    if (req.body[f] !== undefined) setSetting(f, req.body[f]);
  }
  res.redirect('/admin/parametres');
});

router.post('/zones/ajouter', (req, res) => {
  const { name, fee } = req.body;
  const db = getDb();
  db.prepare('INSERT INTO delivery_zones (name, fee) VALUES (?, ?)').run(name, parseInt(fee) || 0);
  res.redirect('/admin/parametres');
});

router.post('/zones/supprimer/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM delivery_zones WHERE id = ?').run(req.params.id);
  res.redirect('/admin/parametres');
});

// API: pending orders count (for notification polling)
router.get('/api/notifications', (req, res) => {
  const db = getDb();
  const pending = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const recentPending = db.prepare(`
    SELECT o.order_number, u.full_name as customer_name, o.total, o.id
    FROM orders o LEFT JOIN users u ON o.user_id = u.id
    WHERE o.status = 'pending'
    ORDER BY o.created_at DESC LIMIT 5
  `).all();
  res.json({ pendingCount: pending, recentPending });
});

module.exports = router;
