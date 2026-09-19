const { getDb } = require('../db/init');

async function loadCart(req, res, next) {
  if (!req.session.cart) req.session.cart = [];
  
  try {
    const db = getDb();
    const enriched = [];
    for (const item of req.session.cart) {
      const productRes = await db.query('SELECT id, name, slug, price, discount_price, stock_quantity, is_available, status FROM products WHERE id = $1', [item.product_id]);
      const product = productRes.rows[0];
      if (product && product.is_available && product.status === 'active') {
        const imgRes = await db.query('SELECT image_path FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, sort_order ASC LIMIT 1', [product.id]);
        const img = imgRes.rows[0];
        enriched.push({
          product_id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.discount_price || product.price,
          original_price: product.price,
          discount_price: product.discount_price,
          image: img ? img.image_path : null,
          quantity: Math.min(item.quantity, product.stock_quantity),
          max_quantity: product.stock_quantity
        });
      }
    }
    
    req.session.cart = enriched.map(e => ({ product_id: e.product_id, quantity: e.quantity }));
    res.locals.cart = enriched;
    res.locals.cartCount = enriched.reduce((sum, i) => sum + i.quantity, 0);
    res.locals.cartTotal = enriched.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  } catch (err) {
    console.error(err);
    res.locals.cart = [];
    res.locals.cartCount = 0;
    res.locals.cartTotal = 0;
  }
  next();
}

module.exports = { loadCart };
