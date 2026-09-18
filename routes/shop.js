const express = require('express');
const router = express.Router();
const { getDb, getSettings } = require('../db/init');

// Homepage
router.get('/', (req, res) => {
  const db = getDb();
  const featured = db.prepare(`
    SELECT p.*, c.name as category_name,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_featured = 1 AND p.status = 'active' AND p.is_available = 1
    ORDER BY p.updated_at DESC LIMIT 8
  `).all();

  const latest = db.prepare(`
    SELECT p.*, c.name as category_name,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.status = 'active' AND p.is_available = 1
    ORDER BY p.created_at DESC LIMIT 8
  `).all();

  const discounted = db.prepare(`
    SELECT p.*, c.name as category_name,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.discount_price IS NOT NULL AND p.status = 'active' AND p.is_available = 1
    ORDER BY (p.price - p.discount_price) DESC LIMIT 8
  `).all();

  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all();

  // Count products per category
  for (const cat of categories) {
    const count = db.prepare("SELECT COUNT(*) as c FROM products WHERE category_id = ? AND status = 'active' AND is_available = 1").get(cat.id);
    cat.product_count = count ? count.c : 0;
  }

  res.render('home', { featured, latest, discounted, categories, pageTitle: '' });
});

// Product listing / search
router.get('/boutique', (req, res) => {
  const db = getDb();
  const { q, categorie, tri, page } = req.query;
  const currentPage = parseInt(page) || 1;
  const perPage = 12;
  const offset = (currentPage - 1) * perPage;

  let where = "WHERE p.status = 'active' AND p.is_available = 1";
  const params = [];

  if (q) {
    where += " AND (p.name LIKE ? OR p.description LIKE ? OR p.brand LIKE ?)";
    const search = `%${q}%`;
    params.push(search, search, search);
  }

  if (categorie) {
    where += " AND c.slug = ?";
    params.push(categorie);
  }

  let orderBy = 'ORDER BY p.created_at DESC';
  if (tri === 'prix-asc') orderBy = 'ORDER BY COALESCE(p.discount_price, p.price) ASC';
  else if (tri === 'prix-desc') orderBy = 'ORDER BY COALESCE(p.discount_price, p.price) DESC';
  else if (tri === 'nom') orderBy = 'ORDER BY p.name ASC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id ${where}`).get(...params);
  const total = countRow.total;
  const totalPages = Math.ceil(total / perPage);

  const products = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    ${where} ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all();

  const activeCategory = categorie ? categories.find(c => c.slug === categorie) : null;

  res.render('shop', {
    products, categories, activeCategory,
    query: q || '', tri: tri || '',
    currentPage, totalPages, total,
    pageTitle: activeCategory ? activeCategory.name : 'Boutique'
  });
});

// Product detail
router.get('/produit/:slug', (req, res) => {
  const db = getDb();
  const product = db.prepare(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.slug = ?
  `).get(req.params.slug);

  if (!product) return res.status(404).render('404', { pageTitle: 'Page non trouvée' });

  const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC').all(product.id);

  const related = db.prepare(`
    SELECT p.*,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
    FROM products p
    WHERE p.category_id = ? AND p.id != ? AND p.status = 'active' AND p.is_available = 1
    ORDER BY RANDOM() LIMIT 4
  `).all(product.category_id, product.id);

  const settings = getSettings();

  res.render('product', {
    product, images, related,
    pageTitle: product.name,
    metaTitle: product.meta_title || product.name + ' — SoukEnLigne',
    metaDescription: product.meta_description || product.short_description || '',
    ogImage: images.length > 0 ? images[0].image_path : ''
  });
});

// Category page
router.get('/categorie/:slug', (req, res) => {
  res.redirect(`/boutique?categorie=${req.params.slug}`);
});

// Live Search API
router.get('/api/search', (req, res) => {
  const db = getDb();
  const query = req.query.q ? req.query.q.trim() : '';
  
  if (!query) return res.json([]);
  
  const results = db.prepare(`
    SELECT p.id, p.slug, p.name, p.price, p.discount_price,
      (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
    FROM products p
    WHERE (p.name LIKE ? OR p.short_description LIKE ?) 
      AND p.status = 'active' AND p.is_available = 1
    ORDER BY p.updated_at DESC
    LIMIT 5
  `).all(`%${query}%`, `%${query}%`);
  
  res.json(results);
});

module.exports = router;
