document.addEventListener('DOMContentLoaded', () => {
  // ==============================
  // Config
  // ==============================
  const SERVERS = [
    { id: 'ltn1', name: 'ltn1', api: 'https://ltn1.lynnternet.cloud/api/stats', description: 'Plex media server', services: 'plex' },
    { id: 'ltn2', name: 'ltn2', api: 'https://ltn2.lynnternet.cloud/api/stats', description: 'Game servers', services: 'game' },
    { id: 'ltn0', name: 'ltn0', api: 'https://ltn0.lynnternet.cloud/api/stats', description: 'Proxy', services: 'proxy' }
  ];

  const MAX_HISTORY_POINTS = 30;
  const POLL_OK_MS = 2000;
  const POLL_DOWN_MS = 15000;
  const PING_PANELS_MS = 20000;
  const RETRY_DELAY = 5000;
  const MAX_RETRIES = 3;

  // ==============================
  // Helpers / Chart.js plugins
  // ==============================
  const makeAlpha = (color, a) => color.replace('rgb', 'rgba').replace(')', `, ${a})`);
  const sanitizeId = s => String(s).trim().replace(/[^\w-]+/g, '-');

  function createBiaxialFillPattern(chart, area, color, options = {}) {
    const topAlpha = options.topAlpha ?? 0.25;
    const fadeRatio = options.fadeRatio ?? 0.4;
    const off = document.createElement('canvas');
    off.width = chart.canvas.width;
    off.height = chart.canvas.height;
    const g = off.getContext('2d');

    const vGrad = g.createLinearGradient(area.left, area.top, area.left, area.bottom);
    vGrad.addColorStop(0, makeAlpha(color, topAlpha));
    vGrad.addColorStop(1, makeAlpha(color, 0));
    g.fillStyle = vGrad;
    g.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);

    g.globalCompositeOperation = 'destination-in';
    const hMask = g.createLinearGradient(area.left, area.top, area.right, area.top);
    hMask.addColorStop(0, 'rgba(0,0,0,0)');
    hMask.addColorStop(Math.min(Math.max(fadeRatio, 0), 1), 'rgba(0,0,0,1)');
    hMask.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = hMask;
    g.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);

    return chart.ctx.createPattern(off, 'no-repeat');
  }

  const glowLinePlugin = {
    id: 'glow',
    beforeDatasetDraw(chart, args, options) {
      const { ctx } = chart;
      ctx.save();
      let color = options?.shadowColor;
      if (!color) {
        const ds = chart.data.datasets[args.index];
        color = typeof ds._baseBorderColor === 'string' ? ds._baseBorderColor
             : typeof ds.borderColor === 'string' ? ds.borderColor
             : '#fff';
      }
      const baseBlur = options?.shadowBlur ?? 12;
      ctx.shadowBlur = baseBlur * (window.devicePixelRatio || 1);
      ctx.shadowColor = color;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    },
    afterDatasetDraw(chart) { chart.ctx.restore(); }
  };
  const fadeLeftPlugin = {
    id: 'fadeLeft',
    beforeDatasetsDraw(chart, args, pluginOptions) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const fadeRatio = pluginOptions?.fadeRatio ?? 0.4;
      chart.data.datasets.forEach(ds => {
        if (!ds._baseBorderColor) ds._baseBorderColor = ds.borderColor;
        const base = ds._baseBorderColor;
        if (typeof base !== 'string') return;
        const grad = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
        grad.addColorStop(0, base.replace('rgb', 'rgba').replace(')', ',0)'));
        grad.addColorStop(fadeRatio, base);
        ds.borderColor = grad;
        ds.pointBackgroundColor = base;
      });
    }
  };
  if (window.Chart) {
    Chart.register(glowLinePlugin);
    Chart.register(fadeLeftPlugin);
  }

  function createChartConfig(mainColor) {
    return {
      type: 'line',
      data: { labels: [], datasets: [{
        data: [],
        borderColor: mainColor,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: mainColor,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2
      }]},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.08)', drawBorder: false } },
          x: { ticks: { display: false }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true, mode: 'index', intersect: false,
            backgroundColor: 'rgba(12,12,12,0.5)',
            titleColor: '#fff', bodyColor: '#fff',
            padding: 10, cornerRadius: 16,
            borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1
          },
          glow: { shadowBlur: 32 },
          fadeLeft: { fadeRatio: 0.4 }
        }
      }
    };
  }

  // ==============================
  // Conditional DOM generation
  // ==============================
  const serversContainer = document.getElementById('servers-container');
  const statusSummaryContainer = document.getElementById('servers-status-summary');
  const isDashboard = !!serversContainer;
  const panelStatusCards = document.querySelectorAll('.service-button .server-status-card');

  if (isDashboard) {
    SERVERS.forEach(s => {
      serversContainer.insertAdjacentHTML('beforeend', serverSectionHTML(s));
    });
    if (statusSummaryContainer) {
      SERVERS.forEach(s => statusSummaryContainer.insertAdjacentHTML('beforeend', statusSummaryHTML(s)));
    }
  }

  function serverSectionHTML(s) {
    return `
      <section class="server-section" id="${s.id}-section" data-server-id="${s.id}">
        <header class="server-header">
          <h2 class="server-title">${s.name}</h2>
          <p class="server-subtitle">${s.description}</p>
        </header>
        <div class="status-grid" id="${s.id}-status-grid">
          <div class="grid-overlay" id="${s.id}-grid-overlay" aria-live="polite" aria-hidden="true">
            <div class="overlay-content">
              <div class="error-icon">⚠️</div>
              <div class="overlay-text">Impossible de récupérer les données</div>
              <button class="retry-button" data-server-id="${s.id}">Réessayer</button>
            </div>
          </div>
          <div class="stat-card loading-tile" id="${s.id}-mobile-tile" aria-hidden="true" tabindex="-1">
            <div class="tile-content">
              <div class="tile-icon" aria-hidden="true">⏳</div>
              <div class="tile-text" id="${s.id}-mobile-tile-text">Connexion…</div>
              <button class="retry-button" data-server-id="${s.id}">Réessayer</button>
            </div>
          </div>
          <div class="stat-card">
            <div class="card-title"><h3>CPU</h3><span id="${s.id}-cpu-value-text" class="card-value-text"></span></div>
            <div class="chart-container"><canvas id="${s.id}-cpuChart"></canvas></div>
          </div>
          <div class="stat-card">
            <div class="card-title"><h3>RAM</h3><span id="${s.id}-ram-value-text" class="card-value-text"></span></div>
            <div class="chart-container"><canvas id="${s.id}-ramChart"></canvas></div>
          </div>
          <div class="stat-card">
            <div class="card-title">
              <h3>Réseau</h3>
              <div class="card-value-network">
                <span class="network-rates">
                  <span id="${s.id}-network-down">↓ 0.0</span>
                  <span id="${s.id}-network-up">↑ 0.0</span>
                </span>
                <span class="network-unit">Mbps</span>
              </div>
            </div>
            <div class="chart-container"><canvas id="${s.id}-networkChart"></canvas></div>
          </div>
          <div class="stat-card">
            <div class="card-title"><h3>Stockage</h3><span id="${s.id}-storage-total-text" class="card-value-text"></span></div>
            <div id="${s.id}-storage-list" class="storage-list-container" data-server-id="${s.id}">
              <div class="loading-state" id="${s.id}-loading-disks">
                <div class="loading-spinner"></div><span>Chargement des disques...</span>
              </div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function statusSummaryHTML(s) {
    return `
      <a class="server-summary-link" href="#${s.id}-section" aria-label="Aller au serveur ${s.name}">
        <div class="api-status" id="${s.id}-api-status" aria-live="polite">
          <div class="status-indicator" id="${s.id}-status-indicator"></div>
          <span class="status-text" aria-hidden="true">${s.name}</span>
          <span class="status-text" id="${s.id}-status-text">Connexion…</span>
        </div>
      </a>`;
  }

  // ==============================
  // Dashboard state + charts
  // ==============================
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
        retryCount: 0,
        isConnected: false,
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
      initCharts(s);
      updateStats(s);
      states[s.id].intervalId = setInterval(() => updateStats(s), POLL_OK_MS);
    });
  }

  function saveHistory(s, st) {
    const ls = k => `${s.id}_${k}`;
    localStorage.setItem(ls('cpuHistory'), JSON.stringify(st.cpuHistory));
    localStorage.setItem(ls('ramHistory'), JSON.stringify(st.ramHistory));
    localStorage.setItem(ls('netDownHistory'), JSON.stringify(st.netDownHistory));
    localStorage.setItem(ls('netUpHistory'), JSON.stringify(st.netUpHistory));
  }

  function initCharts(s) {
    if (!window.Chart) return;
    const st = states[s.id];
    const cpuColor = 'rgb(255, 0, 166)';
    const ramColor = 'rgb(200, 55, 255)';
    const downloadColor = 'rgb(55, 159, 255)';
    const uploadColor = 'rgb(255, 99, 132)';

    const cpuCanvas = document.getElementById(`${s.id}-cpuChart`);
    const ramCanvas = document.getElementById(`${s.id}-ramChart`);
    const netCanvas = document.getElementById(`${s.id}-networkChart`);
    if (!cpuCanvas || !ramCanvas || !netCanvas) return;

    // CPU
    let cpuPattern, cpuW = 0, cpuH = 0;
    const cpuCfg = createChartConfig(cpuColor);
    cpuCfg.data.datasets[0].backgroundColor = ({ chart }) => {
      const area = chart.chartArea; if (!area) return makeAlpha(cpuColor, 0.25);
      if (!cpuPattern || cpuW !== chart.canvas.width || cpuH !== chart.canvas.height) {
        cpuW = chart.canvas.width; cpuH = chart.canvas.height;
        cpuPattern = createBiaxialFillPattern(chart, area, cpuColor, { topAlpha: 0.25, fadeRatio: 0.4 });
      }
      return cpuPattern;
    };
    st.charts.cpu = new Chart(cpuCanvas, cpuCfg);

    // RAM
    let ramPattern, ramW = 0, ramH = 0;
    const ramCfg = createChartConfig(ramColor);
    ramCfg.data.datasets[0].backgroundColor = ({ chart }) => {
      const area = chart.chartArea; if (!area) return makeAlpha(ramColor, 0.25);
      if (!ramPattern || ramW !== chart.canvas.width || ramH !== chart.canvas.height) {
        ramW = chart.canvas.width; ramH = chart.canvas.height;
        ramPattern = createBiaxialFillPattern(chart, area, ramColor, { topAlpha: 0.25, fadeRatio: 0.4 });
      }
      return ramPattern;
    };
    st.charts.ram = new Chart(ramCanvas, ramCfg);

    // Réseau
    let dlPattern, dlW = 0, dlH = 0;
    let ulPattern, ulW = 0, ulH = 0;
    const netCfg = createChartConfig(downloadColor);
    netCfg.data.datasets[0].label = 'Download';
    netCfg.data.datasets[0].backgroundColor = ({ chart }) => {
      const area = chart.chartArea; if (!area) return makeAlpha(downloadColor, 0.25);
      if (!dlPattern || dlW !== chart.canvas.width || dlH !== chart.canvas.height) {
        dlW = chart.canvas.width; dlH = chart.canvas.height;
        dlPattern = createBiaxialFillPattern(chart, area, downloadColor, { topAlpha: 0.25, fadeRatio: 0.4 });
      }
      return dlPattern;
    };
    netCfg.data.datasets.push({
      ...netCfg.data.datasets[0],
      label: 'Upload',
      borderColor: uploadColor,
      backgroundColor: ({ chart }) => {
        const area = chart.chartArea; if (!area) return makeAlpha(uploadColor, 0.25);
        if (!ulPattern || ulW !== chart.canvas.width || ulH !== chart.canvas.height) {
          ulW = chart.canvas.width; ulH = chart.canvas.height;
          ulPattern = createBiaxialFillPattern(chart, area, uploadColor, { topAlpha: 0.25, fadeRatio: 0.4 });
        }
        return ulPattern;
      },
      pointBackgroundColor: uploadColor
    });
    netCfg.options.scales.y.max = undefined;
    netCfg.options.scales.y.suggestedMax = 10;
    netCfg.options.plugins.tooltip.displayColors = true;
    st.charts.net = new Chart(netCanvas, netCfg);

    // Seed from history
    if (st.cpuHistory.length) {
      patchChart(st.charts.cpu, [st.cpuHistory]);
      patchChart(st.charts.ram, [st.ramHistory]);
      patchChart(st.charts.net, [st.netDownHistory, st.netUpHistory]);
    }
  }

  function patchChart(chart, datasets) {
    if (!chart) return;
    const n = datasets[0].length;
    chart.data.labels = Array(n).fill('');
    datasets.forEach((ds, i) => { chart.data.datasets[i].data = ds; });
    chart.update('none');
  }

  // ==============================
  // API status + fetch utils
  // ==============================
  function updateAPIStatus(s, status, message) {
    const ind = document.getElementById(`${s.id}-status-indicator`);
    const txt = document.getElementById(`${s.id}-status-text`);
    const chip = document.getElementById(`${s.id}-api-status`);
    const section = document.getElementById(`${s.id}-section`);
    const mobileTile = document.getElementById(`${s.id}-mobile-tile`);
    const mobileTxt = document.getElementById(`${s.id}-mobile-tile-text`);
    const colorMap = { connected: '#00ff88', error: '#ff4444', connecting: '#ffd866' };
    const cssColor = colorMap[status];

    if (ind && txt) {
      ind.className = 'status-indicator';
      txt.className = 'status-text';
      ind.classList.add(status);
      txt.classList.add(status);
      txt.textContent = message;
    }
    if (chip && cssColor) {
      chip.className = 'api-status';
      chip.classList.add(status);
      chip.style.setProperty('--server-status-color', cssColor);
    }
    if (section && cssColor) {
      section.classList.remove('connected', 'error', 'connecting');
      section.classList.add(status);
      section.style.setProperty('--server-status-color', cssColor);
    }
    if (mobileTile) {
      const icon = mobileTile.querySelector('.tile-icon');
      if (mobileTxt) {
        mobileTxt.textContent =
          status === 'error' ? 'Hors ligne' :
          status === 'connecting' ? 'Connexion…' : 'Connecté';
      }
      if (icon) icon.textContent = status === 'connected' ? '✅' : (status === 'error' ? '⚠️' : '⏳');
      mobileTile.setAttribute('aria-hidden', status === 'connected' ? 'true' : 'false');
    }
  }

  function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(resource, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  }

  // ==============================
  // Stats polling + rendering
  // ==============================
  async function updateStats(s) {
    const st = states[s.id];
    try {
      if (!st.isConnected && st.retryCount === 0) updateAPIStatus(s, 'connecting', 'Connexion…');
      const res = await fetchWithTimeout(s.api, { method: 'GET', timeout: 10000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stats = await res.json();

      st.retryCount = 0;
      st.isConnected = true;
      updateAPIStatus(s, 'connected', 'Connecté');

      const down = stats.network.download_mbps;
      const up = stats.network.upload_mbps;

      st.cpuHistory.push(stats.cpu.percent);   if (st.cpuHistory.length > MAX_HISTORY_POINTS) st.cpuHistory.shift();
      st.ramHistory.push(stats.ram.percent);   if (st.ramHistory.length > MAX_HISTORY_POINTS) st.ramHistory.shift();
      st.netDownHistory.push(down);            if (st.netDownHistory.length > MAX_HISTORY_POINTS) st.netDownHistory.shift();
      st.netUpHistory.push(up);                if (st.netUpHistory.length > MAX_HISTORY_POINTS) st.netUpHistory.shift();

      saveHistory(s, st);
      patchChart(st.charts.cpu, [st.cpuHistory]);
      patchChart(st.charts.ram, [st.ramHistory]);
      patchChart(st.charts.net, [st.netDownHistory, st.netUpHistory]);

      const { cpuText, ramText, netDownEl, netUpEl, storageText, loading, storageList } = st.elements;
      if (cpuText) cpuText.textContent = `${stats.cpu.percent.toFixed(1)}%`;
      if (ramText) ramText.textContent = `${stats.ram.percent.toFixed(1)}%`;
      if (netDownEl) netDownEl.textContent = `↓ ${down.toFixed(1)}`;
      if (netUpEl) netUpEl.textContent = `↑ ${up.toFixed(1)}`;
      if (storageText) storageText.textContent = `${stats.storage_total_used} To`;

      if (loading) loading.style.display = 'none';

      // --- Storage (namespaced per-server + scoped queries, no full-node replace)
      if (storageList && Array.isArray(stats.disks)) {
        const currentKeys = Object.keys(st.diskElements || {});
        const needRebuild = !st.disksInitialized || stats.disks.filter(d => !d.error).length !== currentKeys.length;

        if (needRebuild) {
          storageList.innerHTML = stats.disks
            .filter(d => !d.error)
            .map(d => diskEntryHTML(d, s.id))
            .join('');

          st.diskElements = {};
          for (const d of stats.disks) {
            if (d.error) continue;
            const sid = `${s.id}-disk-${sanitizeId(d.name)}`;
            const root = storageList.querySelector(`#${sid}`); // SCOPED to this server
            if (!root) continue;
            st.diskElements[d.name] = {
              root,
              used:  root.querySelector('.disk-value .used'),
              total: root.querySelector('.disk-value .total'),
              bar:   root.querySelector('.progress-bar'),
              glow:  root.querySelector('.progress-bar-shadow'),
              lastPercent: undefined,
              lastUsed:    undefined,
              lastTotal:   undefined
            };
          }
          st.disksInitialized = true;
        }

        for (const d of stats.disks) {
          if (d.error) continue;
          const el = st.diskElements[d.name];
          if (!el) continue;
          const pctStr = `${d.percent}%`;
          if (el.lastPercent !== pctStr) {
            el.bar.style.width = pctStr;
            el.glow.style.width = pctStr;
            el.lastPercent = pctStr;
          }
          if (el.lastUsed !== d.used_tb) {
            el.used.textContent = d.used_tb;
            el.lastUsed = d.used_tb;
          }
          if (el.lastTotal !== d.total_tb) {
            el.total.textContent = d.total_tb;
            el.lastTotal = d.total_tb;
          }
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
    if (st.retryCount <= MAX_RETRIES) {
      updateAPIStatus(s, 'error', `Erreur – Retry ${st.retryCount}/${MAX_RETRIES}`);
      setTimeout(() => updateStats(s), RETRY_DELAY);
    } else {
      updateAPIStatus(s, 'error', 'Hors ligne');
      showErrorOverlay(s);
      clearInterval(st.intervalId);
      st.intervalId = setInterval(() => updateStats(s), POLL_DOWN_MS);
    }
  }

  function showErrorOverlay(s) {
    const overlay = document.getElementById(`${s.id}-grid-overlay`);
    if (overlay) {
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  // ==============================
  // UI actions
  // ==============================
  window.retryConnection = function(serverId) {
    const s = SERVERS.find(x => x.id === serverId);
    if (!s || !states[s.id]) return;
    const st = states[s.id];
    st.retryCount = 0;
    updateAPIStatus(s, 'connecting', 'Connexion…');
    clearInterval(st.intervalId);
    st.intervalId = setInterval(() => updateStats(s), POLL_OK_MS);
    updateStats(s);
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.retry-button[data-server-id]');
    if (!btn) return;
    const serverId = btn.getAttribute('data-server-id');
    const overlay = document.getElementById(`${serverId}-grid-overlay`);
    if (overlay) {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
    }
    window.retryConnection(serverId);
  });

  document.addEventListener('touchend', (e) => {
    const btn = e.target.closest('.retry-button[data-server-id]');
    if (!btn) return;
    e.preventDefault();
    btn.click();
  }, { passive: false });

  // ==============================
  // Disk row template
  // ==============================
  function diskEntryHTML(d, serverId) {
    if (d.error) return '';
    const safe = sanitizeId(d.name);
    return `
      <div class="disk-entry" id="${serverId}-disk-${safe}">
        <div class="disk-info-header">
          <span class="disk-name">${d.name}</span>
          <span class="disk-value">
            <span class="used">${d.used_tb}</span><span class="sep" style="color: var(--c-accent-primary);"> / </span><span class="total">${d.total_tb}</span> <span class="unit">To</span>
          </span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${d.percent}%;"></div>
          <div class="progress-bar-shadow" style="width: ${d.percent}%;"></div>
        </div>
      </div>`;
  }

  // ==============================
  // 3D spotlight effect
  // ==============================
  setupSpotlightCards();
  function setupSpotlightCards() {
    const cards = document.querySelectorAll('.stat-card:not(.loading-tile), .service-button');
    cards.forEach(card => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const cx = x - r.width / 2;
        const cy = y - r.height / 2;
        const rotateX = (cy / r.height) * -5;
        const rotateY = (cx / r.width) * 5;
        const angle = (Math.atan2(cy, cx) * 180 / Math.PI + 450) % 360;
        card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        card.style.setProperty('--spotlight-x', `${x}px`);
        card.style.setProperty('--spotlight-y', `${y}px`);
        card.style.setProperty('--grad-angle', `${angle}deg`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
        card.style.setProperty('--spotlight-x', '-999px');
        card.style.setProperty('--spotlight-y', '-999px');
        card.style.setProperty('--grad-angle', '200deg');
      });
    });
  }

  // ==============================
  // Panels (status badges on other pages)
  // ==============================
  if (!isDashboard && panelStatusCards && panelStatusCards.length) {
    const byId = Object.fromEntries(SERVERS.map(s => [s.id, s]));
    const map = new Map();

    panelStatusCards.forEach(card => {
      const indicator = card.querySelector('.status-indicator');
      const tooltip = card.querySelector('.status-tooltip');
      const attrId = (card.getAttribute('data-server-id') || '').trim().toLowerCase();
      const textId = (card.querySelector('p')?.textContent || '').trim().toLowerCase();
      const serverId = attrId || textId;
      if (!indicator || !tooltip || !serverId) return;
      if (!map.has(serverId)) map.set(serverId, []);
      map.get(serverId).push({ card, indicator, tooltip });
    });

    map.forEach((cards, serverId) => {
      const s = byId[serverId];
      cards.forEach(({ card, indicator, tooltip }) => setPanelCardStatus(card, indicator, tooltip, 'connecting', 'Connexion…'));

      if (!s || !s.api) {
        cards.forEach(({ card, indicator, tooltip }) =>
          setPanelCardStatus(card, indicator, tooltip, 'error', 'Hors ligne'));
        return;
      }
      const ping = () => pingServer(s.api)
        .then(() => cards.forEach(({ card, indicator, tooltip }) =>
          setPanelCardStatus(card, indicator, tooltip, 'connected', 'Connecté')))
        .catch(() => cards.forEach(({ card, indicator, tooltip }) =>
          setPanelCardStatus(card, indicator, tooltip, 'error', 'Hors ligne')));
      ping();
      setInterval(ping, PING_PANELS_MS);
    });
  }

  function setPanelCardStatus(card, indicator, tooltip, status, message) {
    const COLOR = { connected: '#00ff88', error: '#ff4444', connecting: '#ffd866' };
    const color = COLOR[status] || COLOR.error;
    card.style.setProperty('--server-status-color', color);
    indicator.classList.remove('connected', 'error', 'connecting');
    indicator.classList.add(status);
    tooltip.textContent = message;
    card.setAttribute('title', message);
    card.setAttribute('aria-label', message);
  }

  function pingServer(endpoint) {
    return fetchWithTimeout(endpoint, { method: 'GET', timeout: 8000 })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
});
// by Lynn with <3 cloud.lynn.paris