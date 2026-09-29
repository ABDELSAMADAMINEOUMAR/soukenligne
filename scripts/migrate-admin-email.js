const { Client } = require('pg');
require('dotenv').config();

async function migrateAdminEmail() {
  if (process.env.CONFIRM_ADMIN_MIGRATION !== 'true') {
    console.error('Migration annulée. Vous devez définir CONFIRM_ADMIN_MIGRATION=true pour exécuter ce script.');
    process.exit(1);
  }

  const newEmail = process.env.ADMIN_DEFAULT_EMAIL;
  if (!newEmail) {
    console.error("Migration annulée. ADMIN_DEFAULT_EMAIL n'est pas défini dans les variables d'environnement.");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Migration annulée. DATABASE_URL n'est pas défini.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // Target the specific old admin email explicitly
    const oldEmail = 'admin@barontechnology.td';
    const res = await client.query("SELECT id, email, full_name, role FROM users WHERE email = $1 AND role = 'admin'", [oldEmail]);
    
    if (res.rows.length === 0) {
      console.log(`Le compte admin avec l'email ${oldEmail} n'a pas été trouvé. Aucune modification n'a été apportée.`);
      process.exit(0);
    }

    if (res.rows.length > 1) {
      console.error(`Erreur : Plus d'un compte admin correspond à ${oldEmail}. Migration annulée par sécurité.`);
      process.exit(1);
    }
    
    const admin = res.rows[0];
    console.log(`Compte admin unique trouvé : ID ${admin.id} | Email actuel : ${admin.email}`);
    
    if (admin.email === newEmail) {
      console.log(`Le compte utilise déjà l'email ${newEmail}. Migration inutile.`);
      process.exit(0);
    }

    // Begin transaction
    console.log('Début de la transaction...');
    await client.query('BEGIN');
    
    await client.query("UPDATE users SET email = $1 WHERE id = $2 AND role = 'admin'", [newEmail, admin.id]);
    
    await client.query('COMMIT');
    console.log(`Succès : L'email de l'administrateur a été mis à jour vers ${newEmail}. (Le mot de passe reste inchangé)`);
    
  } catch (err) {
    console.error('Erreur lors de la migration. Rollback en cours...', err);
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('Erreur lors du rollback', rbErr);
    }
  } finally {
    await client.end();
  }
}

migrateAdminEmail();
