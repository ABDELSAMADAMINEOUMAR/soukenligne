function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/compte/connexion');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.userRole === 'admin') return next();
  res.redirect('/compte/connexion');
}

async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isAdmin = false;
  if (req.session && req.session.userId) {
    try {
      const { getDb } = require('../db/init');
      const db = getDb();
      const userRes = await db.query('SELECT id, full_name, email, role FROM users WHERE id = $1', [req.session.userId]);
      const user = userRes.rows[0];
      if (user) {
        res.locals.currentUser = user;
        res.locals.isAdmin = user.role === 'admin';
      }
    } catch (err) {
      console.error(err);
    }
  }
  next();
}

module.exports = { requireAuth, requireAdmin, loadUser };
