// multiServer.js – gestion multi-serveurs des statistiques

document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------
    // 1. Configuration
    // ------------------------------
    const SERVERS = [
        // Pour le moment, tous les serveurs pointent vers la même API.
        // Mettez à jour `api` lorsque vos endpoints seront prêts.
        {
            id: 'ltn1',
            name: 'ltn1',
            api: 'https://api.lynnternet.cloud/api/stats',
            description: 'Plex media server',
            services: ''
        },
        {
            id: 'ltn2',
            name: 'ltn2',
            api: '',
            description: 'Game servers',
            services: ''
        },
        {
            id: 'ltn0',
            name: 'ltn0',
            api: '',
            description: 'VPS',
            services: ''
        }
    ];

    const MAX_HISTORY_POINTS = 30;
    const RETRY_DELAY = 5000; // 5 s
    const MAX_RETRIES = 3;

    // ------------------------------
    // 2. Plugins & helpers (issus du script d'origine)
    // ------------------------------
    function makeAlpha(color, alpha) {
        return color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
    }

    function createBiaxialFillPattern(chart, area, color, options = {}) {
        const topAlpha = options.topAlpha ?? 0.25;   // opacité en haut
        const fadeRatio = options.fadeRatio ?? 0.4;  // position où le fade horizontal atteint 100%
        const off = document.createElement('canvas');
        // Utiliser la taille complète du canvas pour éviter des décalages de pattern [oai_citation:5‡chartjs.org](https://www.chartjs.org/docs/latest/samples/advanced/linear-gradient.html#:~:text=chartWidth%20%3D%20chartArea.right%20,return%20gradient%3B)
        off.width = chart.canvas.width;
        off.height = chart.canvas.height;
        const g = off.getContext('2d');

        // Dégradé vertical (haut -> bas)
        const vGrad = g.createLinearGradient(area.left, area.top, area.left, area.bottom);
        vGrad.addColorStop(0, makeAlpha(color, topAlpha));
        vGrad.addColorStop(1, makeAlpha(color, 0));
        g.fillStyle = vGrad;
        g.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);

        // Masque horizontal (gauche -> droite)
        g.globalCompositeOperation = 'destination-in';
        const hMask = g.createLinearGradient(area.left, area.top, area.right, area.top);
        hMask.addColorStop(0, 'rgba(0,0,0,0)');
        hMask.addColorStop(Math.min(Math.max(fadeRatio, 0), 1), 'rgba(0,0,0,1)');
        hMask.addColorStop(1, 'rgba(0,0,0,1)');
        g.fillStyle = hMask;
        g.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);

        return chart.ctx.createPattern(off, 'no-repeat');
    }

    // ---- Glow Line Plugin (ombre portée sous la courbe) ----
    const glowLinePlugin = {
        id: 'glow',
        beforeDatasetDraw(chart, args, options) {
            const { ctx } = chart;
            ctx.save();
            // Déterminer la couleur de l'ombre (couleur de la ligne)
            let color = options?.shadowColor;
            if (!color) {
                const dataSet = chart.data.datasets[args.index];
                if (typeof dataSet._baseBorderColor === 'string') {
                    color = dataSet._baseBorderColor;
                } else if (typeof dataSet.borderColor === 'string') {
                    color = dataSet.borderColor;
                } else {
                    color = '#fff';
                }
            }
            const baseBlur = options?.shadowBlur ?? 12;
            ctx.shadowBlur = baseBlur * (window.devicePixelRatio || 1);
            ctx.shadowColor = color;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        },
        afterDatasetDraw(chart) {
            chart.ctx.restore();
        }
    };
    Chart.register(glowLinePlugin);

    // ---- Fade Left Plugin (fondu horizontal en entrée de courbe) ----
    const fadeLeftPlugin = {
        id: 'fadeLeft',
        beforeDatasetsDraw(chart, args, pluginOptions) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const fadeRatio = pluginOptions?.fadeRatio ?? 0.4;
            chart.data.datasets.forEach(dataset => {
                // Sauvegarder la couleur de base une fois
                if (!dataset._baseBorderColor) {
                    dataset._baseBorderColor = dataset.borderColor;
                }
                const baseColor = dataset._baseBorderColor;
                if (typeof baseColor !== 'string') return;
                // Créer un dégradé transparent -> couleur sur la largeur du graphique
                const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
                const transparentColor = baseColor.replace('rgb', 'rgba').replace(')', ',0)');
                gradient.addColorStop(0, transparentColor);
                gradient.addColorStop(fadeRatio, baseColor);
                // Appliquer le dégradé comme bordure (point de départ transparent à gauche)
                dataset.borderColor = gradient;
                dataset.pointBackgroundColor = baseColor;
            });
        }
    };
    Chart.register(fadeLeftPlugin);

    function createChartConfig(mainColor) {
        return {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
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
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { color: '#a0a0a0' },
                        grid: { color: 'rgba(255,255,255,0.08)', drawBorder: false }
                    },
                    x: {
                        ticks: { display: false },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(12, 12, 12, 0.5)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 10,
                        cornerRadius: 16,
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1
                    },
                    glow:     { shadowBlur: 32 },
                    fadeLeft: { fadeRatio: 0.4 }
                }
            }
        };
    }

    // ------------------------------
    // 3. Génération du DOM par serveur
    // ------------------------------
    const serversContainer = document.getElementById('servers-container');
    const statusSummaryContainer = document.getElementById('servers-status-summary');

    if (!serversContainer) {
        console.error('[multiServer] Élément #servers-container introuvable dans la page.');
        return; // stop early
    }

    // Injecte dynamiquement la section HTML pour chaque serveur
    SERVERS.forEach(server => {
        serversContainer.insertAdjacentHTML('beforeend', createServerSectionHTML(server));
    });
    // Barre de résumé de statut sous le titre principal
    if (statusSummaryContainer) {
        SERVERS.forEach(server => {
            statusSummaryContainer.insertAdjacentHTML('beforeend', createStatusSummaryHTML(server));
        });
    }

    function createServerSectionHTML(server) {
        return `
            <section class="server-section" id="${server.id}-section">
                <header class="server-header">
                    <h2 class="server-title">${server.name}</h2>
                    <p class="server-subtitle">${server.description}</br>
                        <!-- <span class="server-services">${server.services}</span> -->
                    </p>
                </header>
                <div class="status-grid" id="${server.id}-status-grid">
                    <div class="grid-overlay" id="${server.id}-grid-overlay" aria-live="polite" aria-hidden="true">
                        <div class="overlay-content">
                            <div class="error-icon">⚠️</div>
                            <div class="overlay-text">Impossible de récupérer les données</div>
                            <button class="retry-button" data-server-id="${server.id}">Réessayer</button>
                        </div>
                    </div>
                    <!-- CPU -->
                    <div class="stat-card">
                        <div class="card-title">
                            <h3>CPU</h3>
                            <span id="${server.id}-cpu-value-text" class="card-value-text"></span>
                        </div>
                        <div class="chart-container">
                            <canvas id="${server.id}-cpuChart"></canvas>
                        </div>
                    </div>
                    <!-- RAM -->
                    <div class="stat-card">
                        <div class="card-title">
                            <h3>RAM</h3>
                            <span id="${server.id}-ram-value-text" class="card-value-text"></span>
                        </div>
                        <div class="chart-container">
                            <canvas id="${server.id}-ramChart"></canvas>
                        </div>
                    </div>
                    <!-- Réseau -->
                    <div class="stat-card">
                        <div class="card-title">
                            <h3>Réseau</h3>
                            <div class="card-value-network">
                                <span class="network-rates">
                                    <span id="${server.id}-network-down">↓ 0.0</span>
                                    <span id="${server.id}-network-up">↑ 0.0</span>
                                </span>
                                <span class="network-unit">Mbps</span>
                            </div>
                        </div>
                        <div class="chart-container">
                            <canvas id="${server.id}-networkChart"></canvas>
                        </div>
                    </div>
                    <!-- Stockage -->
                    <div class="stat-card">
                        <div class="card-title">
                            <h3>Stockage</h3>
                            <span id="${server.id}-storage-total-text" class="card-value-text"></span>
                        </div>
                        <div id="${server.id}-storage-list" class="storage-list-container">
                            <div class="loading-state" id="${server.id}-loading-disks">
                                <div class="loading-spinner"></div>
                                <span>Chargement des disques...</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    function createStatusSummaryHTML(server) {
        return `
            <a class="server-summary-link" href="#${server.id}-section" aria-label="Aller au serveur ${server.name}">
                <div class="api-status" id="${server.id}-api-status" aria-live="polite">
                    <div class="status-indicator" id="${server.id}-status-indicator"></div>
                    <span class="status-text" aria-hidden="true">${server.name}</span>
                    <span class="status-text" id="${server.id}-status-text">Connexion...</span>
                </div>
            </a>
        `;
    }

    // ------------------------------
    // 4. États par serveur (stockage en mémoire + localStorage)
    // ------------------------------
    const states = {};

    SERVERS.forEach(server => {
        const ls = (key) => `${server.id}_${key}`; // clé localStorage utilitaire
        states[server.id] = {
            cpuHistory:     JSON.parse(localStorage.getItem(ls('cpuHistory'))) || [],
            ramHistory:     JSON.parse(localStorage.getItem(ls('ramHistory'))) || [],
            netDownHistory: JSON.parse(localStorage.getItem(ls('netDownHistory'))) || [],
            netUpHistory:   JSON.parse(localStorage.getItem(ls('netUpHistory'))) || [],
            charts: {},
            retryCount: 0,
            isConnected: false,
            intervalId: null,
            disksInitialized: false,      // indicateur si la liste des disques a déjà été initialisée
            diskElements: {}             // références vers les éléments DOM de chaque disque
        };

        // Initialise les graphiques et commence le polling périodique
        initializeCharts(server);
        // Mise en cache des éléments fréquemment utilisés du DOM (pour optimiser les accès)
        const serverId = server.id;
        const els = {
            cpuText: document.getElementById(`${serverId}-cpu-value-text`),
            ramText: document.getElementById(`${serverId}-ram-value-text`),
            netDownEl: document.getElementById(`${serverId}-network-down`),
            netUpEl: document.getElementById(`${serverId}-network-up`),
            storageText: document.getElementById(`${serverId}-storage-total-text`),
            loading: document.getElementById(`${serverId}-loading-disks`),
            storageList: document.getElementById(`${serverId}-storage-list`),
            overlay: document.getElementById(`${serverId}-grid-overlay`)
        };
        states[server.id].elements = els;

        updateStats(server); // premier appel immédiat
        states[server.id].intervalId = setInterval(() => updateStats(server), 2000);
    });

    function saveHistoryToStorage(server, state) {
        const ls = (key) => `${server.id}_${key}`;
        localStorage.setItem(ls('cpuHistory'),     JSON.stringify(state.cpuHistory));
        localStorage.setItem(ls('ramHistory'),     JSON.stringify(state.ramHistory));
        localStorage.setItem(ls('netDownHistory'), JSON.stringify(state.netDownHistory));
        localStorage.setItem(ls('netUpHistory'),   JSON.stringify(state.netUpHistory));
    }

    // ------------------------------
    // 5. Fonctions par serveur
    // ------------------------------
    function initializeCharts(server) {
        const state = states[server.id];

        const cpuColor      = 'rgb(255, 0, 166)';
        const ramColor      = 'rgb(200, 55, 255)';
        const downloadColor = 'rgb(55, 159, 255)';
        const uploadColor   = 'rgb(255, 99, 132)';

        const cpuCanvas = document.getElementById(`${server.id}-cpuChart`);
        const ramCanvas = document.getElementById(`${server.id}-ramChart`);
        const netCanvas = document.getElementById(`${server.id}-networkChart`);

        if (!cpuCanvas || !ramCanvas || !netCanvas) {
            console.warn(`[multiServer] Canvas introuvable pour ${server.id}`);
            return;
        }

        // CPU
        // Optimisation du gradient de fond (pattern en cache)
        let cpuPattern;
        let cpuPatternWidth = 0, cpuPatternHeight = 0;
        const cpuCfg = createChartConfig(cpuColor);
        cpuCfg.data.datasets[0].backgroundColor = (ctx) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return makeAlpha(cpuColor, 0.25);
            if (!cpuPattern || cpuPatternWidth !== chart.canvas.width || cpuPatternHeight !== chart.canvas.height) {
                cpuPatternWidth = chart.canvas.width;
                cpuPatternHeight = chart.canvas.height;
                cpuPattern = createBiaxialFillPattern(chart, area, cpuColor, { topAlpha: 0.25, fadeRatio: 0.4 });
            }
            return cpuPattern;
        };
        state.charts.cpu = new Chart(cpuCanvas, cpuCfg);

        // RAM
        // Optimisation du gradient de fond (pattern en cache)
        let ramPattern;
        let ramPatternWidth = 0, ramPatternHeight = 0;
        const ramCfg = createChartConfig(ramColor);
        ramCfg.data.datasets[0].backgroundColor = (ctx) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return makeAlpha(ramColor, 0.25);
            if (!ramPattern || ramPatternWidth !== chart.canvas.width || ramPatternHeight !== chart.canvas.height) {
                ramPatternWidth = chart.canvas.width;
                ramPatternHeight = chart.canvas.height;
                ramPattern = createBiaxialFillPattern(chart, area, ramColor, { topAlpha: 0.25, fadeRatio: 0.4 });
            }
            return ramPattern;
        };
        state.charts.ram = new Chart(ramCanvas, ramCfg);

        // Network
        // Optimisation du gradient de fond (pattern en cache)
        let downloadPattern;
        let downloadPatternWidth = 0, downloadPatternHeight = 0;
        let uploadPattern;
        let uploadPatternWidth = 0, uploadPatternHeight = 0;
        const netCfg = createChartConfig(downloadColor);
        netCfg.data.datasets[0].label = 'Download';
        netCfg.data.datasets[0].backgroundColor = (ctx) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return makeAlpha(downloadColor, 0.25);
            if (!downloadPattern || downloadPatternWidth !== chart.canvas.width || downloadPatternHeight !== chart.canvas.height) {
                downloadPatternWidth = chart.canvas.width;
                downloadPatternHeight = chart.canvas.height;
                downloadPattern = createBiaxialFillPattern(chart, area, downloadColor, { topAlpha: 0.25, fadeRatio: 0.4 });
            }
            return downloadPattern;
        };
        netCfg.data.datasets.push({
            ...netCfg.data.datasets[0],
            label: 'Upload',
            borderColor: uploadColor,
            backgroundColor: (ctx) => {
                const { chart } = ctx;
                const area = chart.chartArea;
                if (!area) return makeAlpha(uploadColor, 0.25);
                if (!uploadPattern || uploadPatternWidth !== chart.canvas.width || uploadPatternHeight !== chart.canvas.height) {
                    uploadPatternWidth = chart.canvas.width;
                    uploadPatternHeight = chart.canvas.height;
                    uploadPattern = createBiaxialFillPattern(chart, area, uploadColor, { topAlpha: 0.25, fadeRatio: 0.4 });
                }
                return uploadPattern;
            },
            pointBackgroundColor: uploadColor
        });
        // Ajuster l'échelle du graphique réseau (valeurs max suggérées)
        netCfg.options.scales.y.max = undefined;
        netCfg.options.scales.y.suggestedMax = 10;
        netCfg.options.plugins.tooltip.displayColors = true;
        state.charts.net = new Chart(netCanvas, netCfg);

        // Afficher l'historique sauvegardé s'il existe (pré-remplit les graphiques)
        if (state.cpuHistory.length) {
            updateChart(state.charts.cpu, [state.cpuHistory]);
            updateChart(state.charts.ram, [state.ramHistory]);
            updateChart(state.charts.net, [state.netDownHistory, state.netUpHistory]);
        }
    }

    function updateChart(chart, datasets) {
        if (!chart) return;
        const n = datasets[0].length;
        chart.data.labels = Array(n).fill('');
        datasets.forEach((ds, i) => {
            chart.data.datasets[i].data = ds;
        });
        chart.update('none'); // mise à jour instantanée (sans animation) pour alléger le rendu
    }

    function updateAPIStatus(server, status, message) {
        const indicator = document.getElementById(`${server.id}-status-indicator`);
        const text      = document.getElementById(`${server.id}-status-text`);
        const apiStatus = document.getElementById(`${server.id}-api-status`);
        const section   = document.getElementById(`${server.id}-section`);

        // mapping couleur -> variable CSS (pour effets de style)
        const varMap = {
            connected: '#00ff88',
            error: '#ff4444',
            connecting: '#ffd866'
        };
        const cssColor = varMap[status];

        const apply = (ind, txt) => {
            if (!ind || !txt) return;
            ind.className = 'status-indicator';
            txt.className = 'status-text';
            ind.classList.add(status);
            txt.classList.add(status);
            txt.textContent = message;
        };

        apply(indicator, text);

        // Appliquer le statut au conteneur API (effet verre + gradient de fond)
        if (apiStatus) {
            apiStatus.className = 'api-status';
            apiStatus.classList.add(status);
            if (cssColor) apiStatus.style.setProperty('--server-status-color', cssColor);
        }

        // Appliquer la classe de statut à la section du serveur (pour thèmes CSS)
        if (section) {
            section.classList.remove('connected', 'error', 'connecting');
            section.classList.add(status);
            // Définir la variable CSS (couleur) sur la section, si besoin en fallback
            if (cssColor) section.style.setProperty('--server-status-color', cssColor);
        }
    }

    function fetchWithTimeout(resource, options = {}) {
        const { timeout = 10000 } = options;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        return fetch(resource, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(id));
    }

    async function updateStats(server) {
        const state = states[server.id];
        try {
            if (!state.isConnected && state.retryCount === 0) {
                updateAPIStatus(server, 'connecting', 'Connexion...');
            }
            const response = await fetchWithTimeout(server.api, { method: 'GET', timeout: 10000 });
            if (!response.ok) {
                throw new Error(`[${server.id}] API error: ${response.status}`);
            }
            const stats = await response.json();

            // Succès de la requête
            state.retryCount = 0;
            state.isConnected = true;
            updateAPIStatus(server, 'connected', 'Connecté');

            const downMbps = stats.network.download_mbps;
            const upMbps   = stats.network.upload_mbps;

            // Mettre à jour les historiques en mémoire (et retirer l'élément le plus ancien si > MAX_HISTORY_POINTS)
            state.cpuHistory.push(stats.cpu.percent);
            if (state.cpuHistory.length > MAX_HISTORY_POINTS) state.cpuHistory.shift();
            state.ramHistory.push(stats.ram.percent);
            if (state.ramHistory.length > MAX_HISTORY_POINTS) state.ramHistory.shift();
            state.netDownHistory.push(downMbps);
            if (state.netDownHistory.length > MAX_HISTORY_POINTS) state.netDownHistory.shift();
            state.netUpHistory.push(upMbps);
            if (state.netUpHistory.length > MAX_HISTORY_POINTS) state.netUpHistory.shift();

            saveHistoryToStorage(server, state);

            // Mise à jour graphiques / valeurs texte
            updateChart(state.charts.cpu, [state.cpuHistory]);
            updateChart(state.charts.ram, [state.ramHistory]);
            updateChart(state.charts.net, [state.netDownHistory, state.netUpHistory]);

            const { cpuText, ramText, netDownEl, netUpEl, storageText } = state.elements;
            if (cpuText)   cpuText.textContent   = `${stats.cpu.percent.toFixed(1)}%`;
            if (ramText)   ramText.textContent   = `${stats.ram.percent.toFixed(1)}%`;
            if (netDownEl) netDownEl.textContent = `↓ ${downMbps.toFixed(1)}`;
            if (netUpEl)   netUpEl.textContent   = `↑ ${upMbps.toFixed(1)}`;
            if (storageText) storageText.textContent = `${stats.storage_total_used} To`;

            // Mise à jour de l'état des disques (utilisation et liste)
            const { loading, storageList } = state.elements;
            if (loading) loading.style.display = 'none';  // cacher le spinner de chargement une fois les données reçues
            if (storageList) {
                if (!state.disksInitialized || stats.disks.length !== Object.keys(state.diskElements ?? {}).length) {
                    // Première récupération ou changement dans la liste des disques
                    storageList.innerHTML = stats.disks.map(createDiskEntryHTML).join('');
                    state.diskElements = {};
                    for (const disk of stats.disks) {
                        if (disk.error) continue; // ignorer les disques en erreur dans l'affichage
                        const diskId = `disk-${disk.name.replace(/\s+/g, '-')}`;
                        const diskEl = document.getElementById(diskId);
                        if (!diskEl) continue;
                        const valueSpan = diskEl.querySelector('.disk-value');
                        const progressBar = diskEl.querySelector('.progress-bar');
                        const progressShadow = diskEl.querySelector('.progress-bar-shadow');
                        state.diskElements[disk.name] = { valueSpan, progressBar, progressShadow };
                    }
                    state.disksInitialized = true;
                } else {
                    // Mise à jour en place des valeurs pour chaque disque
                    for (const disk of stats.disks) {
                        if (disk.error) continue;
                        const elems = state.diskElements[disk.name];
                        if (!elems) continue;
                        elems.valueSpan.textContent = `${disk.used_tb} / ${disk.total_tb} To`;
                        elems.progressBar.style.width = `${disk.percent}%`;
                        elems.progressShadow.style.width = `${disk.percent}%`;
                    }
                }
            }
        } catch (err) {
            console.error(`[multiServer] Échec updateStats pour ${server.id}`, err);
            handleAPIError(server);
        }
    }

    function handleAPIError(server) {
        const state = states[server.id];
        state.retryCount++;
        state.isConnected = false;
        if (state.retryCount <= MAX_RETRIES) {
            updateAPIStatus(server, 'error', `Erreur – Retry ${state.retryCount}/${MAX_RETRIES}`);
            setTimeout(() => updateStats(server), RETRY_DELAY);
        } else {
            updateAPIStatus(server, 'error', 'Hors ligne');
            showErrorState(server);
            clearInterval(state.intervalId);
            // Ralentir le polling après échec (passage à un intervalle de 10s pour retenter)
            state.intervalId = setInterval(() => updateStats(server), 10000);
        }
    }

    function showErrorState(server) {
        // Afficher un overlay d'erreur sur la grille de stats
        const overlay = document.getElementById(`${server.id}-grid-overlay`);
        if (overlay) {
            overlay.classList.add('show');
            overlay.setAttribute('aria-hidden', 'false');
        }
        // Ne pas vider la liste des disques pour conserver le dernier état affiché
    }

    // Fonction globale de tentative manuelle de reconnexion (appelée par le bouton "Réessayer")
    window.retryConnection = function(serverId) {
        const server = SERVERS.find(s => s.id === serverId);
        if (!server) return;
        const state = states[server.id];
        state.retryCount = 0;
        updateAPIStatus(server, 'connecting', 'Connexion...');
        clearInterval(state.intervalId);
        state.intervalId = setInterval(() => updateStats(server), 2000);
        updateStats(server);
    };

    // Délégation d'événement pour le bouton "Réessayer" dans l'overlay d'erreur
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

    function createDiskEntryHTML(disk) {
        if (disk.error) {
            // Ne pas injecter de message d'erreur dans la liste pour garder la mise en page
            return '';
        }
        return `
            <div class="disk-entry" id="disk-${disk.name.replace(/\s+/g, '-')}">
                <div class="disk-info-header">
                    <span class="disk-name">${disk.name}</span>
                    <span class="disk-value">${disk.used_tb}<span style="color: var(--c-accent-primary);"> / </span>${disk.total_tb} To</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${disk.percent}%;"></div>
                    <div class="progress-bar-shadow" style="width: ${disk.percent}%;"></div>
                </div>
            </div>`;
    }

    // ---------- Effet spotlight 3D (survol des cartes) ----------
    setupSpotlightCards();

    function setupSpotlightCards() {
        const cards = document.querySelectorAll('.stat-card, .service-button');
        cards.forEach(card => {
            card.addEventListener('pointermove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const cx = x - rect.width / 2;
                const cy = y - rect.height / 2;
                const rotateX = (cy / rect.height) * -5;
                const rotateY = (cx / rect.width) * 5;
                card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                card.style.setProperty('--spotlight-x', `${x}px`);
                card.style.setProperty('--spotlight-y', `${y}px`);
                const angle = (Math.atan2(cy, cx) * 180 / Math.PI + 450) % 360;
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
});