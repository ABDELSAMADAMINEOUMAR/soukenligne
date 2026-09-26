const { initDatabase, getDb } = require('./init');

async function runMigrations() {
  console.log('🔄 Starting database initialization and migrations...');
  
  // Create tables if they don't exist
  await initDatabase();
  
  const db = getDb();
  
  try {
    console.log('➜ Running schema updates (ALTER TABLE)...');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes TEXT');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_seen_cancellation BOOLEAN DEFAULT false');
    
    console.log('➜ Running data migrations (UPDATE)...');
    // Migrate old SoukEnLigne branding to Baron Technology
    await db.query("UPDATE settings SET value = 'Baron Technology' WHERE key = 'store_name' AND value = 'SoukEnLigne'");
    await db.query("UPDATE settings SET value = 'Votre satisfaction est notre priorité' WHERE key = 'store_tagline' AND value LIKE '%march%Tchad%'");
    await db.query("UPDATE settings SET value = 'Baron Technology — Votre satisfaction est notre priorité. Achetez en ligne, payez à la livraison.' WHERE key = 'store_description' AND value LIKE '%SoukEnLigne%'");
    await db.query("UPDATE settings SET value = '23566731494' WHERE key = 'whatsapp_number' AND value = '23566000000'");
    await db.query("UPDATE settings SET value = '+235 66 73 14 94' WHERE key = 'store_phone' AND value LIKE '%66 00 00 00%'");
    await db.query("UPDATE settings SET value = 'barontechnologyltd@gmail.com' WHERE key = 'store_email' AND value LIKE '%soukenligne%'");
    await db.query("UPDATE settings SET value = 'Dinguessou, Autour du rond point Pence' WHERE key = 'store_address' AND value LIKE '%Djam%'");
    await db.query("UPDATE settings SET value = 'Baron Technology — Votre satisfaction est notre priorité' WHERE key = 'meta_title' AND value LIKE '%SoukEnLigne%'");
    await db.query("UPDATE settings SET value = 'Baron Technology est votre boutique en ligne au Tchad. Découvrez nos produits, commandez en ligne et payez à la livraison.' WHERE key = 'meta_description' AND value LIKE '%SoukEnLigne%'");

    // Migrate old admin email
    await db.query("UPDATE users SET email = 'admin@barontechnology.td', phone = '+23566731494' WHERE email = 'admin@soukenligne.td' AND role = 'admin'");
    
    // Migrate existing guest emails
    await db.query("UPDATE users SET email = REPLACE(email, '@soukenligne.td', '@barontechnology.td') WHERE email LIKE 'guest_%@soukenligne.td'");

    console.log('➜ Checking for initial seed data...');
    const productCountRes = await db.query('SELECT COUNT(*) as c FROM products');
    if (parseInt(productCountRes.rows[0].c) === 0) {
      console.log('   Running initial seed script...');
      const { runSeed } = require('./seed');
      await runSeed();
    }
    
    console.log('✅ Migrations completed successfully.');
  } catch (err) {
    console.error('❌ Error during migrations:', err);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
