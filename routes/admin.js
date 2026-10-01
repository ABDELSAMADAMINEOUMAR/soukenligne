const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const { getDb, getSettings, setSetting } = require('../db/init');
const { requireAdmin } = require('../middleware/auth');
const { validateLengths, validatePassword, invalidateOtherSessions } = require('../utils/validation');

// Supabase config
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// Multer config (memory storage for Supabase upload)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 10 }, fileFilter: (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

function getSafeMimeType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  return null;
}

router.use(requireAdmin);

const rateLimit = require('express-rate-limit');
const PostgresStore = require('../utils/rate-limit-store');

const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  store: new PostgresStore({ prefix: 'rl_admin_action:' }),
  handler: (req, res) => res.status(429).send('Trop de requêtes admin. Veuillez réessayer plus tard.')
});

const adminPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: new PostgresStore({ prefix: 'rl_admin_pwd:' }),
  handler: (req, res) => res.redirect('/admin/parametres?error=Trop de tentatives, veuillez réessayer plus tard.')
});

router.use((req, res, next) => {
  if (req.method === 'POST') {
    return adminActionLimiter(req, res, next);
  }
  next();
});

// Dashboard
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    
    const prodRes = await db.query("SELECT COUNT(*) as c FROM products WHERE status = 'active'");
    const totalProducts = parseInt(prodRes.rows[0].c);
    
    const orderRes = await db.query("SELECT COUNT(*) as c FROM orders");
    const totalOrders = parseInt(orderRes.rows[0].c);
    
    const custRes = await db.query("SELECT COUNT(*) as c FROM users WHERE role = 'customer'");
    const totalCustomers = parseInt(custRes.rows[0].c);
    
    const pendRes = await db.query("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'");
    const pendingOrders = parseInt(pendRes.rows[0].c);
    
    const revRes = await db.query("SELECT COALESCE(SUM(total), 0) as t FROM orders WHERE status IN ('confirmed','preparing','out_for_delivery','delivered')");
    const totalRevenue = parseInt(revRes.rows[0].t);
    
    const recentOrdersRes = await db.query(`
      SELECT o.*, u.full_name as customer_name
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 10
    `);
    const recentOrders = recentOrdersRes.rows;

    const topProductsRes = await db.query(`
      SELECT oi.product_name, SUM(oi.quantity) as total_sold, SUM(oi.subtotal) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status != 'cancelled'
      GROUP BY oi.product_name
      ORDER BY total_sold DESC LIMIT 10
    `);
    const topProducts = topProductsRes.rows;

    const lowStockRes = await db.query("SELECT * FROM products WHERE stock_quantity <= 5 AND status = 'active' ORDER BY stock_quantity ASC LIMIT 10");
    const lowStock = lowStockRes.rows;

    res.render('admin/dashboard', {
      pageTitle: 'Tableau de bord', layout: 'admin',
      totalProducts, totalOrders, totalCustomers, pendingOrders, totalRevenue,
      recentOrders, topProducts, lowStock
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// PRODUCTS
router.get('/produits', async (req, res) => {
  try {
    const db = getDb();
    const { categorie } = req.query;
    
    let filterClause = '';
    const params = [];
    
    if (categorie) {
      filterClause = 'WHERE p.category_id = $1';
      params.push(parseInt(categorie, 10));
    }

    const productsRes = await db.query(`
      SELECT p.*, c.name as category_name,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC LIMIT 1) as image
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      ${filterClause}
      ORDER BY p.created_at DESC
    `, params);
    
    res.render('admin/products', { pageTitle: 'Produits', layout: 'admin', products: productsRes.rows, filterCategory: categorie });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.get('/produits/ajouter', async (req, res) => {
  try {
    const db = getDb();
    const catRes = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY sort_order ASC');
    res.render('admin/product-form', { pageTitle: 'Ajouter un produit', layout: 'admin', product: null, categories: catRes.rows, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.post('/produits/ajouter', async (req, res) => {
  const db = getDb();
  const { name, description, short_description, price, discount_price, category_id, brand, sku, stock_quantity, is_available, is_featured, meta_title, meta_description, uploaded_images } = req.body;

  const lengthErr = validateLengths(req.body, { name: 'product_name', description: 'product_description', short_description: 'product_short_description', brand: 'brand', sku: 'sku', meta_title: 'meta_title', meta_description: 'meta_description' });
  if (lengthErr) {
    const catRes = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY sort_order ASC');
    return res.render('admin/product-form', { pageTitle: 'Ajouter un produit', layout: 'admin', product: req.body, categories: catRes.rows, error: lengthErr });
  }

  const slug = slugify(name, { lower: true, strict: true }) + '-' + Math.random().toString(36).slice(2, 6);

  try {
    // 1. Validate images first
    const paths = uploaded_images ? (Array.isArray(uploaded_images) ? uploaded_images : [uploaded_images]) : [];
    const validImages = [];
    
    if (paths.length > 0 && supabase) {
      for (let i = 0; i < paths.length; i++) {
        const tempPath = paths[i];
        const { data: publicDataTemp } = supabase.storage.from('products').getPublicUrl(tempPath);
        
        try {
          const resp = await fetch(publicDataTemp.publicUrl, { headers: { 'Range': 'bytes=0-11' } });
          if (!resp.ok) throw new Error("Fetch failed");
          
          const arrayBuffer = await resp.arrayBuffer();
          const safeMime = getSafeMimeType(Buffer.from(arrayBuffer));
          
          if (!safeMime) {
            // Invalid image detected! Clean up ALL temporary files and abort.
            await supabase.storage.from('products').remove(paths);
            throw new Error('Une des images est invalide ou corrompue.');
          }
          validImages.push({ tempPath, ext: safeMime === 'image/jpeg' ? '.jpg' : safeMime === 'image/png' ? '.png' : safeMime === 'image/webp' ? '.webp' : '.gif' });
        } catch (fetchErr) {
          await supabase.storage.from('products').remove(paths);
          throw new Error('Erreur lors de la validation des images.');
        }
      }
    }

    // 2. Insert product
    const result = await db.query(`
      INSERT INTO products (name, slug, description, short_description, price, discount_price, category_id, brand, sku, stock_quantity, is_available, is_featured, meta_title, meta_description)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
    `, [
      name, slug, description, short_description || null, parseInt(price), discount_price ? parseInt(discount_price) : null,
      category_id ? parseInt(category_id) : null, brand || null, sku || null,
      parseInt(stock_quantity) || 0, is_available ? true : false, is_featured ? true : false,
      meta_title || null, meta_description || null
    ]);

    const productId = result.rows[0].id;

    // 3. Move images and insert into DB
    if (validImages.length > 0 && supabase) {
      let order = 0;
      for (const img of validImages) {
        const finalFilename = `prod_${productId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${img.ext}`;
        const { data, error } = await supabase.storage.from('products').move(img.tempPath, finalFilename);
        
        if (!error) {
          const { data: publicData } = supabase.storage.from('products').getPublicUrl(finalFilename);
          await db.query('INSERT INTO product_images (product_id, image_path, is_primary, sort_order) VALUES ($1, $2, $3, $4)', 
            [productId, publicData.publicUrl, order === 0 ? true : false, order]);
          order++;
        }
      }
    }

    res.redirect('/admin/produits');
  } catch (err) {
    console.error(err);
    const catRes = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY sort_order ASC');
    res.render('admin/product-form', { pageTitle: 'Ajouter un produit', layout: 'admin', product: req.body, categories: catRes.rows, error: 'Erreur lors de la création du produit.' });
  }
});

router.get('/produits/modifier/:id', async (req, res) => {
  try {
    const db = getDb();
    const prodRes = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    const product = prodRes.rows[0];
    if (!product) return res.redirect('/admin/produits');
    
    const catRes = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY sort_order ASC');
    const imgRes = await db.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC', [product.id]);
    
    res.render('admin/product-form', { pageTitle: 'Modifier le produit', layout: 'admin', product: { ...product, images: imgRes.rows }, categories: catRes.rows, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.post('/produits/modifier/:id', async (req, res) => {
  try {
    const db = getDb();
    const { name, description, short_description, price, discount_price, category_id, brand, sku, stock_quantity, is_available, is_featured, meta_title, meta_description, uploaded_images } = req.body;

    // 1. Validate images first
    const paths = uploaded_images ? (Array.isArray(uploaded_images) ? uploaded_images : [uploaded_images]) : [];
    const validImages = [];
    
    if (paths.length > 0 && supabase) {
      for (let i = 0; i < paths.length; i++) {
        const tempPath = paths[i];
        const { data: publicDataTemp } = supabase.storage.from('products').getPublicUrl(tempPath);
        
        try {
          const resp = await fetch(publicDataTemp.publicUrl, { headers: { 'Range': 'bytes=0-11' } });
          if (!resp.ok) throw new Error("Fetch failed");
          
          const arrayBuffer = await resp.arrayBuffer();
          const safeMime = getSafeMimeType(Buffer.from(arrayBuffer));
          
          if (!safeMime) {
            // Invalid image detected! Clean up ALL temporary files and abort.
            await supabase.storage.from('products').remove(paths);
            throw new Error('Une des images est invalide ou corrompue.');
          }
          validImages.push({ tempPath, ext: safeMime === 'image/jpeg' ? '.jpg' : safeMime === 'image/png' ? '.png' : safeMime === 'image/webp' ? '.webp' : '.gif' });
        } catch (fetchErr) {
          await supabase.storage.from('products').remove(paths);
          throw new Error('Erreur lors de la validation des images.');
        }
      }
    }

    // 2. Update product
    await db.query(`
      UPDATE products SET name = $1, description = $2, short_description = $3, price = $4, discount_price = $5,
        category_id = $6, brand = $7, sku = $8, stock_quantity = $9, is_available = $10, is_featured = $11,
        meta_title = $12, meta_description = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
    `, [
      name, description, short_description || null, parseInt(price), discount_price ? parseInt(discount_price) : null,
      category_id ? parseInt(category_id) : null, brand || null, sku || null,
      parseInt(stock_quantity) || 0, is_available ? true : false, is_featured ? true : false,
      meta_title || null, meta_description || null, req.params.id
    ]);

    // 3. Move images and insert into DB
    if (validImages.length > 0 && supabase) {
      const maxOrderRes = await db.query('SELECT MAX(sort_order) as m FROM product_images WHERE product_id = $1', [req.params.id]);
      let order = (maxOrderRes.rows[0] && maxOrderRes.rows[0].m !== null) ? maxOrderRes.rows[0].m + 1 : 0;
      
      for (const img of validImages) {
        const finalFilename = `prod_${req.params.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${img.ext}`;
        const { data, error } = await supabase.storage.from('products').move(img.tempPath, finalFilename);
        
        if (!error) {
          const { data: publicData } = supabase.storage.from('products').getPublicUrl(finalFilename);
          await db.query('INSERT INTO product_images (product_id, image_path, sort_order) VALUES ($1, $2, $3)', 
            [req.params.id, publicData.publicUrl, order++]);
        }
      }
    }

    res.redirect('/admin/produits');
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/produits`);
  }
});

router.post('/produits/supprimer/:id', async (req, res) => {
  try {
    const db = getDb();
    await db.query("UPDATE products SET status = 'deleted' WHERE id = $1", [req.params.id]);
    res.redirect('/admin/produits');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/produits');
  }
});

router.post('/produits/supprimer-image/:imageId', async (req, res) => {
  try {
    const db = getDb();
    // We would ideally delete it from Supabase as well, but for simplicity we just remove from DB
    await db.query('DELETE FROM product_images WHERE id = $1', [req.params.imageId]);
    res.redirect('back');
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
});

// CATEGORIES
router.get('/categories', async (req, res) => {
  try {
    const db = getDb();
    const catRes = await db.query(`
      SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND status = 'active') as product_count
      FROM categories c ORDER BY sort_order ASC
    `);
    res.render('admin/categories', { pageTitle: 'Catégories', layout: 'admin', categories: catRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.post('/categories/ajouter', async (req, res) => {
  try {
    const { name, description } = req.body;
    const lengthErr = validateLengths(req.body, { name: 'category_name', description: 'category_description' });
    if (lengthErr) return res.redirect('/admin/categories');
    const db = getDb();
    const slug = slugify(name, { lower: true, strict: true });
    await db.query('INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3)', [name, slug, description || null]);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/categories');
  }
});

router.post('/categories/modifier/:id', async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    const db = getDb();
    const slug = slugify(name, { lower: true, strict: true });
    await db.query('UPDATE categories SET name = $1, slug = $2, description = $3, is_active = $4 WHERE id = $5',
      [name, slug, description || null, is_active ? true : false, req.params.id]);
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/categories');
  }
});

router.post('/categories/supprimer/:id', async (req, res) => {
  try {
    const db = getDb();
    await db.query('BEGIN');
    // Prevent foreign key constraint errors
    await db.query('UPDATE categories SET parent_id = NULL WHERE parent_id = $1', [req.params.id]);
    await db.query('UPDATE products SET category_id = NULL WHERE category_id = $1', [req.params.id]);
    // Delete the category
    await db.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    await db.query('COMMIT');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/categories');
  }
});

// ORDERS
router.get('/commandes', async (req, res) => {
  try {
    const db = getDb();
    const { status, search } = req.query;
    let where = [];
    const params = [];
    let paramIdx = 1;
    
    if (status) {
      where.push(`o.status = $${paramIdx++}`);
      params.push(status);
    }
    
    if (search) {
      const searchTerm = `%${search}%`;
      where.push(`(o.order_number ILIKE $${paramIdx++} OR u.full_name ILIKE $${paramIdx++} OR u.phone ILIKE $${paramIdx++} OR o.delivery_phone ILIKE $${paramIdx++})`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const ordersRes = await db.query(`
      SELECT o.*, u.full_name as customer_name, u.phone as customer_phone
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      ${whereClause}
      ORDER BY o.created_at DESC
    `, params);

    res.render('admin/orders', { pageTitle: 'Commandes', layout: 'admin', orders: ordersRes.rows, filterStatus: status || '', search: search || '' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.get('/commandes/:id', async (req, res) => {
  try {
    const db = getDb();
    const orderRes = await db.query(`
      SELECT o.*, u.full_name as customer_name, u.phone as customer_phone, u.email as customer_email, u.whatsapp as customer_whatsapp
      FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = $1
    `, [req.params.id]);
    const order = orderRes.rows[0];
    if (!order) return res.redirect('/admin/commandes');

    const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    res.render('admin/order-detail', { pageTitle: `Commande ${order.order_number}`, layout: 'admin', order, items: itemsRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.post('/commandes/:id/statut', async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const orderId = parseInt(req.params.id, 10);
    const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.redirect(`/admin/commandes/${orderId}`);
    }

    const db = getDb();
    const client = await db.connect();
    
    try {
      await client.query('BEGIN');
      
      const orderRes = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length > 0) {
        const currentStatus = orderRes.rows[0].status;

        if (currentStatus !== status) {
          if (status === 'cancelled' && currentStatus !== 'cancelled') {
            // Restore stock
            const itemsRes = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
            for (const item of itemsRes.rows) {
              await client.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [item.quantity, item.product_id]);
            }
          } else if (currentStatus === 'cancelled' && status !== 'cancelled') {
            // Deduct stock again atomically
            const itemsRes = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [orderId]);
            for (const item of itemsRes.rows) {
              const updateRes = await client.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND stock_quantity >= $1 RETURNING id', [item.quantity, item.product_id]);
              if (updateRes.rows.length === 0) {
                throw new Error('INSUFFICIENT_STOCK');
              }
            }
          }

          await client.query('UPDATE orders SET status = $1, delivery_notes = $2, admin_seen_cancellation = true, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [status, admin_notes || null, orderId]);
        }
      }
      
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch(e){}
      console.error('Admin order update error:', err);
    } finally {
      client.release();
    }
    
    res.redirect(`/admin/commandes/${orderId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/admin/commandes/${req.params.id}`);
  }
});

// CUSTOMERS
router.get('/clients', async (req, res) => {
  try {
    const db = getDb();
    const custRes = await db.query(`
      SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id AND status != 'cancelled') as total_spent
      FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC
    `);
    res.render('admin/customers', { pageTitle: 'Clients', layout: 'admin', customers: custRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// SETTINGS
router.get('/parametres', async (req, res) => {
  try {
    const settings = await getSettings();
    const db = getDb();
    const zonesRes = await db.query('SELECT * FROM delivery_zones ORDER BY fee ASC');
    res.render('admin/settings', { pageTitle: 'Paramètres', layout: 'admin', settings, zones: zonesRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

router.post('/parametres', async (req, res) => {
  try {
    const fields = ['store_name', 'store_tagline', 'store_description', 'whatsapp_number', 'store_phone', 'store_email', 'store_address', 'default_delivery_fee', 'meta_title', 'meta_description', 'facebook_url', 'instagram_url', 'tiktok_url'];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        const val = String(req.body[f]);
        if (val.length > 2000) continue; // Skip oversized setting values
        await setSetting(f, val);
      }
    }
    res.redirect('/admin/parametres');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/parametres');
  }
});

router.post('/zones/ajouter', async (req, res) => {
  try {
    const { name } = req.body;
    const lengthErr = validateLengths(req.body, { name: 'zone_name' });
    if (lengthErr) return res.redirect('/admin/parametres');
    const db = getDb();
    await db.query('INSERT INTO delivery_zones (name, fee) VALUES ($1, 0)', [name]);
    res.redirect('/admin/parametres');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/parametres');
  }
});

router.post('/zones/supprimer/:id', async (req, res) => {
  try {
    const db = getDb();
    await db.query('DELETE FROM delivery_zones WHERE id = $1', [req.params.id]);
    res.redirect('/admin/parametres');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/parametres');
  }
});

router.post('/changer-mot-de-passe', adminPasswordLimiter, async (req, res) => {
  try {
    const { current_password, new_password, new_password_confirm } = req.body;
    
    if (new_password !== new_password_confirm) {
      return res.redirect('/admin/parametres?error=passwords_mismatch');
    }
    
    const pwdErr = validatePassword(new_password);
    if (pwdErr) {
      return res.redirect('/admin/parametres?error=password_invalid');
    }
    
    const db = getDb();
    const userRes = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
    const user = userRes.rows[0];
    
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.redirect('/admin/parametres?error=current_password_incorrect');
    }
    
    const newHash = bcrypt.hashSync(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.session.userId]);
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [req.session.userId]);
    
    const userId = req.session.userId;
    const currentSid = req.sessionID;

    // Invalidate all other sessions for this admin user
    await invalidateOtherSessions(db, userId, currentSid);

    req.session.regenerate((err) => {
      if (err) console.error(err);
      req.session.userId = userId;
      req.session.userRole = 'admin';
      res.redirect('/admin/parametres?success=password_changed');
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/parametres?error=server_error');
  }
});

// API: pending orders count
router.get('/api/notifications', async (req, res) => {
  try {
    const db = getDb();
    const pendRes = await db.query("SELECT COUNT(*) as c FROM orders WHERE status = 'pending' OR (status = 'cancelled' AND admin_seen_cancellation = false)");
    const pending = parseInt(pendRes.rows[0].c);
    
    const recentRes = await db.query(`
      SELECT o.order_number, o.status, u.full_name as customer_name, o.total, o.id
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      WHERE o.status = 'pending' OR (o.status = 'cancelled' AND o.admin_seen_cancellation = false)
      ORDER BY o.created_at DESC LIMIT 5
    `);
    res.json({ pendingCount: pending, recentPending: recentRes.rows });
  } catch (err) {
    console.error(err);
    res.json({ pendingCount: 0, recentPending: [] });
  }
});

// API: Generate signed upload URLs for browser-based uploads
router.post('/api/upload-tokens', async (req, res) => {
  try {
    const { count } = req.body;
    const numFiles = parseInt(count, 10);
    
    if (isNaN(numFiles) || numFiles < 1 || numFiles > 10) {
      return res.status(400).json({ error: 'Nombre d\'images invalide. Maximum 10 images autorisées.' });
    }
    
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase n\'est pas configuré sur ce serveur.' });
    }

    const tokens = [];
    for (let i = 0; i < numFiles; i++) {
      const filename = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`;
      const { data, error } = await supabase.storage.from('products').createSignedUploadUrl(filename);
      
      if (error || !data) {
        console.error('Erreur createSignedUploadUrl:', error);
        return res.status(500).json({ error: 'Erreur lors de la génération des tokens d\'upload.' });
      }
      
      tokens.push({ signedUrl: data.signedUrl, path: data.path });
    }
    
    res.json({ tokens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;
