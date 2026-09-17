const { getSettings, getDb } = require('../db/init');

function loadHelpers(req, res, next) {
  const settings = getSettings();
  res.locals.settings = settings;
  res.locals.storeName = settings.store_name || 'SoukEnLigne';
  res.locals.whatsappNumber = settings.whatsapp_number || '';
  res.locals.currency = settings.currency || 'FCFA';

  try {
    res.locals.categories = getDb().prepare('SELECT name, slug FROM categories WHERE is_active = 1 ORDER BY sort_order ASC').all();
  } catch (e) {
    res.locals.categories = [];
  }

  res.locals.formatPrice = function(price) {
    if (!price && price !== 0) return '0 FCFA';
    return new Intl.NumberFormat('fr-FR').format(price) + ' FCFA';
  };

  res.locals.whatsappLink = function(number, message) {
    const clean = (number || '').replace(/[^0-9]/g, '');
    const encoded = encodeURIComponent(message || '');
    return `https://wa.me/${clean}?text=${encoded}`;
  };

  res.locals.statusLabel = function(status) {
    const labels = {
      pending: 'En attente',
      confirmed: 'Confirmée',
      preparing: 'En préparation',
      out_for_delivery: 'En livraison',
      delivered: 'Livrée',
      cancelled: 'Annulée'
    };
    return labels[status] || status;
  };

  res.locals.statusClass = function(status) {
    const classes = {
      pending: 'status-pending',
      confirmed: 'status-confirmed',
      preparing: 'status-preparing',
      out_for_delivery: 'status-delivery',
      delivered: 'status-delivered',
      cancelled: 'status-cancelled'
    };
    return classes[status] || '';
  };

  next();
}

module.exports = { loadHelpers };
