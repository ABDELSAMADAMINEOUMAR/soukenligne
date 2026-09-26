const nodemailer = require('nodemailer');

// Configure your SMTP settings here or preferably in environment variables
const getTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

async function sendAdminOrderNotification(order, items, settings) {
  try {
    // If SMTP_USER is not configured, we might not be able to send emails
    if (!process.env.SMTP_USER) {
      console.warn('SMTP_USER not configured. Skipping email notification.');
      return;
    }

    const transporter = getTransporter();
    
    // Admin email from settings, or fallback
    const adminEmail = settings.store_email || 'admin@barontechnology.td';
    
    const storeName = settings.store_name || 'Baron Technology';

    let itemsHtml = '<ul>';
    items.forEach(item => {
      itemsHtml += `<li>${item.quantity}x ${item.product_name} - ${item.subtotal} FCFA</li>`;
    });
    itemsHtml += '</ul>';

    const mailOptions = {
      from: `"${storeName}" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject: `Nouvelle commande reçue: ${order.order_number}`,
      html: `
        <h2>Nouvelle commande : ${order.order_number}</h2>
        <p><strong>Client:</strong> ${order.delivery_full_name}</p>
        <p><strong>Téléphone:</strong> ${order.delivery_phone}</p>
        <p><strong>Adresse:</strong> ${order.delivery_city}, ${order.delivery_neighborhood}, ${order.delivery_address}</p>
        <h3>Détails de la commande:</h3>
        ${itemsHtml}
        <p><strong>Sous-total:</strong> ${order.subtotal} FCFA</p>
        <p><strong>Frais de livraison:</strong> ${order.delivery_fee} FCFA</p>
        <p><strong>Total:</strong> ${order.total} FCFA</p>
        <hr>
        <p><a href="http://localhost:3000/admin/commandes/${order.id}">Voir la commande dans l'administration</a></p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Admin notification email sent: %s', info.messageId);
  } catch (error) {
    console.error('Error sending admin notification email:', error);
  }
}

module.exports = {
  sendAdminOrderNotification
};
