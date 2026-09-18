// SoukEnLigne — Frontend JavaScript

document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar menu
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('mobile-sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  const closeBtn = document.getElementById('close-sidebar-btn');

  function toggleSidebar() {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  }

  if (menuBtn && sidebar && overlay && closeBtn) {
    menuBtn.addEventListener('click', toggleSidebar);
    closeBtn.addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', toggleSidebar);
  }

  // AJAX add to cart
  document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.closest('form')?.addEventListener('submit', async function(e) {
      const form = this;
      // Only AJAX on product page, not if no fetch support
      if (!window.fetch) return;
      e.preventDefault();

      const data = new FormData(form);
      try {
        const res = await fetch('/panier/ajouter?ajax=1', {
          method: 'POST',
          body: new URLSearchParams(data),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
        });
        const json = await res.json();
        if (json.success) {
          const badge = document.getElementById('cart-badge');
          if (badge) {
            badge.textContent = json.cartCount;
            badge.style.transform = 'scale(1.3)';
            setTimeout(() => badge.style.transform = 'scale(1)', 200);
          }
          btn.textContent = '✓ Ajouté au panier';
          btn.style.background = '#22C55E';
          setTimeout(() => {
            btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Ajouter au panier';
            btn.style.background = '';
          }, 2000);
        }
      } catch (err) {
        form.submit();
      }
    });
  });
});
