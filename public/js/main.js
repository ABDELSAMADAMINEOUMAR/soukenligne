// Baron Technology — Frontend JavaScript

document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar menu
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('mobile-sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  const closeBtn = document.getElementById('close-sidebar-btn');

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden'; // Prevent scrolling background
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (menuBtn && sidebar && overlay && closeBtn) {
    menuBtn.addEventListener('click', openSidebar);
    closeBtn.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
    // Added touchstart for better mobile responsiveness
    overlay.addEventListener('touchstart', function(e) {
      e.preventDefault(); // Prevent ghost clicks
      closeSidebar();
    });
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

// Live Search
let searchTimeout = null;
window.handleLiveSearch = function(inputElement) {
  const query = inputElement.value.trim();
  const form = inputElement.closest('.search-form');
  const resultsContainer = form.querySelector('.live-search-results');

  if (query.length < 2) {
    resultsContainer.style.display = 'none';
    return;
  }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    fetch('/api/search?q=' + encodeURIComponent(query))
      .then(r => r.json())
      .then(products => {
        if (products.length > 0) {
          const html = products.map(p => `
            <a href="/produit/${p.slug}" class="live-search-item">
              <img src="${p.image || '/img/placeholder.jpg'}" alt="${p.name}" class="live-search-img">
              <div class="live-search-info">
                <div class="live-search-name">${p.name}</div>
                <div class="live-search-price">
                  ${p.discount_price ? `<span class="current-price">${p.discount_price} FCFA</span> <span class="old-price">${p.price} FCFA</span>` : `<span class="current-price">${p.price} FCFA</span>`}
                </div>
              </div>
            </a>
          `).join('');
          resultsContainer.innerHTML = html;
          resultsContainer.style.display = 'block';
        } else {
          resultsContainer.innerHTML = '<div class="live-search-empty">Aucun produit trouvé</div>';
          resultsContainer.style.display = 'block';
        }
      })
      .catch(() => {});
  }, 300);
};

// Close live search when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.search-form')) {
    document.querySelectorAll('.live-search-results').forEach(el => {
      el.style.display = 'none';
    });
  }
});
