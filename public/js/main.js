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
      
      if (window.ButtonLoader) window.ButtonLoader.start(btn);

      const data = new FormData(form);
      try {
        const res = await fetch('/panier/ajouter?ajax=1', {
          method: 'POST',
          body: new URLSearchParams(data),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
        });
        const json = await res.json();
        
        if (window.ButtonLoader) window.ButtonLoader.stop(btn);
        
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
        if (window.ButtonLoader) window.ButtonLoader.stop(btn);
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

// Global Button Loading Manager
window.ButtonLoader = {
  getLoadingText: function(originalText) {
    const t = (originalText || '').toLowerCase().trim();
    if (t.includes('créer') || t.includes('inscription')) return 'Création...';
    if (t.includes('connecter') || t.includes('connexion')) return 'Connexion...';
    if (t.includes('enregistrer') || t.includes('sauvegarder') || t.includes('modifier')) return 'Enregistrement...';
    if (t.includes('supprimer') || t.includes('retirer')) return 'Suppression...';
    if (t.includes('commander') || t.includes('valider') || t.includes('payer')) return 'Traitement...';
    if (t.includes('ajouter')) return 'Ajout...';
    if (t.includes('envoyer')) return 'Envoi...';
    if (t.includes('rechercher')) return 'Recherche...';
    if (t.includes('upload') || t.includes('télécharger')) return 'Téléchargement...';
    return 'Chargement...';
  },
  
  start: function(btn, customText = null) {
    if (!btn || btn.dataset.loading === 'true') return;
    
    btn.dataset.originalHtml = btn.innerHTML;
    btn.dataset.originalWidth = btn.style.width;
    btn.dataset.originalPointerEvents = btn.style.pointerEvents;
    btn.dataset.originalOpacity = btn.style.opacity;
    btn.dataset.loading = 'true';
    
    const computedWidth = btn.getBoundingClientRect().width;
    const loadingText = customText || this.getLoadingText(btn.textContent);
    
    if (computedWidth > 0 && !btn.style.width) {
      btn.style.width = computedWidth + 'px';
    }
    
    const spinner = `<svg class="btn-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite; display: inline-block; vertical-align: middle; margin-right: 8px;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg>`;
    
    btn.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; gap: 6px;">${spinner} <span>${loadingText}</span></span>`;
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
    
    // Slight delay to prevent immediate synchronous disabled state blocking forms in some browsers
    setTimeout(() => {
      if(btn.dataset.loading === 'true') btn.disabled = true;
    }, 10);
  },
  
  stop: function(btn) {
    if (!btn || btn.dataset.loading !== 'true') return;
    
    btn.innerHTML = btn.dataset.originalHtml || '';
    btn.style.width = btn.dataset.originalWidth || '';
    btn.style.opacity = btn.dataset.originalOpacity || '';
    btn.style.pointerEvents = btn.dataset.originalPointerEvents || '';
    btn.disabled = false;
    delete btn.dataset.loading;
  }
};

// Global intercept for all standard forms
document.addEventListener('submit', function(e) {
  const form = e.target;
  
  // Guard against double submission (e.g. mashing Enter)
  if (form.dataset.submitting === 'true') {
    e.preventDefault();
    return;
  }
  
  // Only apply global loader to forms that are actually submitting (not prevented by confirm() or custom validation)
  if (!e.defaultPrevented) {
    form.dataset.submitting = 'true';
    const submitBtn = form.querySelector('button[type="submit"]') || 
                      form.querySelector('input[type="submit"]') || 
                      form.querySelector('button:not([type="button"])');
                      
    if (submitBtn) {
      window.ButtonLoader.start(submitBtn);
      
      // Safety reset timeout for standard forms (in case of file downloads, etc.)
      setTimeout(() => {
        window.ButtonLoader.stop(submitBtn);
        form.dataset.submitting = 'false';
      }, 8000); 
    } else {
      setTimeout(() => { form.dataset.submitting = 'false'; }, 8000);
    }
  }
});

// Restore buttons when navigating back via browser history (BFCache)
window.addEventListener('pageshow', function(e) {
  if (e.persisted) {
    document.querySelectorAll('[data-loading="true"]').forEach(btn => {
      window.ButtonLoader.stop(btn);
    });
  }
});
