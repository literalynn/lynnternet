document.addEventListener('DOMContentLoaded', () => {
    Promise.all([
      fetch('nav.html').then(r => r.ok ? r.text() : Promise.reject('nav')),
      fetch('footer.html').then(r => r.ok ? r.text() : Promise.reject('footer'))
    ]).then(([navHTML, footerHTML]) => {
      const navPh = document.getElementById('nav-placeholder');
      const footPh = document.getElementById('footer-placeholder');
      if (navPh) navPh.innerHTML = navHTML;
      if (footPh) footPh.innerHTML = footerHTML;
      setActiveNavLink();
      enhanceAccessibility();
    }).catch(err => {
      console.warn('Chargement partiel:', err);
      const navPh = document.getElementById('nav-placeholder');
      const footPh = document.getElementById('footer-placeholder');
      if (navPh) navPh.innerHTML = '<nav aria-label="Navigation"><p>Nav indisponible</p></nav>';
      if (footPh) footPh.innerHTML = '<footer><p>Pied de page indisponible</p></footer>';
    });
  
    function setActiveNavLink() {
      const navLinks = document.querySelectorAll('.nav-link');
      const current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
      navLinks.forEach(link => {
        link.classList.remove('active');
        const page = (link.getAttribute('href') || '').toLowerCase();
        if (!page) return;
        if (((current === '' || current === 'index.html') && page.includes('index')) || current === page) {
          link.classList.add('active');
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }
  
    function enhanceAccessibility() {
      let usedKeyboard = false;
      window.addEventListener('keydown', e => { if (e.key === 'Tab') usedKeyboard = true; });
      document.addEventListener('focusin', e => {
        if (!usedKeyboard) return;
        const el = e.target;
        if (el.matches('a, button, [role="button"], .service-button')) el.classList.add('focus-visible');
      });
      document.addEventListener('focusout', e => { const el = e.target; if (el && el.classList) el.classList.remove('focus-visible'); });
    }
  
    setupSpotlightCards();
    function setupSpotlightCards() {
      const cards = document.querySelectorAll('.stat-card:not(.loading-tile), .service-button');
      const scheduled = new WeakMap();
      cards.forEach(card => {
        if (card.hasAttribute('data-spotlight-bound')) return;
        card.setAttribute('data-spotlight-bound', '');
        const schedule = e => {
          if (scheduled.get(card)) return;
          scheduled.set(card, true);
          requestAnimationFrame(() => {
            scheduled.set(card, false);
            const r = card.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            const cx = x - r.width / 2, cy = y - r.height / 2;
            const rotateX = (cy / r.height) * -5, rotateY = (cx / r.width) * 5;
            const angle = (Math.atan2(cy, cx) * 180 / Math.PI + 450) % 360;
            card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
            card.style.setProperty('--spotlight-x', `${x}px`);
            card.style.setProperty('--spotlight-y', `${y}px`);
            card.style.setProperty('--grad-angle', `${angle}deg`);
          });
        };
        card.addEventListener('pointermove', schedule, { passive: true });
        card.addEventListener('pointerleave', () => {
          card.style.transform = '';
          card.style.setProperty('--spotlight-x', '-999px');
          card.style.setProperty('--spotlight-y', '-999px');
          card.style.setProperty('--grad-angle', '200deg');
        }, { passive: true });
      });
    }
  });
  // by Lynn with <3 cloud.lynn.paris