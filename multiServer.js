'use strict';
import { sanitizeId } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const SERVERS = [
    { id: 'ltn3', name: 'ltn3', api: 'https://ltn3.lynnternet.cloud/api/stats', description: 'Media server & Web server', services: 'media' },
    { id: 'ltn2', name: 'ltn2', api: 'https://ltn2.lynnternet.cloud/api/stats', description: 'Game servers', services: 'game' },
    { id: 'ltn1', name: 'ltn1', api: 'https://ltn1.lynnternet.cloud/api/stats', description: 'NAS', services: 'nas' },
    { id: 'ltn0', name: 'ltn0', api: 'https://ltn0.lynnternet.cloud/api/stats', description: 'Proxy', services: 'proxy' }
  ];

  const CFG = Object.freeze({
    MAX_HISTORY: 30,
    POLL_OK_MS: 2000,
    POLL_DOWN_MS: 15000,
    PING_PANELS_MS: 20000,
    FETCH_TIMEOUT_MS: 10000,
    INITIAL_BACKOFF_MS: 5000,
    MAX_BACKOFF_MS: 60000
  });

  const DPR = Math.max(1, window.devicePixelRatio || 1);
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STATUS_COLOR = { connected: '#00ff88', error: '#ff4444', connecting: '#ffd866' };
  const CPU_COLOR = 'rgb(255, 0, 166)';
  const RAM_COLOR = 'rgb(200, 55, 255)';
  const DOWNLOAD_COLOR = 'rgb(55, 159, 255)';
  const UPLOAD_COLOR = 'rgb(255, 99, 132)';

  const makeAlpha = (color, a) => color.replace('rgb', 'rgba').replace(')', `, ${a})`);
  const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };

  let writeQueue = [];
  let rafScheduled = false;
  function scheduleWrite(fn) {
    writeQueue.push(fn);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(() => {
        const q = writeQueue; writeQueue = []; rafScheduled = false;
        for (let i = 0; i < q.length; i++) { try { q[i](); } catch {} }
      });
    }
  }

  function persistSession(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function loadSession(key) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }

  function createBiaxialFillPattern(chart, area, color, { topAlpha = 0.25, fadeRatio = 0.4 } = {}) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, area.right - area.left);
    off.height = Math.max(1, area.bottom - area.top);
    const g = off.getContext('2d');
    const vGrad = g.createLinearGradient(0, 0, 0, off.height);
    vGrad.addColorStop(0, makeAlpha(color, topAlpha));
    vGrad.addColorStop(1, makeAlpha(color, 0));
    g.fillStyle = vGrad;
    g.fillRect(0, 0, off.width, off.height);
    g.globalCompositeOperation = 'destination-in';
    const fr = Math.min(Math.max(fadeRatio, 0), 1);
    const hMask = g.createLinearGradient(0, 0, off.width, 0);
    hMask.addColorStop(0, 'rgba(0,0,0,0)');
    hMask.addColorStop(fr, 'rgba(0,0,0,1)');
    hMask.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = hMask;
    g.fillRect(0, 0, off.width, off.height);
    return chart.ctx.createPattern(off, 'no-repeat');
  }

  const glowLinePlugin = {
    id: 'glow',
    beforeDatasetDraw(chart, args, options) {
      const { ctx } = chart; ctx.save();
      const ds = chart.data.datasets[args.index];
      const base = ds._baseBorderColor || ds.borderColor || '#fff';
      ds._baseBorderColor = base;
      ctx.shadowBlur = (prefersReduced ? 0 : (options?.shadowBlur ?? 20)) * DPR;
      ctx.shadowColor = typeof base === 'string' ? base : '#fff';
      ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    },
    afterDatasetDraw(chart) { chart.ctx.restore(); }
  };

  const fadeLeftPlugin = {
    id: 'fadeLeft',
    beforeDatasetsDraw(chart, _args, pluginOptions) {
      const { ctx, chartArea } = chart; if (!chartArea) return;
      const fadeRatio = pluginOptions?.fadeRatio ?? 0.4;
      for (const ds of chart.data.datasets) {
        if (!ds._baseBorderColor) ds._baseBorderColor = ds.borderColor;
        const base = ds._baseBorderColor; if (typeof base !== 'string') continue;
        const grad = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
        grad.addColorStop(0, base.replace('rgb', 'rgba').replace(')', ',0)'));
        grad.addColorStop(fadeRatio, base);
        ds.borderColor = grad; ds.pointBackgroundColor = base;
      }
    }
  };
  if (window.Chart) { Chart.register(glowLinePlugin, fadeLeftPlugin); }

  function createChartConfig(mainColor) {
    return {
      type: 'line',
      data: { labels: [], datasets: [{
        data: [], borderColor: mainColor, borderWidth: 2, fill: true, tension: 0.4,
        pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: mainColor,
        pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2
      }]},
      options: {
        normalized: true,
        animation: prefersReduced ? false : { duration: 0 },
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { color: '#a0a0a0' }, grid: { color: 'rgba(255,255,255,0.08)', drawBorder: false } },
          x: { ticks: { display: false }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true, mode: 'index', intersect: false,
            backgroundColor: 'rgba(12,12,12,0.5)', titleColor: '#fff', bodyColor: '#fff',
            padding: 10, cornerRadius: 16, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1
          },
          glow: { shadowBlur: prefersReduced ? 0 : 24 },
          fadeLeft: { fadeRatio: 0.4 }
        }
      }
    };
  }

  const serversContainer = document.getElementById('servers-container');
  const statusSummaryContainer = document.getElementById('servers-status-summary');
  const isDashboard = !!serversContainer;
  const panelStatusCards = document.querySelectorAll('.service-button .server-status-card');

  if (isDashboard) {
    SERVERS.forEach(s => serversContainer.insertAdjacentHTML('beforeend', serverSectionHTML(s)));
    if (statusSummaryContainer) SERVERS.forEach(s => statusSummaryContainer.insertAdjacentHTML('beforeend', statusSummaryHTML(s)));
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

  const states = {};
  const inflightByUrl = new Map();
  const GLOBAL = { intervalId: null, cadenceMs: CFG.POLL_OK_MS };

  function stateFor(s) {
    const ls = (k) => `${s.id}_${k}`;
    if (states[s.id]) return states[s.id];
    const st = states[s.id] = {
      cpuHistory: JSON.parse(localStorage.getItem(ls('cpuHistory'))) || [],
      ramHistory: JSON.parse(localStorage.getItem(ls('ramHistory'))) || [],
      netDownHistory: JSON.parse(localStorage.getItem(ls('netDownHistory'))) || [],
      netUpHistory: JSON.parse(localStorage.getItem(ls('netUpHistory'))) || [],
      charts: {},
      retryCount: 0,
      isConnected: false,
      disksInitialized: false,
      diskElements: {},
      lastTop: { cpu: null, ram: null, down: null, up: null, storage: null },
      elements: {
        cpuText: document.getElementById(`${s.id}-cpu-value-text`),
        ramText: document.getElementById(`${s.id}-ram-value-text`),
        netDownEl: document.getElementById(`${s.id}-network-down`),
        netUpEl: document.getElementById(`${s.id}-network-up`),
        storageText: document.getElementById(`${s.id}-storage-total-text`),
        loading: document.getElementById(`${s.id}-loading-disks`),
        storageList: document.getElementById(`${s.id}-storage-list`),
        overlay: document.getElementById(`${s.id}-grid-overlay`)
      },
      persistTick: 0,
      backoffMs: 0,
      nextAllowedAt: 0,
      controller: null
    };
    return st;
  }

  if (isDashboard) {
    SERVERS.forEach(s => {
      const snap = loadSession(`lastStats_${s.id}`);
      if (snap) paintStats(s, stateFor(s), snap, false);
      initCharts(s);
    });
    tickAll();
    GLOBAL.intervalId = setInterval(tickAll, GLOBAL.cadenceMs);
  }

  function saveHistory(s, st) {
    const ls = k => `${s.id}_${k}`;
    localStorage.setItem(ls('cpuHistory'), JSON.stringify(st.cpuHistory));
    localStorage.setItem(ls('ramHistory'), JSON.stringify(st.ramHistory));
    localStorage.setItem(ls('netDownHistory'), JSON.stringify(st.netDownHistory));
    localStorage.setItem(ls('netUpHistory'), JSON.stringify(st.netUpHistory));
  }

  function patternFill(mainColor, opts) {
    let w = 0, h = 0, p = null;
    return ({ chart }) => {
      const a = chart.chartArea;
      if (!a) return makeAlpha(mainColor, 0.25);
      const aw = Math.max(1, a.right - a.left);
      const ah = Math.max(1, a.bottom - a.top);
      if (!p || w !== aw || h !== ah) { w = aw; h = ah; p = createBiaxialFillPattern(chart, a, mainColor, opts); }
      if (p && p.setTransform) p.setTransform(new DOMMatrix().translate(a.left, a.top));
      return p;
    };
  }

  function initCharts(s) {
    if (!window.Chart) return;
    const st = stateFor(s);
    const cpuCanvas = document.getElementById(`${s.id}-cpuChart`);
    const ramCanvas = document.getElementById(`${s.id}-ramChart`);
    const netCanvas = document.getElementById(`${s.id}-networkChart`);
    if (!cpuCanvas || !ramCanvas || !netCanvas) return;

    const cpuCfg = createChartConfig(CPU_COLOR);
    cpuCfg.data.datasets[0].backgroundColor = patternFill(CPU_COLOR, { topAlpha: 0.25, fadeRatio: 0.4 });
    st.charts.cpu = new Chart(cpuCanvas, cpuCfg);

    const ramCfg = createChartConfig(RAM_COLOR);
    ramCfg.data.datasets[0].backgroundColor = patternFill(RAM_COLOR, { topAlpha: 0.25, fadeRatio: 0.4 });
    st.charts.ram = new Chart(ramCanvas, ramCfg);

    const netCfg = createChartConfig(DOWNLOAD_COLOR);
    netCfg.data.datasets[0].label = 'Download';
    netCfg.data.datasets[0].backgroundColor = patternFill(DOWNLOAD_COLOR, { topAlpha: 0.25, fadeRatio: 0.4 });
    netCfg.data.datasets.push({
      ...netCfg.data.datasets[0],
      label: 'Upload',
      borderColor: UPLOAD_COLOR,
      backgroundColor: patternFill(UPLOAD_COLOR, { topAlpha: 0.25, fadeRatio: 0.4 }),
      pointBackgroundColor: UPLOAD_COLOR
    });
    netCfg.options.scales.y.max = undefined;
    netCfg.options.scales.y.suggestedMax = 10;
    netCfg.options.plugins.tooltip.displayColors = true;
    st.charts.net = new Chart(netCanvas, netCfg);

    if (st.cpuHistory.length) seedChart(st.charts.cpu, [st.cpuHistory]);
    if (st.ramHistory.length) seedChart(st.charts.ram, [st.ramHistory]);
    if (st.netDownHistory.length || st.netUpHistory.length) seedChart(st.charts.net, [st.netDownHistory, st.netUpHistory]);
  }

  function seedChart(chart, datasets) {
    if (!chart) return;
    const n = datasets[0]?.length || 0;
    chart.data.labels = Array(n).fill('');
    datasets.forEach((ds, i) => { chart.data.datasets[i].data = ds; });
    chart.update('none');
  }

  function appendPoint(chart, dsIndex, value, max) {
    if (!chart) return;
    const ds = chart.data.datasets[dsIndex];
    ds.data.push(value);
    if (ds.data.length > max) ds.data.shift();
    if (chart.data.labels.length < ds.data.length) chart.data.labels.push('');
    if (chart.data.labels.length > ds.data.length) chart.data.labels.shift();
    chart.update('none');
  }

  function fetchJSON(url, { timeout = CFG.FETCH_TIMEOUT_MS, signal } = {}) {
    const existing = inflightByUrl.get(url);
    if (existing) return existing;
    const ctrl = new AbortController();
    const outerSignal = signal;
    const onAbort = () => ctrl.abort();
    if (outerSignal) outerSignal.addEventListener('abort', onAbort, { once: true });
    const timeoutId = setTimeout(() => ctrl.abort(), timeout);
    const p = fetch(url, { method: 'GET', signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => {
        clearTimeout(timeoutId);
        inflightByUrl.delete(url);
        if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
      });
    inflightByUrl.set(url, p);
    return p;
  }

  function updateAPIStatus(s, status, message) {
    const ind = document.getElementById(`${s.id}-status-indicator`);
    const txt = document.getElementById(`${s.id}-status-text`);
    const chip = document.getElementById(`${s.id}-api-status`);
    const section = document.getElementById(`${s.id}-section`);
    const mobileTile = document.getElementById(`${s.id}-mobile-tile`);
    const mobileTxt = document.getElementById(`${s.id}-mobile-tile-text`);
    const cssColor = STATUS_COLOR[status] || STATUS_COLOR.error;

    scheduleWrite(() => {
      if (ind && txt) { ind.className = 'status-indicator'; txt.className = 'status-text'; ind.classList.add(status); txt.classList.add(status); setText(txt, message); }
      if (chip) { chip.className = 'api-status'; chip.classList.add(status); chip.style.setProperty('--server-status-color', cssColor); }
      if (section) { section.classList.remove('connected', 'error', 'connecting'); section.classList.add(status); section.style.setProperty('--server-status-color', cssColor); }
      if (mobileTile) {
        const icon = mobileTile.querySelector('.tile-icon');
        if (mobileTxt) setText(mobileTxt, status === 'error' ? 'Hors ligne' : status === 'connecting' ? 'Connexion…' : 'Connecté');
        if (icon) icon.textContent = status === 'connected' ? '✅' : status === 'error' ? '⚠️' : '⏳';
        mobileTile.setAttribute('aria-hidden', status === 'connected' ? 'true' : 'false');
      }
    });
  }

  function tickAll() {
    const now = Date.now();
    SERVERS.forEach(s => {
      const st = stateFor(s);
      if (st.nextAllowedAt && now < st.nextAllowedAt) return;
      if (st.controller) { try { st.controller.abort(); } catch {} }
      st.controller = new AbortController();
      if (!st.isConnected && st.retryCount === 0) updateAPIStatus(s, 'connecting', 'Connexion…');
      fetchJSON(s.api, { timeout: CFG.FETCH_TIMEOUT_MS, signal: st.controller.signal })
        .then(stats => {
          st.retryCount = 0; st.isConnected = true; st.backoffMs = 0; st.nextAllowedAt = 0;
          updateAPIStatus(s, 'connected', 'Connecté');
          persistSession(`lastStats_${s.id}`, stats);
          paintStats(s, st, stats, true);
        })
        .catch(() => {
          st.retryCount++;
          st.isConnected = false;
          updateAPIStatus(s, 'error', `Erreur – Retry ${st.retryCount}`);
          st.backoffMs = Math.min(CFG.MAX_BACKOFF_MS, st.backoffMs ? st.backoffMs * 2 : CFG.INITIAL_BACKOFF_MS);
          st.nextAllowedAt = Date.now() + st.backoffMs;
        });
    });
  }

  function paintStats(s, st, stats, seedChartsOnFirst) {
    const down = +stats?.network?.download_mbps || 0;
    const up = +stats?.network?.upload_mbps || 0;
    const cpu = +stats?.cpu?.percent || 0;
    const ram = +stats?.ram?.percent || 0;

    st.cpuHistory.push(cpu); if (st.cpuHistory.length > CFG.MAX_HISTORY) st.cpuHistory.shift();
    st.ramHistory.push(ram); if (st.ramHistory.length > CFG.MAX_HISTORY) st.ramHistory.shift();
    st.netDownHistory.push(down); if (st.netDownHistory.length > CFG.MAX_HISTORY) st.netDownHistory.shift();
    st.netUpHistory.push(up); if (st.netUpHistory.length > CFG.MAX_HISTORY) st.netUpHistory.shift();

    if (st.charts.cpu && st.charts.ram && st.charts.net) {
      appendPoint(st.charts.cpu, 0, cpu, CFG.MAX_HISTORY);
      appendPoint(st.charts.ram, 0, ram, CFG.MAX_HISTORY);
      appendPoint(st.charts.net, 0, down, CFG.MAX_HISTORY);
      appendPoint(st.charts.net, 1, up, CFG.MAX_HISTORY);
    } else if (seedChartsOnFirst) {
      setTimeout(() => paintStats(s, st, stats, false), 0);
    }

    st.persistTick = (st.persistTick + 1) % 3;
    if (st.persistTick === 0) saveHistory(s, st);

    const { cpuText, ramText, netDownEl, netUpEl, storageText, loading } = st.elements;
    const cpuTxt = `${cpu.toFixed(1)}%`;
    const ramTxt = `${ram.toFixed(1)}%`;
    const downTxt = `↓ ${down.toFixed(1)}`;
    const upTxt = `↑ ${up.toFixed(1)}`;
    const storTxt = `${stats.storage_total_used} To`;

    scheduleWrite(() => {
      if (st.lastTop.cpu !== cpuTxt) { setText(cpuText, cpuTxt); st.lastTop.cpu = cpuTxt; }
      if (st.lastTop.ram !== ramTxt) { setText(ramText, ramTxt); st.lastTop.ram = ramTxt; }
      if (st.lastTop.down !== downTxt) { setText(netDownEl, downTxt); st.lastTop.down = downTxt; }
      if (st.lastTop.up !== upTxt) { setText(netUpEl, upTxt); st.lastTop.up = upTxt; }
      if (st.lastTop.storage !== storTxt) { setText(storageText, storTxt); st.lastTop.storage = storTxt; }
      if (loading) loading.style.display = 'none';
    });

    if (Array.isArray(stats.disks)) updateDisksUI(s, st, stats.disks);
  }

  function updateDisksUI(s, st, disks) {
    const storageList = st.elements.storageList; if (!storageList) return;
    const healthy = disks.filter(d => !d.error);
    const currentKeys = Object.keys(st.diskElements || {});
    const needRebuild = !st.disksInitialized || healthy.length !== currentKeys.length;

    if (needRebuild) {
      scheduleWrite(() => {
        storageList.innerHTML = healthy.map(d => diskEntryHTML(d, s.id)).join('');
        st.diskElements = {};
        for (const d of healthy) {
          const sid = `${s.id}-disk-${sanitizeId(d.name)}`;
          const root = storageList.querySelector(`#${sid}`);
          if (!root) continue;
          st.diskElements[d.name] = {
            root,
            used:  root.querySelector('.disk-value .used'),
            total: root.querySelector('.disk-value .total'),
            bar:   root.querySelector('.progress-bar'),
            glow:  root.querySelector('.progress-bar-shadow'),
            lastPercent: null, lastUsed: null, lastTotal: null
          };
        }
        st.disksInitialized = true;
      });
    }

    scheduleWrite(() => {
      for (const d of healthy) {
        const el = st.diskElements[d.name]; if (!el) continue;
        const pctStr = `${d.percent}%`;
        if (el.lastPercent !== pctStr) {
          el.bar.style.width = pctStr;
          el.glow.style.width = pctStr;
          el.lastPercent = pctStr;
        }
        if (el.lastUsed !== d.used_tb) { setText(el.used, d.used_tb); el.lastUsed = d.used_tb; }
        if (el.lastTotal !== d.total_tb) { setText(el.total, d.total_tb); el.lastTotal = d.total_tb; }
      }
    });
  }

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
        cards.forEach(({ card, indicator, tooltip }) => setPanelCardStatus(card, indicator, tooltip, 'error', 'Hors ligne'));
        return;
      }
      const ping = () => fetchJSON(s.api, { timeout: 8000 })
        .then(() => cards.forEach(({ card, indicator, tooltip }) => setPanelCardStatus(card, indicator, tooltip, 'connected', 'Connecté')))
        .catch(() => cards.forEach(({ card, indicator, tooltip }) => setPanelCardStatus(card, indicator, tooltip, 'error', 'Hors ligne')));
      ping();
      setInterval(ping, CFG.PING_PANELS_MS);
    });
  }

  function setPanelCardStatus(card, indicator, tooltip, status, message) {
    const color = STATUS_COLOR[status] || STATUS_COLOR.error;
    scheduleWrite(() => {
      card.style.setProperty('--server-status-color', color);
      indicator.classList.remove('connected', 'error', 'connecting');
      indicator.classList.add(status);
      setText(tooltip, message);
      card.setAttribute('title', message);
      card.setAttribute('aria-label', message);
    });
  }

  if (isDashboard) {
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden; const target = hidden ? CFG.POLL_DOWN_MS : CFG.POLL_OK_MS;
      if (GLOBAL.cadenceMs === target) return;
      GLOBAL.cadenceMs = target;
      clearInterval(GLOBAL.intervalId);
      GLOBAL.intervalId = setInterval(tickAll, GLOBAL.cadenceMs);
      if (!hidden) tickAll();
    });
    window.addEventListener('beforeunload', () => clearInterval(GLOBAL.intervalId));
  }
});
// by Lynn with <3 cloud.lynn.paris
