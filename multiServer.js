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
            name: 'LTN-1',
            api: 'https://api.lynnternet.cloud/api/stats',
            description: 'Médias & automatisation',
            services: 'Plex, Overseerr, Radarr/Sonarr, Prowlarr, Huntarr, qBit, Bazarr'
        },
        {
            id: 'ltn2',
            name: 'LTN-2',
            api: 'https://api.lynnternet.cloud/api/stats',
            description: 'Jeux & orchestrateur',
            services: 'Pterodactyl (serveurs de jeu)'
        },
        {
            id: 'ltn3',
            name: 'LTN-3',
            api: 'https://api.lynnternet.cloud/api/stats',
            description: 'Réseau & proxy',
            services: 'Nginx VPS / reverse proxies'
        }
    ];

    const MAX_HISTORY_POINTS = 30;
    const RETRY_DELAY = 5000; // 5 s
    const MAX_RETRIES = 3;

    // ------------------------------
    // 2. Plugins & helpers (issus du script d'origine)
    // ------------------------------
    function createGradient(ctx, color) {
        const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
        const colorStart = color.replace('rgb', 'rgba').replace(')', ', 0.4)');
        const colorEnd   = color.replace('rgb', 'rgba').replace(')', ', 0.03)');
        gradient.addColorStop(0, colorStart);
        gradient.addColorStop(1, colorEnd);
        return gradient;
    }

    // ---- Glow Line Plugin ----
    const glowLinePlugin = {
        id: 'glow',
        beforeDatasetDraw(chart, args, options) {
            const { ctx } = chart;
            ctx.save();

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
            ctx.shadowBlur    = baseBlur * (window.devicePixelRatio || 1);
            ctx.shadowColor   = color;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        },
        afterDatasetDraw(chart) {
            chart.ctx.restore();
        }
    };
    Chart.register(glowLinePlugin);

    // ---- Fade Left Plugin ----
    const fadeLeftPlugin = {
        id: 'fadeLeft',
        beforeDatasetsDraw(chart, args, pluginOptions) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;

            const fadeRatio = (pluginOptions && pluginOptions.fadeRatio) || 0.4;

            chart.data.datasets.forEach(dataset => {
                if (!dataset._baseBorderColor) {
                    dataset._baseBorderColor = dataset.borderColor;
                }
                const baseColor = dataset._baseBorderColor;
                if (typeof baseColor !== 'string') return;

                const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
                const transparentColor = baseColor.replace('rgb', 'rgba').replace(')', ',0)');
                gradient.addColorStop(0, transparentColor);
                gradient.addColorStop(fadeRatio, baseColor);

                dataset.borderColor          = gradient;
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

    // Injecte les sections complètes
    SERVERS.forEach(server => {
        serversContainer.insertAdjacentHTML('beforeend', createServerSectionHTML(server));
    });

    // Injecte la barre de statut sous le titre principal
    if (statusSummaryContainer) {
        SERVERS.forEach(server => {
            statusSummaryContainer.insertAdjacentHTML('beforeend', createStatusSummaryHTML(server));
        });
    }

    function createServerSectionHTML(server) {
        return `
            <section class="server-section" id="${server.id}-section">
                <header class="server-header">
                    <div class="server-header-left">
                        <h2 class="server-title">${server.name}</h2>
                        <p class="server-subtitle">${server.description} · <span class="server-services">${server.services}</span></p>
                    </div>
                    <div class="api-status" id="${server.id}-api-status" aria-live="polite">
                        <div class="status-indicator" id="${server.id}-status-indicator"></div>
                        <span class="status-text" aria-hidden="true">${server.name}</span>
                        <span class="status-text" id="${server.id}-status-text">Connexion...</span>
                    </div>
                </header>
                <div class="status-grid">
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

    /* ---- Barre de résumé de statut ---- */
    function createStatusSummaryHTML(server) {
        return `
            <a class="server-summary-link" href="#${server.id}-section" aria-label="Aller au serveur ${server.name}">
                <div class="api-status" id="${server.id}-status-summary">
                    <div class="status-indicator" id="${server.id}-summary-indicator"></div>
                    <span class="status-text server-summary-name">${server.name}</span>
                    <span class="status-text" id="${server.id}-summary-text">Connexion...</span>
                </div>
            </a>
        `;
    }

    // ------------------------------
    // 4. États par serveur
    // ------------------------------
    const states = {};

    SERVERS.forEach(server => {
        const ls = (key) => `${server.id}_${key}`; // utilitaire clé localStorage
        states[server.id] = {
            cpuHistory:     JSON.parse(localStorage.getItem(ls('cpuHistory')))     || [],
            ramHistory:     JSON.parse(localStorage.getItem(ls('ramHistory')))     || [],
            netDownHistory: JSON.parse(localStorage.getItem(ls('netDownHistory'))) || [],
            netUpHistory:   JSON.parse(localStorage.getItem(ls('netUpHistory')))   || [],
            charts: {},
            retryCount: 0,
            isConnected: false,
            intervalId: null
        };

        // initialise les graphiques et démarre le polling
        initializeCharts(server);
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
            console.warn(`[multiServer] Impossible de trouver les canvas pour ${server.id}`);
            return;
        }

        // CPU
        const cpuCfg = createChartConfig(cpuColor);
        cpuCfg.data.datasets[0].backgroundColor = createGradient(cpuCanvas.getContext('2d'), cpuColor);
        state.charts.cpu = new Chart(cpuCanvas, cpuCfg);

        // RAM
        const ramCfg = createChartConfig(ramColor);
        ramCfg.data.datasets[0].backgroundColor = createGradient(ramCanvas.getContext('2d'), ramColor);
        state.charts.ram = new Chart(ramCanvas, ramCfg);

        // Network
        const netCfg = createChartConfig(downloadColor);
        netCfg.data.datasets[0].label = 'Download';
        netCfg.data.datasets[0].backgroundColor = createGradient(netCanvas.getContext('2d'), downloadColor);
        netCfg.data.datasets.push({
            ...netCfg.data.datasets[0],
            label: 'Upload',
            borderColor: uploadColor,
            backgroundColor: createGradient(netCanvas.getContext('2d'), uploadColor),
            pointBackgroundColor: uploadColor
        });
        netCfg.options.scales.y.max = undefined;
        netCfg.options.scales.y.suggestedMax = 10;
        netCfg.options.plugins.tooltip.displayColors = true;
        state.charts.net = new Chart(netCanvas, netCfg);

        // afficher l'historique si existant
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
        chart.update('none');
    }

    function updateAPIStatus(server, status, message) {
        const indicator        = document.getElementById(`${server.id}-status-indicator`);
        const text             = document.getElementById(`${server.id}-status-text`);
        const apiStatus        = document.getElementById(`${server.id}-api-status`);
        const summaryIndicator = document.getElementById(`${server.id}-summary-indicator`);
        const summaryText      = document.getElementById(`${server.id}-summary-text`);

        const apply = (ind, txt) => {
            if (!ind || !txt) return;
            ind.className = 'status-indicator';
            txt.className = 'status-text';
            if (status !== 'connecting') {
                ind.classList.add(status);
                txt.classList.add(status);
            }
            txt.textContent = message;
        };

        apply(indicator, text);
        apply(summaryIndicator, summaryText);

        // Appliquer l'état au conteneur API (effet glass + gradient)
        if (apiStatus) {
            apiStatus.className = 'api-status';
            if (status !== 'connecting') {
                apiStatus.classList.add(status);
            }
        }

        // Ajouter l'état sur la puce résumé (api-status sous le titre)
        const summaryChip = document.getElementById(`${server.id}-status-summary`);
        if (summaryChip) {
            summaryChip.classList.remove('connected', 'error', 'connecting');
            if (status !== 'connecting') summaryChip.classList.add(status);
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

            // Succès
            state.retryCount  = 0;
            state.isConnected = true;
            updateAPIStatus(server, 'connected', 'Connecté');

            const downMbps = stats.network.download_mbps;
            const upMbps   = stats.network.upload_mbps;

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

            const cpuText   = document.getElementById(`${server.id}-cpu-value-text`);
            const ramText   = document.getElementById(`${server.id}-ram-value-text`);
            const netDownEl = document.getElementById(`${server.id}-network-down`);
            const netUpEl   = document.getElementById(`${server.id}-network-up`);
            const storageText = document.getElementById(`${server.id}-storage-total-text`);

            if (cpuText)   cpuText.textContent   = `${stats.cpu.percent.toFixed(1)}%`;
            if (ramText)   ramText.textContent   = `${stats.ram.percent.toFixed(1)}%`;
            if (netDownEl) netDownEl.textContent = `↓ ${downMbps.toFixed(1)}`;
            if (netUpEl)   netUpEl.textContent   = `↑ ${upMbps.toFixed(1)}`;
            if (storageText) storageText.textContent = `${stats.storage_total_used} To`;

            // disques
            const loading = document.getElementById(`${server.id}-loading-disks`);
            if (loading) loading.style.display = 'none';
            const storageList = document.getElementById(`${server.id}-storage-list`);
            if (storageList) {
                storageList.innerHTML = stats.disks.map(createDiskEntryHTML).join('');
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
            state.intervalId = setInterval(() => updateStats(server), 10000); // 10 s
        }
    }

    function showErrorState(server) {
        const storageList = document.getElementById(`${server.id}-storage-list`);
        if (storageList) {
            storageList.innerHTML = `
                <div class="error-state">
                    <div class="error-icon">⚠️</div>
                    <div>Impossible de récupérer les données</div>
                    <button class="retry-button" onclick="retryConnection('${server.id}')">Réessayer</button>
                </div>`;
        }
    }

    // Retry manuel accessible globalement
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

    function createDiskEntryHTML(disk) {
        if (disk.error) {
            console.warn(`Disk error for ${disk.name}: ${disk.error}`);
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

    // ---------- Effet spotlight 3D (inchangé) ----------
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
