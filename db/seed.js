const { getDb } = require('./init');
const slugify = require('slugify');

function makeSlug(text) {
  return slugify(text, { lower: true, strict: true });
}

function runSeed() {
  const db = getDb();

  // Seed categories
  const categories = [
    { name: 'Téléphones & Tablettes', description: 'Smartphones, tablettes et accessoires', sort_order: 1 },
    { name: 'Informatique', description: 'Ordinateurs, imprimantes et accessoires', sort_order: 2 },
    { name: 'Électronique', description: 'TV, audio, caméras et gadgets', sort_order: 3 },
    { name: 'Électroménager', description: 'Appareils pour la maison et la cuisine', sort_order: 4 },
    { name: 'Mode & Vêtements', description: 'Vêtements, chaussures et accessoires', sort_order: 5 },
    { name: 'Maison & Décoration', description: 'Meubles, décoration et rangement', sort_order: 6 },
    { name: 'Beauté & Santé', description: 'Cosmétiques, parfums et soins', sort_order: 7 },
    { name: 'Sport & Loisirs', description: 'Équipements sportifs et loisirs', sort_order: 8 },
  ];

  for (const cat of categories) {
    db.prepare('INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)').run(cat.name, makeSlug(cat.name), cat.description, cat.sort_order);
  }

  // Seed products
  const products = [
    { name: 'Samsung Galaxy A15', description: "Le Samsung Galaxy A15 offre un écran Super AMOLED de 6.5 pouces, un processeur performant, 128 Go de stockage et un appareil photo triple 50 MP. Batterie longue durée de 5000 mAh. Idéal pour un usage quotidien.", short_description: 'Smartphone 128 Go, écran Super AMOLED 6.5"', price: 75000, discount_price: 69000, category_id: 1, brand: 'Samsung', stock_quantity: 25, is_featured: 1 },
    { name: 'iPhone 13', description: "L'iPhone 13 avec son écran Super Retina XDR de 6.1 pouces, puce A15 Bionic ultra-rapide, double caméra 12 MP avec mode Cinématique. Design en aluminium et verre Ceramic Shield.", short_description: 'Smartphone Apple 128 Go, écran 6.1"', price: 350000, category_id: 1, brand: 'Apple', stock_quantity: 10, is_featured: 1 },
    { name: 'Tecno Spark 20 Pro+', description: "Le Tecno Spark 20 Pro+ avec écran 6.78 pouces FHD+, 256 Go de stockage, appareil photo 108 MP, charge rapide 33W et batterie 5000 mAh. Un excellent rapport qualité-prix.", short_description: 'Smartphone 256 Go, caméra 108 MP', price: 95000, discount_price: 85000, category_id: 1, brand: 'Tecno', stock_quantity: 30, is_featured: 1 },
    { name: 'Ordinateur Portable HP 15', description: "PC portable HP 15 pouces avec processeur Intel Core i5, 8 Go de RAM, 256 Go SSD. Écran antireflet HD, Windows 11. Parfait pour le travail et les études.", short_description: 'PC portable Intel i5, 8 Go RAM, 256 Go SSD', price: 280000, category_id: 2, brand: 'HP', stock_quantity: 8, is_featured: 1 },
    { name: 'Imprimante HP DeskJet 2710', description: "Imprimante tout-en-un HP DeskJet 2710 : impression, numérisation, copie. Connexion Wi-Fi, impression mobile. Compacte et facile à utiliser.", short_description: 'Imprimante tout-en-un Wi-Fi', price: 45000, category_id: 2, brand: 'HP', stock_quantity: 15 },
    { name: 'Téléviseur Samsung 43 Smart TV', description: "Smart TV Samsung 43 pouces Full HD, système Tizen, Netflix, YouTube intégrés. Qualité d'image exceptionnelle avec PurColor. Son Dolby Digital Plus.", short_description: 'Smart TV 43" Full HD', price: 195000, discount_price: 175000, category_id: 3, brand: 'Samsung', stock_quantity: 5, is_featured: 1 },
    { name: 'Écouteurs Bluetooth JBL Tune 510BT', description: "Écouteurs sans fil JBL Tune 510BT avec son JBL Pure Bass, autonomie de 40 heures, connexion Bluetooth 5.0, pliables et légers.", short_description: 'Écouteurs sans fil, 40h autonomie', price: 25000, category_id: 3, brand: 'JBL', stock_quantity: 40 },
    { name: 'Réfrigérateur Hisense 120L', description: "Réfrigérateur Hisense 120 litres, classe énergétique A+, faible consommation, silencieux. Compact et idéal pour les petits espaces.", short_description: 'Réfrigérateur compact 120L, classe A+', price: 135000, category_id: 4, brand: 'Hisense', stock_quantity: 7 },
    { name: 'Ventilateur sur pied 18 pouces', description: "Ventilateur oscillant sur pied 18 pouces, 3 vitesses, silencieux et puissant. Hauteur réglable. Idéal pour le climat tchadien.", short_description: 'Ventilateur oscillant 3 vitesses', price: 18000, discount_price: 15000, category_id: 4, stock_quantity: 50 },
    { name: 'Mixeur Moulinex 1.5L', description: "Blender Moulinex 1.5 litres, 500W, 2 vitesses + pulse, lames en acier inoxydable. Pour smoothies, jus et préparations culinaires.", short_description: 'Blender 500W, 1.5L', price: 22000, category_id: 4, brand: 'Moulinex', stock_quantity: 20 },
    { name: 'Montre connectée Xiaomi Band 8', description: "Bracelet connecté Xiaomi Band 8 avec écran AMOLED, suivi de la fréquence cardiaque, plus de 150 modes sportifs, étanche 5 ATM, autonomie 16 jours.", short_description: 'Bracelet connecté, écran AMOLED', price: 28000, category_id: 3, brand: 'Xiaomi', stock_quantity: 20 },
    { name: 'Sac à dos pour ordinateur', description: "Sac à dos pour ordinateur portable jusqu'à 15.6 pouces, compartiment rembourré, port USB intégré, résistant à l'eau. Parfait pour les professionnels.", short_description: 'Sac à dos laptop 15.6", port USB', price: 15000, discount_price: 12000, category_id: 2, stock_quantity: 35 },
  ];

  for (const p of products) {
    db.prepare('INSERT OR IGNORE INTO products (name, slug, description, short_description, price, discount_price, category_id, brand, stock_quantity, is_featured, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      p.name, makeSlug(p.name), p.description, p.short_description, p.price, p.discount_price || null, p.category_id, p.brand || null, p.stock_quantity, p.is_featured || 0, 'active'
    );
  }

  // Seed delivery zones
  const zones = [
    { name: "N'Djaména — Centre", fee: 1000 },
    { name: "N'Djaména — Périphérie", fee: 2000 },
    { name: 'Abéché', fee: 5000 },
    { name: 'Moundou', fee: 5000 },
    { name: 'Sarh', fee: 5000 },
    { name: 'Autre ville', fee: 7500 },
  ];

  for (const z of zones) {
    db.prepare('INSERT OR IGNORE INTO delivery_zones (name, fee) VALUES (?, ?)').run(z.name, z.fee);
  }

  console.log('✅ Base de données initialisée avec les données de démonstration.');
}

module.exports = { runSeed };
