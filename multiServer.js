document.addEventListener('DOMContentLoaded', () => {
  // ------------------------------
  // 1) Config
  // ------------------------------
  const SERVERS = [
    { id: 'ltn1', name: 'ltn1', api: 'https://ltn1.lynnternet....pi/stats', description: 'Plex media server', services: 'plex' },
    { id: 'ltn2', name: 'ltn2', api: 'https://ltn2.lynnternet....oud/api/stats', description: 'Game servers', services: 'game' },
    { id: 'ltn0', name: 'ltn0', api: 'https://ltn0.lynnternet.cloud/api/stats', description: 'Proxy', services: 'proxy' }
  ];

  const MAX_HISTORY_POINTS = 30;
  const POLL_OK_MS = 2000;
  const POLL_DOWN_MS = 15000;
  const PING_PANELS_MS = 20000;
  const RETRY_DELAY = 5000;
  const MAX_RETRIES = 3;

  // ------------------------------
  // 2) Helpers
  // ------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const makeAlpha = (hex, a) => {
    // support rgb/var(--color) passthrough
    if (hex.startsWith('var(') || hex.startsWith('rgb')) return hex;
    const c = hex.replace('#', '');
    const n = c.length === 3
      ? c.split('').map(x => x + x).join('')
      : c.padEnd(6, '0').slice(0, 6);
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  const fmt = {
    pct: v => `${v.toFixed(0)}%`,
    mbps: v => `${v.toFixed(1)} Mbps`,
    tb: v => `${v.toFixed(2)} To`,
  };
  const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // ------------------------------
  // 3) Mode dashboard: rendu
  // ------------------------------
  const isDashboard = document.body.classList.contains('dashboard');

  function serverCardHTML(s) {
    return `
    <section class="server-card" id="${s.id}-card" data-server-id="${s.id}">
      <div class="server-header">
        <div class="server-title">
          <h3>${s.name}</h3>
          <p class="server-desc">${s.description ?? ''}</p>
        </div>
        <div class="server-pills">
          <span class="badge ${s.services}">${s.services ?? ''}</span>
        </div>
      </div>
      <div class="server-grid">
        <div class="grid-cell metric">
          <div class="metric-top">
            <span>CPU</span>
            <strong id="${s.id}-cpu-value-text">--%</strong>
          </div>
          <canvas id="${s.id}-cpu-chart" class="spark"></canvas>
        </div>
        <div class="grid-cell metric">
          <div class="metric-top">
            <span>RAM</span>
            <strong id="${s.id}-ram-value-text">--%</strong>
          </div>
          <canvas id="${s.id}-ram-chart" class="spark"></canvas>
        </div>
        <div class="grid-cell metric">
          <div class="metric-top">
            <span>Down</span>
            <strong id="${s.id}-network-down">-- Mbps</strong>
          </div>
          <canvas id="${s.id}-netdown-chart" class="spark"></canvas>
        </div>
        <div class="grid-cell metric">
          <div class="metric-top">
            <span>Up</span>
            <strong id="${s.id}-network-up">-- Mbps</strong>
          </div>
          <canvas id="${s.id}-netup-chart" class="spark"></canvas>
        </div>
        <div class="grid-cell storage">
          <div class="storage-top">
            <span>Stockage</span>
            <strong id="${s.id}-storage-total-text">-- To</strong>
          </div>
          <div id="${s.id}-loading-disks" class="loading">Loading…</div>
          <div id="${s.id}-storage-list" class="storage-list"></div>
        </div>
      </div>
      <div class="overlay" id="${s.id}-grid-overlay" hidden>
        <div class="overlay-content">
          <p>Serveur indisponible</p>
          <button class="retry-button" data-server-id="${s.id}">Réessayer</button>
        </div>
      </div>
    </section>`;
  }

  // ------------------------------
  // 4) Dashboard: états + charts
  // ------------------------------
  const states = {};
  if (isDashboard) {
    SERVERS.forEach(s => {
      const ls = k => `${s.id}_${k}`;
      states[s.id] = {
        cpuHistory: JSON.parse(localStorage.getItem(ls('cpuHistory'))) || [],
        ramHistory: JSON.parse(localStorage.getItem(ls('ramHistory'))) || [],
        netDownHistory: JSON.parse(localStorage.getItem(ls('netDownHistory'))) || [],
        netUpHistory: JSON.parse(localStorage.getItem(ls('netUpHistory'))) || [],
        charts: {},
        isConnected: true,
        retryCount: 0,
        pollMs: POLL_OK_MS,
        controller: null,
        intervalId: null,
        disksInitialized: false,
        diskElements: {},
        elements: {
          cpuText: document.getElementById(`${s.id}-cpu-value-text`),
          ramText: document.getElementById(`${s.id}-ram-value-text`),
          netDownEl: document.getElementById(`${s.id}-network-down`),
          netUpEl: document.getElementById(`${s.id}-network-up`),
          storageText: document.getElementById(`${s.id}-storage-total-text`),
          loading: document.getElementById(`${s.id}-loading-disks`),
          storageList: document.getElementById(`${s.id}-storage-list`),
          overlay: document.getElementById(`${s.id}-grid-overlay`)
        }
      };
     
      // inject card if not present
      if (!document.getElementById(`${s.id}-card`)) {
        const container = document.querySelector('#servers-container') || document.body;
        container.insertAdjacentHTML('beforeend', serverCardHTML(s));
        // rebind elements after injection
        states[s.id].elements = {
          cpuText: document.getElementById(`${s.id}-cpu-value-text`),
          ramText: document.getElementById(`${s.id}-ram-value-text`),
          netDownEl: document.getElementById(`${s.id}-network-down`),
          netUpEl: document.getElementById(`${s.id}-network-up`),
          storageText: document.getElementById(`${s.id}-storage-total-text`),
          loading: document.getElementById(`${s.id}-loading-disks`),
          storageList: document.getElementById(`${s.id}-storage-list`),
          overlay: document.getElementById(`${s.id}-grid-overlay`)
        };
      }

      // init charts (sparklines)
      ['cpu', 'ram', 'netdown', 'netup'].forEach(kind => {
        const canvas = document.getElementById(`${s.id}-${kind}-chart`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        states[s.id].charts[kind] = { canvas, ctx };
      });
    });
  }

  // ------------------------------
  // 5) Fetch loop + rendu
  // ------------------------------
  async function pollServer(s) {
    const st = states[s.id];
    const { cpuText, ramText, netDownEl, netUpEl, storageText, loading, storageList, overlay } = st.elements;

    try {
      st.controller?.abort();
      st.controller = new AbortController();
      const res = await fetch(s.api, { signal: st.controller.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stats = await res.json();

      // Connected OK
      if (overlay) overlay.hidden = true;
      st.isConnected = true;
      st.retryCount = 0;
      st.pollMs = POLL_OK_MS;

      // Charts/history
      const pushHist = (arr, v) => {
        arr.push(v);
        if (arr.length > MAX_HISTORY_POINTS) arr.shift();
      };

      pushHist(st.cpuHistory, Number(stats?.cpu?.percent || 0));
      pushHist(st.ramHistory, Number(stats?.ram?.percent || 0));
      pushHist(st.netDownHistory, Number(stats?.network?.download_mbps || 0));
      pushHist(st.netUpHistory, Number(stats?.network?.upload_mbps || 0));

      localStorage.setItem(`${s.id}_cpuHistory`, JSON.stringify(st.cpuHistory));
      localStorage.setItem(`${s.id}_ramHistory`, JSON.stringify(st.ramHistory));
      localStorage.setItem(`${s.id}_netDownHistory`, JSON.stringify(st.netDownHistory));
      localStorage.setItem(`${s.id}_netUpHistory`, JSON.stringify(st.netUpHistory));

      // Texts
      if (cpuText) cpuText.textContent = fmt.pct(st.cpuHistory.at(-1) ?? 0);
      if (ramText) ramText.textContent = fmt.pct(st.ramHistory.at(-1) ?? 0);
      if (netDownEl) netDownEl.textContent = fmt.mbps(st.netDownHistory.at(-1) ?? 0);
      if (netUpEl) netUpEl.textContent = fmt.mbps(st.netUpHistory.at(-1) ?? 0);
      if (storageText) storageText.textContent = fmt.tb(Number(stats?.storage_total_used || 0));

      if (loading) loading.style.display = 'none';

      // ----- DISKS: FIX ID COLLISION (scope par serveur) -----
      if (storageList) {
        // rebuild list if size changed (or first time)
        if (!st.disksInitialized || stats.disks.length !== Object.keys(st.diskElements ?? {}).length) {
          storageList.innerHTML = stats.disks.map(d => diskEntryHTML(s.id, d)).join('');
          st.diskElements = {};
          for (const d of stats.disks) {
            if (d.error) continue;
            const id = `${s.id}-disk-${String(d.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
            const root = document.getElementById(id);
            if (!root) continue;
            st.diskElements[d.name] = {
              value: root.querySelector('.disk-value'),
              bar: root.querySelector('.progress-bar'),
              glow: root.querySelector('.progress-bar-shadow'),
              root
            };
          }
          st.disksInitialized = true;
        }

        // update list values
        for (const d of stats.disks) {
          if (d.error) continue;
          const el = st.diskElements[d.name];
          if (!el) continue;
          if (el.value) el.value.innerHTML = `${d.used_tb}<span style="color: var(--c-accent-primary);"> / </span>${d.total_tb} To`;
          if (el.bar) el.bar.style.width = `${d.percent}%`;
          if (el.glow) el.glow.style.width = `${d.percent}%`;
        }
      }

    } catch (e) {
      console.warn(`[${s.id}]`, e);
      handleAPIError(s);
    }
  }

  function handleAPIError(s) {
    const st = states[s.id];
    st.retryCount++;
    st.isConnected = false;
    st.pollMs = st.retryCount >= MAX_RETRIES ? POLL_DOWN_MS : RETRY_DELAY;
    if (st.elements.overlay) st.elements.overlay.hidden = false;
  }

  // ------------------------------
  // 6) Boucles de polling
  // ------------------------------
  function startPolling(s) {
    const st = states[s.id];
    clearInterval(st.intervalId);
    st.intervalId = setInterval(() => pollServer(s), st.pollMs);
    // kick initial
    pollServer(s);
  }

  // init all
  if (isDashboard) {
    SERVERS.forEach(startPolling);
  }

  // Retry button (overlay)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.retry-button[data-server-id]');
    if (!btn) return;
    const serverId = btn.getAttribute('data-server-id');
    const st = states[serverId];
    if (!st) return;
    st.retryCount = 0;
    st.pollMs = POLL_OK_MS;
    st.elements.overlay?.setAttribute('hidden', 'true');
    startPolling(SERVERS.find(x => x.id === serverId));
  });

  document.addEventListener('touchend', (e) => {
    const btn = e.target.closest('.retry-button[data-server-id]');
    if (!btn) return;
    e.preventDefault();
    btn.click();
  }, { passive: false });

  // ----- RENDERER: ENTRIES DISQUES (IDs UNIQUES PAR SERVEUR) -----
  function diskEntryHTML(serverId, d) {
    if (d.error) return '';
    const id = `${serverId}-disk-${slugify(d.name)}`;
    return `
      <div class="disk-entry" id="${id}">
        <div class="disk-info-header">
          <span class="disk-name">${d.name}</span>
          <span class="disk-value">${d.used_tb}<span style="color: var(--c-accent-primary);"> / </span>${d.total_tb} To</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${d.percent}%;"></div>
          <div class="progress-bar-shadow" style="width: ${d.percent}%;"></div>
        </div>
      </div>`;
  }

  // ------------------------------
  // 7) (Optionnel) rendu visuel sparkline (si tu avais déjà)
  // ------------------------------
  function drawSpark(ctx, values, color = '#00E5FF') {
    const canvas = ctx.canvas;
    const w = canvas.width = canvas.clientWidth || 120;
    const h = canvas.height = canvas.clientHeight || 40;
    if (values.length < 2) return;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = 2;
    const sx = (w - pad * 2) / (values.length - 1);
    const sy = (h - pad * 2) / (max - min || 1);

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad + i * sx;
      const y = h - pad - (v - min) * sy;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();

    // light fill fade
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, makeAlpha(color, 0.25));
    grad.addColorStop(1, makeAlpha(color, 0));
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // schedule chart repaints
  if (isDashboard) {
    setInterval(() => {
      SERVERS.forEach(s => {
        const st = states[s.id];
        try {
          if (st?.charts?.cpu?.ctx) drawSpark(st.charts.cpu.ctx, st.cpuHistory);
          if (st?.charts?.ram?.ctx) drawSpark(st.charts.ram.ctx, st.ramHistory);
          if (st?.charts?.netdown?.ctx) drawSpark(st.charts.netdown.ctx, st.netDownHistory);
          if (st?.charts?.netup?.ctx) drawSpark(st.charts.netup.ctx, st.netUpHistory);
        } catch (e) {
          // no-op
        }
      });
    }, 500);
  }
});
// by Lynn with <3 cloud.lynn.paris