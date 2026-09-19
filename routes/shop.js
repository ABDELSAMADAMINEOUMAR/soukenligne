const express = require('express');
const router = express.Router();
const { getDb, getSettings } = require('../db/init');

// Homepage
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    
    const featuredRes = await db.query(`
      SELECT p.*, c.name as category_name,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_featured = true AND p.status = 'active' AND p.is_available = true
      ORDER BY p.updated_at DESC LIMIT 8
    `);
    const featured = featuredRes.rows;

    const latestRes = await db.query(`
      SELECT p.*, c.name as category_name,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'active' AND p.is_available = true
      ORDER BY p.created_at DESC LIMIT 8
    `);
    const latest = latestRes.rows;

    const discountedRes = await db.query(`
      SELECT p.*, c.name as category_name,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.discount_price IS NOT NULL AND p.status = 'active' AND p.is_available = true
      ORDER BY (p.price - p.discount_price) DESC LIMIT 8
    `);
    const discounted = discountedRes.rows;

    const categoriesRes = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY sort_order ASC');
    const categories = categoriesRes.rows;

    // Count products per category
    for (const cat of categories) {
      const countRes = await db.query("SELECT COUNT(*) as c FROM products WHERE category_id = $1 AND status = 'active' AND is_available = true", [cat.id]);
      cat.product_count = countRes.rows.length > 0 ? parseInt(countRes.rows[0].c) : 0;
    }

    res.render('home', { featured, latest, discounted, categories, pageTitle: '' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Product listing / search
router.get('/boutique', async (req, res) => {
  try {
    const db = getDb();
    const { q, categorie, tri, page } = req.query;
    const currentPage = parseInt(page) || 1;
    const perPage = 12;
    const offset = (currentPage - 1) * perPage;

    let where = "WHERE p.status = 'active' AND p.is_available = true";
    const params = [];
    let paramIndex = 1;

    if (q) {
      where += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex+1} OR p.brand ILIKE $${paramIndex+2})`;
      const search = `%${q}%`;
      params.push(search, search, search);
      paramIndex += 3;
    }

    if (categorie) {
      where += ` AND c.slug = $${paramIndex}`;
      params.push(categorie);
      paramIndex++;
    }

    let orderBy = 'ORDER BY p.created_at DESC';
    if (tri === 'prix-asc') orderBy = 'ORDER BY COALESCE(p.discount_price, p.price) ASC';
    else if (tri === 'prix-desc') orderBy = 'ORDER BY COALESCE(p.discount_price, p.price) DESC';
    else if (tri === 'nom') orderBy = 'ORDER BY p.name ASC';

    const countRes = await db.query(`SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id ${where}`, params);
    const total = parseInt(countRes.rows[0].total);
    const totalPages = Math.ceil(total / perPage);

    const productsParams = [...params, perPage, offset];
    const productsRes = await db.query(`
      SELECT p.*, c.name as category_name, c.slug as category_slug,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      ${where} ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, productsParams);
    const products = productsRes.rows;

    const categoriesRes = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY sort_order ASC');
    const categories = categoriesRes.rows;

    const activeCategory = categorie ? categories.find(c => c.slug === categorie) : null;

    res.render('shop', {
      products, categories, activeCategory,
      query: q || '', tri: tri || '',
      currentPage, totalPages, total,
      pageTitle: activeCategory ? activeCategory.name : 'Boutique'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Product detail
router.get('/produit/:slug', async (req, res) => {
  try {
    const db = getDb();
    const productRes = await db.query(`
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.slug = $1
    `, [req.params.slug]);

    if (productRes.rows.length === 0) return res.status(404).render('404', { pageTitle: 'Page non trouvée' });
    const product = productRes.rows[0];

    const imagesRes = await db.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, sort_order ASC', [product.id]);
    const images = imagesRes.rows;

    const relatedRes = await db.query(`
      SELECT p.*,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
      FROM products p
      WHERE p.category_id = $1 AND p.id != $2 AND p.status = 'active' AND p.is_available = true
      ORDER BY RANDOM() LIMIT 4
    `, [product.category_id, product.id]);
    const related = relatedRes.rows;

    const settings = await getSettings();

    res.render('product', {
      product, images, related,
      pageTitle: product.name,
      metaTitle: product.meta_title || product.name + ' — SoukEnLigne',
      metaDescription: product.meta_description || product.short_description || '',
      ogImage: images.length > 0 ? images[0].image_path : ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Category page
router.get('/categorie/:slug', (req, res) => {
  res.redirect(`/boutique?categorie=${req.params.slug}`);
});

// Live Search API
router.get('/api/search', async (req, res) => {
  try {
    const db = getDb();
    const query = req.query.q ? req.query.q.trim() : '';
    
    if (!query) return res.json([]);
    
    const search = `%${query}%`;
    const resultsRes = await db.query(`
      SELECT p.id, p.slug, p.name, p.price, p.discount_price,
        (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) as image
      FROM products p
      WHERE (p.name ILIKE $1 OR p.short_description ILIKE $2) 
        AND p.status = 'active' AND p.is_available = true
      ORDER BY p.updated_at DESC
      LIMIT 5
    `, [search, search]);
    
    res.json(resultsRes.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

module.exports = router;
