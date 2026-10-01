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
          resultsContainer.innerHTML = '';
          products.forEach(p => {
            const a = document.createElement('a');
            a.href = '/produit/' + encodeURIComponent(p.slug);
            a.className = 'live-search-item';
            
            const img = document.createElement('img');
            img.src = p.image || '/img/placeholder.jpg';
            img.alt = p.name;
            img.className = 'live-search-img';
            a.appendChild(img);

            const info = document.createElement('div');
            info.className = 'live-search-info';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'live-search-name';
            nameDiv.textContent = p.name;
            info.appendChild(nameDiv);

            const priceDiv = document.createElement('div');
            priceDiv.className = 'live-search-price';
            
            if (p.discount_price) {
              const currentSpan = document.createElement('span');
              currentSpan.className = 'current-price';
              currentSpan.textContent = p.discount_price + ' FCFA';
              
              const oldSpan = document.createElement('span');
              oldSpan.className = 'old-price';
              oldSpan.textContent = p.price + ' FCFA';
              
              priceDiv.appendChild(currentSpan);
              priceDiv.appendChild(document.createTextNode(' '));
              priceDiv.appendChild(oldSpan);
            } else {
              const currentSpan = document.createElement('span');
              currentSpan.className = 'current-price';
              currentSpan.textContent = p.price + ' FCFA';
              priceDiv.appendChild(currentSpan);
            }
            info.appendChild(priceDiv);
            
            a.appendChild(info);
            resultsContainer.appendChild(a);
          });
          resultsContainer.style.display = 'block';
        } else {
          resultsContainer.innerHTML = '';
          const emptyDiv = document.createElement('div');
          emptyDiv.className = 'live-search-empty';
          emptyDiv.textContent = 'Aucun produit trouvé';
          resultsContainer.appendChild(emptyDiv);
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

// Handle form submission loading states
document.addEventListener('DOMContentLoaded', () => {
  const formsToHandle = document.querySelectorAll('form.auth-form, form.checkout-form');
  
  formsToHandle.forEach(form => {
    form.addEventListener('submit', function() {
      const submitBtn = this.querySelector('button[type="submit"]');
      if (submitBtn && !submitBtn.classList.contains('loading')) {
        // Prevent double click visual (actual prevention is handled by disabling button or pointer-events)
        const originalText = submitBtn.textContent.trim();
        let loadingText = 'Chargement...';
        
        // Customize text based on original content
        if (originalText.toLowerCase().includes('créer') || originalText.toLowerCase().includes('inscription')) {
          loadingText = 'Création en cours...';
        } else if (originalText.toLowerCase().includes('connecter') || originalText.toLowerCase().includes('connexion')) {
          loadingText = 'Connexion...';
        } else if (originalText.toLowerCase().includes('enregistrer') || originalText.toLowerCase().includes('sauvegarder')) {
          loadingText = 'Enregistrement...';
        } else if (originalText.toLowerCase().includes('commander') || originalText.toLowerCase().includes('valider')) {
          loadingText = 'Traitement...';
        }
        
        // Replace content with spinner
        submitBtn.classList.add('loading');
        submitBtn.innerHTML = `
          <svg class="spinner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          <span>${loadingText}</span>
        `;
      }
    });
  });
});
