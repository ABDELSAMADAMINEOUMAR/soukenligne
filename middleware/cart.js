const { getDb } = require('../db/init');

function loadCart(req, res, next) {
  if (!req.session.cart) req.session.cart = [];
  
  // Enrich cart items with current product data
  const db = getDb();
  const enriched = [];
  for (const item of req.session.cart) {
    const product = db.prepare('SELECT id, name, slug, price, discount_price, stock_quantity, is_available, status FROM products WHERE id = ?').get(item.product_id);
    if (product && product.is_available && product.status === 'active') {
      const img = db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC LIMIT 1').get(product.id);
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
  next();
}

module.exports = { loadCart };
