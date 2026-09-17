const { initDatabase, getDb, getSettings } = require('./db/init');
(async () => {
  const dbWrapper = await initDatabase();
  const db = getDb();
  
  const userId = 1; 
  const cartItems = [{ product: { id: 1, name: 'Phone', price: 1000 }, price: 1000, quantity: 1 }];
  const subtotal = 1000;
  const deliveryFee = 1500;
  const total = 2500;
  
  const insertOrder = db.prepare(`
    INSERT INTO orders (order_number, user_id, subtotal, delivery_fee, total, payment_method, status,
      delivery_full_name, delivery_phone, delivery_city, delivery_neighborhood, delivery_address, delivery_landmark, delivery_notes)
    VALUES (?, ?, ?, ?, ?, 'cash_on_delivery', 'pending', ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity, subtotal)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const transaction = db.transaction(() => {
    try {
      const result = insertOrder.run(
        'TEST' + Date.now(), userId, subtotal, deliveryFee, total,
        'Test User', '123456', 'City', 'Neigh',
        '', null, null
      );
      const orderId = result.lastInsertRowid;
      for (const item of cartItems) {
        insertItem.run(orderId, item.product.id, item.product.name, item.price, item.quantity, item.price * item.quantity);
      }
      
      const addrExists = db.prepare('SELECT id FROM addresses WHERE user_id = ?').get(userId);
      if (!addrExists) {
        db.prepare(`INSERT INTO addresses (user_id, full_name, phone, city, neighborhood, address_line, landmark, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(userId, 'Test User', '123456', 'City', 'Neigh', '', null);
      }
      return 'TEST9999';
    } catch (innerErr) {
      console.error('INNER ERROR:', innerErr);
      throw innerErr;
    }
  });
  
  try {
    const res = transaction();
    console.log('Transaction succeeded, order:', res);
  } catch (err) {
    console.error('Outer Error:', err.message);
  }
})();
