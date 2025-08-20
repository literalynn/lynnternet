document.addEventListener('DOMContentLoaded', () => {
    Promise.allSettled([
      fetch('nav.html').then(r => r.ok ? r.text() : Promise.reject('nav')),
      fetch('footer.html').then(r => r.ok ? r.text() : Promise.reject('footer'))
    ]).then(([navRes, footerRes]) => {
      const navPh = document.getElementById('nav-placeholder');
      const footPh = document.getElementById('footer-placeholder');
      if (navRes.status === 'fulfilled') {
        if (navPh) navPh.innerHTML = navRes.value;
      } else if (navPh) {
        navPh.innerHTML = '<nav aria-label="Navigation"><p>Nav indisponible</p></nav>';
      }
      if (footerRes.status === 'fulfilled') {
        if (footPh) footPh.innerHTML = footerRes.value;
      } else if (footPh) {
        footPh.innerHTML = '<footer><p>Pied de page indisponible</p></footer>';
      }
      setActiveNavLink();
      enhanceAccessibility();
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
      window.addEventListener('pointerdown', () => {
        usedKeyboard = false;
        const active = document.activeElement;
        if (active && active.classList) active.classList.remove('focus-visible');
      });
      document.addEventListener('focusin', e => {
        if (!usedKeyboard) return;
        const el = e.target;
        if (el.matches('a, button, [role="button"], .service-button')) el.classList.add('focus-visible');
      });
      document.addEventListener('focusout', e => { const el = e.target; if (el && el.classList) el.classList.remove('focus-visible'); });
    }
  });
  
  (function () {
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const SEL = '.stat-card:not(.loading-tile), .service-button';
    const scheduled = new WeakMap();
    function paint(card, e) {
      if (prefersReduced) return;
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const cx = x - r.width / 2, cy = y - r.height / 2;
      const rx = (cy / r.height) * -5, ry = (cx / r.width) * 5;
      const ang = (Math.atan2(cy, cx) * 180 / Math.PI + 450) % 360;
      card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      card.style.setProperty('--spotlight-x', `${x}px`);
      card.style.setProperty('--spotlight-y', `${y}px`);
      card.style.setProperty('--grad-angle', `${ang}deg`);
    }
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest(SEL);
      if (!card) return;
      if (scheduled.get(card)) return;
      scheduled.set(card, true);
      requestAnimationFrame(() => { scheduled.set(card, false); paint(card, e); });
    }, { passive: true });
    document.addEventListener('pointerleave', (e) => {
      const card = e.target.closest(SEL);
      if (!card) return;
      card.style.transform = '';
      card.style.setProperty('--spotlight-x', '-999px');
      card.style.setProperty('--spotlight-y', '-999px');
      card.style.setProperty('--grad-angle', '200deg');
    }, true);
  })();
  // by Lynn with <3 cloud.lynn.paris