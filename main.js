document.addEventListener('DOMContentLoaded', function() {
    // 1) Charger nav/footer
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
    }).catch((err) => {
        console.warn('Chargement partiel:', err);
        const navPh = document.getElementById('nav-placeholder');
        const footPh = document.getElementById('footer-placeholder');
        if (navPh) navPh.innerHTML = '<nav aria-label="Navigation"><p>Nav indisponible</p></nav>';
        if (footPh) footPh.innerHTML = '<footer><p>Pied de page indisponible</p></footer>';
    });

    // 2) Activer/indiquer la page active
    function setActiveNavLink() {
        const navLinks = document.querySelectorAll('.nav-link');
        const current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        navLinks.forEach(link => {
            link.classList.remove('active');
            const page = (link.getAttribute('href') || '').toLowerCase();
            if (!page) return;
            if (
                (current === '' && page.includes('index')) ||
                (current === 'index.html' && page.includes('index')) ||
                current === page
            ) {
                link.classList.add('active');
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    }

    // 3) Accessibilité & UX
    function enhanceAccessibility() {
        // Focus visible sur éléments cliquables si Tab
        let userUsedKeyboard = false;
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') userUsedKeyboard = true;
        });
        document.addEventListener('focusin', (e) => {
            if (!userUsedKeyboard) return;
            const el = e.target;
            if (el.matches('a, button, [role="button"], .service-button')) {
                el.classList.add('focus-visible');
            }
        });
        document.addEventListener('focusout', (e) => {
            const el = e.target;
            if (el && el.classList) el.classList.remove('focus-visible');
        });
    }
});