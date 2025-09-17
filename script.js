// Configuration de l'API
const API_BASE = 'https://nodes.amadeus.bot';

// État global de l'application
const AppState = {
    currentPage: 'home',
    stats: null,
    latestBlocks: [],
    latestTransactions: [],
    currentAddress: null,
    currentAddressData: {
        balances: [],
        transactions: [],
        cursor: null
    }
};

// Utilitaires
const Utils = {
    // Formatter les nombres
    formatNumber(num) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
        return num.toString();
    },

    // Formatter les hash (tronquer)
    formatHash(hash, length = 8) {
        if (!hash) return '-';
        if (hash.length <= length * 2) return hash;
        return hash.substring(0, length) + '...' + hash.substring(hash.length - length);
    },

    // Formatter le temps relatif basé sur les slots
    formatTimeAgo(slot, currentSlot = null) {
        if (!slot) return '-';

        // Si on a le slot actuel, calculer la différence en slots
        if (currentSlot) {
            const slotDiff = currentSlot - slot;
            const minutesAgo = Math.floor(slotDiff * 0.5 / 60); // 0.5 sec par slot
            const hoursAgo = Math.floor(minutesAgo / 60);
            const daysAgo = Math.floor(hoursAgo / 24);

            if (daysAgo > 0) return `il y a ${daysAgo}j`;
            if (hoursAgo > 0) return `il y a ${hoursAgo}h`;
            if (minutesAgo > 0) return `il y a ${minutesAgo}min`;
            return 'now';
        }

        // Fallback: juste afficher le slot
        return `Slot ${slot}`;
    },

    // Convertir un slot en timestamp approximatif
    slotToTimestamp(slot) {
        if (!slot) return null;

        // Calibration basée sur une transaction connue:
        // Slot 29806536 = Sep 17, 2025 20:41:58 (selon wallet team)
        const referenceSlot = 29806536;
        const referenceTimestamp = new Date('2025-09-17T20:41:58').getTime();

        // Calcul basé sur 0.5 seconde par slot
        const slotDiff = slot - referenceSlot;
        const timestampDiff = slotDiff * 500; // 0.5 sec = 500ms per slot

        return referenceTimestamp + timestampDiff;
    },

    // Formatter une date à partir d'un slot
    formatSlotToDateTime(slot) {
        if (!slot) return '-';

        const timestamp = this.slotToTimestamp(slot);
        if (!timestamp) return `Slot ${slot}`;

        const date = new Date(timestamp);
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },

    // Copier dans le presse-papier
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copied to clipboard!');
        } catch (err) {
            console.error('Copy error:', err);
        }
    },

    // Afficher une notification toast
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? 'rgb(24, 255, 178)' : '#ff4444'};
            color: white;
            padding: 1rem 2rem;
            border-radius: 8px;
            z-index: 3000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
};

// API Calls
const API = {
    async request(endpoint) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`);
            const data = await response.json();
            if (data.error === 'ok' || data.error === ':ok' || !data.error) {
                return data;
            }
            throw new Error(data.error || 'API Error');
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    },

    // Statistiques de la chaîne
    async getStats() {
        return await this.request('/api/chain/stats');
    },

    // Dernier block
    async getTip() {
        return await this.request('/api/chain/tip');
    },

    // Blocks par hauteur
    async getBlocksByHeight(height) {
        return await this.request(`/api/chain/height_with_txs/${height}`);
    },

    // Block par hash
    async getBlock(hash) {
        return await this.request(`/api/chain/entry/${hash}`);
    },

    // Transaction par ID
    async getTransaction(txId) {
        return await this.request(`/api/chain/tx/${txId}`);
    },

    // Transactions dans un block
    async getTransactionsByEntry(entryHash) {
        return await this.request(`/api/chain/txs_in_entry/${entryHash}`);
    },

    // Balance d'une adresse
    async getBalance(address, symbol = 'AMA') {
        return await this.request(`/api/wallet/balance/${address}/${symbol}`);
    },

    // Toutes les balances d'une adresse
    async getAllBalances(address) {
        return await this.request(`/api/wallet/balance_all/${address}`);
    },

    // Historique des transactions d'une adresse
    async getAddressTransactions(address, filters = {}) {
        const params = new URLSearchParams({
            limit: filters.limit || '20',
            offset: filters.offset || '0',
            sort: filters.sort || 'desc',
            ...filters
        });
        return await this.request(`/api/chain/tx_events_by_account/${address}?${params}`);
    },

    // Rich List - Top addresses by balance
    async getRichList() {
        return await this.request('/api/contract/richlist');
    },

    // PFLOPS Historical Data
    async getPflopData() {
        try {
            const response = await fetch('./pflops_data.json');
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error loading PFLOPS data:', error);
            throw error;
        }
    }

};

// Gestion des pages
const PageManager = {
    init() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.target.dataset.page;
                this.showPage(page);
            });
        });

        // Liens "Voir tout"
        document.querySelectorAll('.view-all').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.target.dataset.page;
                this.showPage(page);
            });
        });

        // Afficher la page d'accueil par défaut
        this.showPage('home');
    },

    showPage(pageName) {
        // Cacher toutes les pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        // Mettre à jour la navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === pageName) {
                link.classList.add('active');
            }
        });

        // Afficher la page demandée
        const targetPage = document.getElementById(pageName);
        if (targetPage) {
            targetPage.classList.add('active');
            AppState.currentPage = pageName;

            // Charger les données de la page
            this.loadPageData(pageName);
        }
    },

    async loadPageData(pageName) {
        switch (pageName) {
            case 'home':
                await this.loadHomePage();
                break;
            case 'blocks':
                await this.loadBlocksPage();
                break;
            case 'transactions':
                await this.loadTransactionsPage();
                break;
            case 'richlist':
                await this.loadRichlistPage();
                break;
            case 'pflops':
                await this.loadPflopPage();
                break;
            case 'address':
                await this.loadAddressPage();
                break;
        }
    },

    async loadHomePage() {
        try {
            // Charger les statistiques
            const statsData = await API.getStats();
            if (statsData.stats) {
                this.updateStats(statsData.stats);
            }

            // Charger les derniers blocks
            await this.loadLatestBlocks();

            // Charger les dernières transactions
            await this.loadLatestTransactions();

        } catch (error) {
            console.error('Error loading home page:', error);
            Utils.showToast('Error loading data', 'error');
        }
    },

    updateStats(stats) {
        // Calculer l'epoch basé sur la hauteur (100,000 blocks par epoch)
        const currentEpoch = Math.floor((stats.height || 0) / 100000);
        document.getElementById('currentEpoch').textContent = currentEpoch;
        document.getElementById('circulatingSupply').textContent = `${Utils.formatNumber(stats.circulating || 0)} AMA`;
        document.getElementById('pflopsStat').textContent = (stats.pflops || 0).toFixed(2);

        AppState.stats = stats;
    },

    async loadLatestBlocks() {
        try {
            if (!AppState.stats || !AppState.stats.height) return;

            const currentHeight = AppState.stats.height;
            const blocks = [];

            // Charger les 10 derniers blocks
            for (let i = 0; i < 10; i++) {
                const height = currentHeight - i;
                if (height < 0) break;

                try {
                    const blockData = await API.getBlocksByHeight(height);
                    if (blockData.entries && blockData.entries.length > 0) {
                        blocks.push(...blockData.entries);
                    }
                } catch (error) {
                    console.warn(`Impossible de charger le block ${height}:`, error);
                }
            }

            this.renderLatestBlocks(blocks.slice(0, 10));
        } catch (error) {
            console.error('Error loading latest blocks:', error);
        }
    },

    renderLatestBlocks(blocks) {
        const container = document.getElementById('latestBlocks');

        if (!blocks || blocks.length === 0) {
            container.innerHTML = '<div class="text-secondary">No blocks available</div>';
            return;
        }

        // Utiliser le slot le plus récent comme référence
        const currentSlot = blocks.length > 0 ? blocks[0].header_unpacked.slot : null;

        const html = blocks.map((block, index) => `
            <div class="block-item" onclick="BlockExplorer.showBlockDetailsFromData('${index}')">
                <div class="block-info">
                    <h4>Block #${block.header_unpacked.height}</h4>
                    <p class="text-truncate">${Utils.formatHash(block.hash, 12)}</p>
                </div>
                <div class="block-meta">
                    <div class="tx-count">${block.tx_count || 0} txs</div>
                    <div class="time">${Utils.formatTimeAgo(block.header_unpacked.slot, currentSlot)}</div>
                </div>
            </div>
        `).join('');

        // Stocker les blocks pour l'accès plus tard
        AppState.latestBlocks = blocks;

        container.innerHTML = html;
    },

    async loadLatestTransactions() {
        try {
            const container = document.getElementById('latestTransactions');

            if (!AppState.stats || !AppState.stats.height) {
                container.innerHTML = '<div class="text-secondary">No transactions available</div>';
                return;
            }

            const currentHeight = AppState.stats.height;
            let allTransactions = [];

            // Charger les transactions des 10 derniers blocks
            for (let i = 0; i < 10 && allTransactions.length < 10; i++) {
                const height = currentHeight - i;
                if (height < 0) break;

                try {
                    const blockData = await API.getBlocksByHeight(height);
                    if (blockData.entries && blockData.entries.length > 0) {
                        for (const entry of blockData.entries) {
                            if (entry.txs && entry.txs.length > 0) {
                                // Récupérer les détails des transactions
                                const txsData = await API.getTransactionsByEntry(entry.hash);
                                if (txsData.txs) {
                                    allTransactions.push(...txsData.txs.slice(0, 5)); // Max 5 tx par block
                                }
                                if (allTransactions.length >= 10) break;
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Cannot load transactions for block ${height}:`, error);
                }
            }

            this.renderLatestTransactions(allTransactions.slice(0, 10));

        } catch (error) {
            console.error('Error loading latest transactions:', error);
            const container = document.getElementById('latestTransactions');
            container.innerHTML = '<div class="text-secondary">Error loading transactions</div>';
        }
    },

    renderLatestTransactions(transactions) {
        const container = document.getElementById('latestTransactions');

        if (!transactions || transactions.length === 0) {
            container.innerHTML = '<div class="text-secondary">No recent transactions</div>';
            return;
        }

        const html = transactions.map(tx => {
            const action = tx.tx.actions[0];
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

            let amount = '';
            if (isTransfer && action.args.length >= 2) {
                const amountValue = action.args[1];
                const symbol = action.args[2] || 'AMA';
                try {
                    amount = `${parseFloat(amountValue) / 1e9} ${symbol}`;
                } catch (e) {
                    amount = `${amountValue} ${symbol}`;
                }
            }

            return `
                <div class="transaction-item-small" onclick="SearchManager.showTransactionModal(${JSON.stringify(tx).replace(/"/g, '&quot;')})">
                    <div class="tx-info">
                        <div class="tx-hash-small">${Utils.formatHash(tx.hash, 12)}</div>
                        <div class="tx-function-small">${action.function}</div>
                    </div>
                    <div class="tx-amount-small">
                        ${amount || action.contract}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    },

    async loadBlocksPage() {
        const container = document.getElementById('blocksContainer');
        container.innerHTML = '<div class="loading">Loading latest 50 blocks...</div>';

        try {
            if (!AppState.stats || !AppState.stats.height) {
                // Charger les stats si pas encore disponibles
                const statsData = await API.getStats();
                if (statsData.stats) {
                    AppState.stats = statsData.stats;
                }
            }

            if (!AppState.stats || !AppState.stats.height) {
                container.innerHTML = `
                    <div class="card">
                        <div class="card-content">
                            <p>Unable to load blockchain stats. Enter a block height above to search for a specific block.</p>
                        </div>
                    </div>
                `;
                return;
            }

            const currentHeight = AppState.stats.height;
            const blocks = [];

            // Charger les 50 derniers blocks
            for (let i = 0; i < 50; i++) {
                const height = currentHeight - i;
                if (height < 0) break;

                try {
                    const blockData = await API.getBlocksByHeight(height);
                    if (blockData.entries && blockData.entries.length > 0) {
                        blocks.push(...blockData.entries);
                    }
                } catch (error) {
                    console.warn(`Cannot load block ${height}:`, error);
                }
            }

            this.renderBlocksPage(blocks.slice(0, 50));
        } catch (error) {
            console.error('Error loading blocks page:', error);
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>Error loading blocks. Enter a block height above to search for a specific block.</p>
                    </div>
                </div>
            `;
        }
    },

    renderBlocksPage(blocks) {
        const container = document.getElementById('blocksContainer');

        if (!blocks || blocks.length === 0) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>No blocks available. Enter a block height above to search for a specific block.</p>
                    </div>
                </div>
            `;
            return;
        }

        // Utiliser le slot le plus récent comme référence
        const currentSlot = blocks.length > 0 ? blocks[0].header_unpacked.slot : null;

        const html = `
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-cubes"></i> Latest 50 Blocks</h2>
                </div>
                <div class="card-content">
                    <div class="blocks-list">
                        ${blocks.map((block, index) => `
                            <div class="block-item" onclick="BlockExplorer.renderBlockModal(${JSON.stringify(block).replace(/"/g, '&quot;')})">
                                <div class="block-info">
                                    <h4>Block #${block.header_unpacked.height}</h4>
                                    <p class="text-truncate">${Utils.formatHash(block.hash, 16)}</p>
                                </div>
                                <div class="block-meta">
                                    <div class="tx-count">${block.tx_count || 0} txs</div>
                                    <div class="time">${Utils.formatTimeAgo(block.header_unpacked.slot, currentSlot)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
    },

    async loadTransactionsPage() {
        const container = document.getElementById('transactionsContainer');
        container.innerHTML = '<div class="loading">Loading latest 50 transactions...</div>';

        try {
            if (!AppState.stats || !AppState.stats.height) {
                // Charger les stats si pas encore disponibles
                const statsData = await API.getStats();
                if (statsData.stats) {
                    AppState.stats = statsData.stats;
                }
            }

            if (!AppState.stats || !AppState.stats.height) {
                container.innerHTML = `
                    <div class="card">
                        <div class="card-content">
                            <p>Unable to load blockchain stats. Enter a transaction hash above to search for a specific transaction.</p>
                        </div>
                    </div>
                `;
                return;
            }

            const currentHeight = AppState.stats.height;
            let allTransactions = [];

            // Charger les transactions des derniers blocks
            for (let i = 0; i < 20 && allTransactions.length < 50; i++) {
                const height = currentHeight - i;
                if (height < 0) break;

                try {
                    const blockData = await API.getBlocksByHeight(height);
                    if (blockData.entries && blockData.entries.length > 0) {
                        for (const entry of blockData.entries) {
                            if (entry.txs && entry.txs.length > 0) {
                                // Récupérer les détails des transactions
                                const txsData = await API.getTransactionsByEntry(entry.hash);
                                if (txsData.txs) {
                                    allTransactions.push(...txsData.txs);
                                }
                                if (allTransactions.length >= 50) break;
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Cannot load transactions for block ${height}:`, error);
                }
            }

            this.renderTransactionsPage(allTransactions.slice(0, 50));
        } catch (error) {
            console.error('Error loading transactions page:', error);
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>Error loading transactions. Enter a transaction hash above to search for a specific transaction.</p>
                    </div>
                </div>
            `;
        }
    },

    renderTransactionsPage(transactions) {
        const container = document.getElementById('transactionsContainer');

        if (!transactions || transactions.length === 0) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>No recent transactions found. Enter a transaction hash above to search for a specific transaction.</p>
                    </div>
                </div>
            `;
            return;
        }

        const html = `
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-exchange-alt"></i> Latest 50 Transactions</h2>
                </div>
                <div class="card-content">
                    <div class="transactions-list">
                        ${transactions.map(tx => {
                            const action = tx.tx.actions[0];
                            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

                            let amount = '';
                            let recipient = '';

                            if (isTransfer && action.args.length >= 2) {
                                const amountValue = action.args[1];
                                const symbol = action.args[2] || 'AMA';
                                try {
                                    amount = `${parseFloat(amountValue) / 1e9} ${symbol}`;
                                    recipient = action.args[0] ? Utils.formatHash(action.args[0], 12) : '';
                                } catch (e) {
                                    amount = `${amountValue} ${symbol}`;
                                }
                            }

                            return `
                                <div class="transaction-item" onclick="SearchManager.showTransactionModal(${JSON.stringify(tx).replace(/"/g, '&quot;')})">
                                    <div class="tx-main-info">
                                        <div class="tx-hash">${Utils.formatHash(tx.hash, 16)}</div>
                                        <div class="tx-function">${action.function}</div>
                                    </div>
                                    <div class="tx-details">
                                        ${isTransfer ?
                                            `<div>From: <span onclick="event.stopPropagation(); BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(tx.tx.signer, 12)}</span></div>
                                             ${recipient ? `<div>To: <span onclick="event.stopPropagation(); BlockExplorer.viewAddress('${recipient.replace(/'/g, "\\\'")}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(recipient, 12)}</span></div>` : ''}` :
                                            `<div>Signer: <span onclick="event.stopPropagation(); BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(tx.tx.signer, 12)}</span></div>`
                                        }
                                        <div class="tx-contract">${action.contract}</div>
                                    </div>
                                    <div class="tx-meta">
                                        ${amount ? `<div class="tx-amount">${amount}</div>` : ''}
                                        <div class="tx-time">${tx.metadata?.entry_slot ? 'Slot ' + tx.metadata.entry_slot : '-'}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
    },

    async loadRichlistPage() {
        const container = document.getElementById('richlistContainer');
        const totalHoldersEl = document.getElementById('totalHolders');
        const totalSupplyHeldEl = document.getElementById('totalSupplyHeld');
        const top10PercentageEl = document.getElementById('top10Percentage');

        // Show loading
        container.innerHTML = '<div class="loading">Loading rich list...</div>';

        try {
            // Get rich list data
            const data = await API.getRichList();
            const richlist = data.richlist || [];

            // Calculate statistics
            const totalHolders = richlist.length;
            const totalSupply = richlist.reduce((sum, entry) => sum + parseFloat(entry.float), 0);
            const top10Total = richlist.slice(0, 10).reduce((sum, entry) => sum + parseFloat(entry.float), 0);
            const top10Percentage = totalSupply > 0 ? ((top10Total / totalSupply) * 100).toFixed(2) : 0;

            // Update statistics
            totalHoldersEl.textContent = Utils.formatNumber(totalHolders);
            totalSupplyHeldEl.textContent = Utils.formatNumber(totalSupply) + ' AMA';
            top10PercentageEl.textContent = top10Percentage + '%';

            // Get current limit from dropdown
            const limit = parseInt(document.getElementById('richlistLimit').value) || 100;

            // Render rich list table
            this.renderRichlistTable(richlist.slice(0, limit));

        } catch (error) {
            console.error('Error loading rich list:', error);
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>Error loading rich list data. Please try again later.</p>
                    </div>
                </div>
            `;
        }
    },

    async loadPflopPage() {
        const chartContainer = document.getElementById('pflopschartContainer');
        const chartLoading = document.getElementById('chartLoading');

        try {
            chartLoading.style.display = 'block';

            // Get PFLOPS data
            const data = await API.getPflopData();
            const pflopData = data.data || [];

            if (pflopData.length === 0) {
                chartContainer.innerHTML = `
                    <div class="card">
                        <div class="card-content">
                            <p>No PFLOPS data available yet. The data collection script needs to run first.</p>
                            <p>Run: <code>node collect_pflops.js</code> to start collecting data.</p>
                        </div>
                    </div>
                `;
                return;
            }

            // Update statistics
            this.updatePflopStats(pflopData);

            // Initialize chart
            this.initPflopChart(pflopData);

            // Initialize time filters
            this.initTimeFilters(pflopData);

            chartLoading.style.display = 'none';

        } catch (error) {
            console.error('Error loading PFLOPS page:', error);
            chartLoading.style.display = 'none';
            chartContainer.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>Error loading PFLOPS data. Please try again later.</p>
                    </div>
                </div>
            `;
        }
    },

    updatePflopStats(data) {
        const currentPflops = document.getElementById('currentPflops');
        const avgPflops24h = document.getElementById('avgPflops24h');
        const peakPflops24h = document.getElementById('peakPflops24h');
        const totalEntries = document.getElementById('totalEntries');

        if (data.length === 0) return;

        // Current PFLOPS
        const latest = data[data.length - 1];
        currentPflops.textContent = latest.pflops.toFixed(2);

        // Last 24h data
        const now = Date.now();
        const last24h = data.filter(entry => now - entry.timestamp <= 24 * 60 * 60 * 1000);

        if (last24h.length > 0) {
            const avg = last24h.reduce((sum, entry) => sum + entry.pflops, 0) / last24h.length;
            const peak = Math.max(...last24h.map(entry => entry.pflops));

            avgPflops24h.textContent = avg.toFixed(2);
            peakPflops24h.textContent = peak.toFixed(2);
        } else {
            avgPflops24h.textContent = '-';
            peakPflops24h.textContent = '-';
        }

        totalEntries.textContent = data.length.toString();
    },

    initPflopChart(data) {
        const ctx = document.getElementById('pflopsChart').getContext('2d');

        // Store chart instance for later updates
        if (window.pflopChart) {
            window.pflopChart.destroy();
        }

        const chartData = this.processChartData(data, 'all');

        // Store timestamps for tooltips
        this.chartTimestamps = chartData.timestamps;

        window.pflopChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: 'PFLOPS',
                    data: chartData.values,
                    borderColor: 'rgb(24, 255, 178)',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 40, 0.95)',
                        titleColor: 'rgb(24, 255, 178)',
                        bodyColor: '#ffffff',
                        borderColor: 'rgb(24, 255, 178)',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                const index = context[0].dataIndex;
                                if (PageManager.chartTimestamps && PageManager.chartTimestamps[index]) {
                                    const date = new Date(PageManager.chartTimestamps[index]);
                                    return date.toLocaleString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                    });
                                }
                                return context[0].label;
                            },
                            label: function(context) {
                                return `PFLOPS: ${context.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#b3b3b3',
                            maxTicksLimit: 8
                        }
                    },
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#b3b3b3',
                            callback: function(value) {
                                return value.toFixed(2);
                            }
                        },
                        // Ajuster l'échelle Y pour mieux voir les variations
                        min: function(context) {
                            const data = context.chart.data.datasets[0].data;
                            if (data && data.length > 0) {
                                const values = data.map(point => point.y);
                                const min = Math.min(...values);
                                const max = Math.max(...values);
                                const range = max - min;
                                return range > 0.1 ? min - range * 0.1 : min - 0.1;
                            }
                            return undefined;
                        },
                        max: function(context) {
                            const data = context.chart.data.datasets[0].data;
                            if (data && data.length > 0) {
                                const values = data.map(point => point.y);
                                const min = Math.min(...values);
                                const max = Math.max(...values);
                                const range = max - min;
                                return range > 0.1 ? max + range * 0.1 : max + 0.1;
                            }
                            return undefined;
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    },

    processChartData(data, period) {
        const now = Date.now();
        let filtered = data;

        // Filter by time period
        switch (period) {
            case '24h':
                filtered = data.filter(entry => now - entry.timestamp <= 24 * 60 * 60 * 1000);
                break;
            case '7d':
                filtered = data.filter(entry => now - entry.timestamp <= 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                filtered = data.filter(entry => now - entry.timestamp <= 30 * 24 * 60 * 60 * 1000);
                break;
            case 'all':
            default:
                filtered = data;
                break;
        }

        return {
            labels: filtered.map(entry => {
                const date = new Date(entry.timestamp);
                const now = new Date();
                const diffHours = (now - date) / (1000 * 60 * 60);

                if (diffHours < 24) {
                    return date.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                } else {
                    return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit'
                    });
                }
            }),
            values: filtered.map(entry => entry.pflops),
            timestamps: filtered.map(entry => entry.timestamp)
        };
    },

    initTimeFilters(data) {
        const filters = document.querySelectorAll('.time-filter');
        filters.forEach(filter => {
            filter.addEventListener('click', (e) => {
                // Update active filter
                filters.forEach(f => f.classList.remove('active'));
                e.target.classList.add('active');

                // Update chart
                const period = e.target.dataset.period;
                const chartData = this.processChartData(data, period);

                if (window.pflopChart) {
                    window.pflopChart.data.labels = chartData.labels;
                    window.pflopChart.data.datasets[0].data = chartData.values;
                    window.pflopChart.update();
                }
            });
        });
    },

    async loadAddressPage() {
        const address = AppState.currentAddress;
        if (!address) {
            PageManager.showPage('home');
            return;
        }

        // Mettre à jour le titre et afficher le lien de navigation
        document.getElementById('addressTitle').textContent = Utils.formatHash(address, 16);
        document.querySelector('.nav-link[data-page="address"]').style.display = 'block';
        document.querySelector('.nav-link[data-page="address"]').textContent = Utils.formatHash(address, 8);

        // Initialiser les event listeners
        this.initAddressPageEvents(address);

        try {
            // Charger les balances
            const balanceData = await API.getAllBalances(address);
            this.renderAddressBalances(balanceData.balances || []);

            // Charger les transactions
            await this.loadAddressTransactions(address, 'all', 50);

        } catch (error) {
            console.error('Error loading address page:', error);
            Utils.showToast('Error loading address data', 'error');
        }
    },

    initAddressPageEvents(address) {
        // Bouton copier adresse
        document.getElementById('copyAddressBtn').onclick = () => {
            Utils.copyToClipboard(address);
        };

        // Filtres de transactions
        const typeFilter = document.getElementById('txTypeFilter');
        const limitFilter = document.getElementById('txLimitFilter');

        typeFilter.onchange = () => {
            this.loadAddressTransactions(address, typeFilter.value, parseInt(limitFilter.value));
        };

        limitFilter.onchange = () => {
            this.loadAddressTransactions(address, typeFilter.value, parseInt(limitFilter.value));
        };

        // Bouton charger plus
        document.getElementById('loadMoreTxBtn').onclick = () => {
            this.loadMoreTransactions(address);
        };
    },

    renderAddressBalances(balances) {
        const container = document.getElementById('addressBalances');

        if (!balances || balances.length === 0) {
            container.innerHTML = '<div class="text-secondary">No balances available</div>';
            return;
        }

        const html = balances.map(balance => `
            <div class="balance-item">
                <div class="balance-symbol">${balance.symbol}</div>
                <div class="balance-amount text-primary">${balance.float}</div>
            </div>
        `).join('');

        container.innerHTML = html;
    },

    renderRichlistTable(richlist) {
        const container = document.getElementById('richlistContainer');

        if (!richlist || richlist.length === 0) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>No rich list data available</p>
                    </div>
                </div>
            `;
            return;
        }

        const tableHtml = `
            <div class="richlist-table">
                <div class="table-header">
                    <div class="rank-col">Rank</div>
                    <div class="address-col">Address</div>
                    <div class="balance-col">Balance</div>
                    <div class="percentage-col">Percentage</div>
                </div>
                <div class="table-body">
                    ${richlist.map((entry, index) => {
                        const balance = parseFloat(entry.float);
                        const totalSupply = richlist.reduce((sum, item) => sum + parseFloat(item.float), 0);
                        const percentage = totalSupply > 0 ? ((balance / totalSupply) * 100).toFixed(4) : 0;

                        return `
                            <div class="table-row" onclick="BlockExplorer.viewAddress('${entry.pk}')">
                                <div class="rank-col">
                                    <span class="rank-badge">#${index + 1}</span>
                                </div>
                                <div class="address-col">
                                    <span class="address-link">${Utils.formatHash(entry.pk, 12)}</span>
                                    ${(entry.pk.startsWith('69TDon8KJ') || entry.pk.startsWith('6969GaCysicY')) ? '<span class="team-badge">Team</span>' : ''}
                                </div>
                                <div class="balance-col">
                                    <span class="balance-amount">${Utils.formatNumber(balance)} AMA</span>
                                </div>
                                <div class="percentage-col">
                                    <span class="percentage-amount">${percentage}%</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        container.innerHTML = tableHtml;
    },

    async loadAddressTransactions(address, type = 'all', limit = 50) {
        const container = document.getElementById('addressTransactions');
        container.innerHTML = '<div class="loading">Chargement des transactions...</div>';

        try {
            const filters = { limit, offset: 0, sort: 'desc' };

            let transactionsData;
            if (type === 'sent') {
                transactionsData = await API.getAddressTransactions(address, { ...filters, type: 'sent' });
            } else if (type === 'recv') {
                transactionsData = await API.getAddressTransactions(address, { ...filters, type: 'recv' });
            } else {
                transactionsData = await API.getAddressTransactions(address, filters);
            }

            AppState.currentAddressData.transactions = transactionsData.txs || [];
            AppState.currentAddressData.cursor = transactionsData.cursor;

            this.renderAddressTransactions(AppState.currentAddressData.transactions);
            this.updateTransactionStats(AppState.currentAddressData.transactions);

            // Afficher le bouton "charger plus" s'il y a plus de données
            const loadMoreBtn = document.getElementById('loadMoreTxBtn');
            loadMoreBtn.style.display = transactionsData.cursor ? 'block' : 'none';

        } catch (error) {
            console.error('Error loading transactions:', error);
            container.innerHTML = '<div class="text-secondary">Error loading transactions</div>';
        }
    },

    renderAddressTransactions(transactions) {
        const container = document.getElementById('addressTransactions');

        if (!transactions || transactions.length === 0) {
            container.innerHTML = '<div class="text-secondary">No transactions found</div>';
            return;
        }

        const html = transactions.map(tx => {
            const action = tx.tx.actions[0];
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';
            const txType = tx.metadata?.tx_event || 'unknown';

            let amount = '';
            if (isTransfer && action.args.length >= 2) {
                const amountValue = action.args[1];
                const symbol = action.args[2] || 'AMA';
                amount = `${parseFloat(amountValue) / 1e9} ${symbol}`;
            }

            return `
                <div class="transaction-item" onclick="SearchManager.showTransactionModal(${JSON.stringify(tx).replace(/"/g, '&quot;')})">
                    <div class="tx-main-info">
                        <div class="tx-hash">${Utils.formatHash(tx.hash, 16)}</div>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start;">
                            <span class="tx-type ${txType}" style="display: inline-block; width: auto;">${txType === 'sent' ? 'Sent' : txType === 'recv' ? 'Received' : 'Transaction'}</span>
                            ${tx.metadata?.entry_slot ? `<span style="font-size: 0.8em; color: #b3b3b3;">${Utils.formatSlotToDateTime(tx.metadata.entry_slot)}</span>` : ''}
                        </div>
                    </div>
                    <div class="tx-details">
                        <div class="tx-function">${action.function}</div>
                        <div class="tx-contract">${Utils.formatHash(action.contract, 8)}</div>
                    </div>
                    <div class="tx-meta">
                        ${amount ? `<div class="tx-amount">${amount}</div>` : ''}
                        <div class="tx-time">${tx.metadata?.entry_slot ? 'Slot ' + tx.metadata.entry_slot : '-'}</div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    },

    updateTransactionStats(transactions) {
        const sentCount = transactions.filter(tx => tx.metadata?.tx_event === 'sent').length;
        const recvCount = transactions.filter(tx => tx.metadata?.tx_event === 'recv').length;
        const totalCount = transactions.length;

        document.getElementById('sentTxCount').textContent = sentCount;
        document.getElementById('receivedTxCount').textContent = recvCount;
        document.getElementById('totalTxCount').textContent = totalCount;
    },

    async loadMoreTransactions(address) {
        if (!AppState.currentAddressData.cursor) return;

        try {
            const typeFilter = document.getElementById('txTypeFilter').value;
            const limitFilter = parseInt(document.getElementById('txLimitFilter').value);

            const filters = {
                limit: limitFilter,
                offset: AppState.currentAddressData.transactions.length,
                sort: 'desc',
                cursor: AppState.currentAddressData.cursor
            };

            let transactionsData;
            if (typeFilter === 'sent') {
                transactionsData = await API.getAddressTransactions(address, { ...filters, type: 'sent' });
            } else if (typeFilter === 'recv') {
                transactionsData = await API.getAddressTransactions(address, { ...filters, type: 'recv' });
            } else {
                transactionsData = await API.getAddressTransactions(address, filters);
            }

            // Ajouter les nouvelles transactions
            AppState.currentAddressData.transactions.push(...(transactionsData.txs || []));
            AppState.currentAddressData.cursor = transactionsData.cursor;

            this.renderAddressTransactions(AppState.currentAddressData.transactions);
            this.updateTransactionStats(AppState.currentAddressData.transactions);

            // Cacher le bouton s'il n'y a plus de données
            const loadMoreBtn = document.getElementById('loadMoreTxBtn');
            loadMoreBtn.style.display = transactionsData.cursor ? 'block' : 'none';

        } catch (error) {
            console.error('Error loading more transactions:', error);
            Utils.showToast('Error loading', 'error');
        }
    }
};

// Explorateur de blocks
const BlockExplorer = {
    showBlockDetailsFromData(blockIndex) {
        const blocks = AppState.latestBlocks || [];
        const block = blocks[parseInt(blockIndex)];

        if (block) {
            this.renderBlockModal(block);
        } else {
            Utils.showToast('Block data not available', 'error');
        }
    },

    async showBlockDetails(blockHash) {
        try {
            const blockData = await API.getBlock(blockHash);
            if (blockData.entry) {
                this.renderBlockModal(blockData.entry);
            }
        } catch (error) {
            Utils.showToast('Error loading block', 'error');
        }
    },

    async renderBlockModal(block) {
        const modalBody = document.getElementById('modalBody');

        // Affichage initial des informations du bloc
        let html = `
            <h2>Block #${block.header_unpacked.height} Details</h2>
            <div style="margin: 2rem 0;">
                <div style="display: grid; gap: 1rem;">
                    <div><strong>Hash:</strong> <span onclick="Utils.copyToClipboard('${block.hash}')" style="cursor: pointer; color: rgb(24, 255, 178);">${block.hash}</span></div>
                    <div><strong>Height:</strong> ${block.header_unpacked.height}</div>
                    <div><strong>Slot:</strong> ${block.header_unpacked.slot}</div>
                    <div><strong>Previous Slot:</strong> ${block.header_unpacked.prev_slot}</div>
                    <div><strong>Previous Hash:</strong> ${Utils.formatHash(block.header_unpacked.prev_hash, 16)}</div>
                    <div><strong>Signer:</strong> ${Utils.formatHash(block.header_unpacked.signer, 12)}</div>
                    <div><strong>Transaction Count:</strong> ${block.tx_count || 0}</div>
                    ${block.consensus ? `<div><strong>Consensus Score:</strong> ${block.consensus.score}</div>` : ''}
                </div>
            </div>
        `;

        // Si le bloc contient des transactions, les afficher
        if (block.tx_count && block.tx_count > 0) {
            html += `
                <div style="margin-top: 2rem;">
                    <h3>Transactions (${block.tx_count})</h3>
                    <div id="blockTransactionsList" style="margin-top: 1rem;">
                        <div class="loading">Loading transactions...</div>
                    </div>
                </div>
            `;
        }

        modalBody.innerHTML = html;
        document.getElementById('modal').style.display = 'block';

        // Charger les transactions si le bloc en contient
        if (block.tx_count && block.tx_count > 0) {
            this.loadBlockTransactions(block.hash);
        }
    },

    async loadBlockTransactions(blockHash) {
        try {
            const transactionsContainer = document.getElementById('blockTransactionsList');
            const txsData = await API.getTransactionsByEntry(blockHash);

            if (txsData.txs && txsData.txs.length > 0) {
                this.renderBlockTransactions(txsData.txs, transactionsContainer);
            } else {
                transactionsContainer.innerHTML = '<div class="text-secondary">No transactions found in this block</div>';
            }
        } catch (error) {
            console.error('Error loading block transactions:', error);
            const transactionsContainer = document.getElementById('blockTransactionsList');
            if (transactionsContainer) {
                transactionsContainer.innerHTML = '<div class="text-secondary">Error loading transactions</div>';
            }
        }
    },

    renderBlockTransactions(transactions, container) {
        const html = transactions.map((tx, index) => {
            const action = tx.tx.actions[0];
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

            let amount = '';
            let recipient = '';

            if (isTransfer && action.args.length >= 2) {
                try {
                    const amountValue = action.args[1];
                    const symbol = action.args[2] || 'AMA';
                    amount = `${parseFloat(amountValue) / 1e9} ${symbol}`;
                    recipient = action.args[0] ? Utils.formatHash(action.args[0], 12) : '';
                } catch (e) {
                    amount = `${action.args[1]} ${action.args[2] || 'AMA'}`;
                }
            }

            return `
                <div class="transaction-item-modal" onclick="SearchManager.showTransactionModal(${JSON.stringify(tx).replace(/"/g, '&quot;')})" style="
                    padding: 1rem;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 8px;
                    margin-bottom: 0.5rem;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    display: grid;
                    grid-template-columns: 1fr auto;
                    gap: 1rem;
                    align-items: center;
                " onmouseover="this.style.backgroundColor='rgba(0, 212, 255, 0.1)'" onmouseout="this.style.backgroundColor='transparent'">
                    <div>
                        <div style="font-weight: bold; color: rgb(24, 255, 178); margin-bottom: 0.5rem;">
                            #${index + 1}: ${Utils.formatHash(tx.hash, 16)}
                        </div>
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; font-size: 0.9em;">
                            <div><strong>Function:</strong></div>
                            <div>${action.function}</div>
                            <div><strong>Contract:</strong></div>
                            <div>${action.contract}</div>
                            ${isTransfer ?
                                `<div><strong>From:</strong></div><div><span onclick="BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(tx.tx.signer, 12)}</span></div>
                                 ${recipient ? `<div><strong>To:</strong></div><div><span onclick="BlockExplorer.viewAddress('${recipient}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(recipient, 12)}</span></div>` : ''}` :
                                `<div><strong>Signer:</strong></div><div><span onclick="BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(tx.tx.signer, 12)}</span></div>`
                            }
                        </div>
                    </div>
                    <div style="text-align: right;">
                        ${amount ? `<div style="font-weight: bold; color: rgb(24, 255, 178); font-size: 1.1em;">${amount}</div>` : ''}
                        <div style="font-size: 0.9em; color: #b3b3b3;">Nonce: ${tx.tx.nonce}</div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    },

    viewAddress(address) {
        // Fonction pour naviguer vers la page d'une adresse
        AppState.currentAddress = address;
        document.getElementById('modal').style.display = 'none';
        PageManager.showPage('address');
    }
};

// Recherche
const SearchManager = {
    recentSearches: [],
    maxRecentSearches: 10,

    init() {
        this.loadRecentSearches();

        const searchInput = document.getElementById('searchInput');
        const searchBtn = document.getElementById('searchBtn');

        searchBtn.addEventListener('click', () => {
            this.performSearch(searchInput.value);
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch(searchInput.value);
            }
        });

        // Ajouter les événements pour l'historique de recherche
        this.initSearchHistory(searchInput);

        // Recherche de block par hauteur
        const blockHeightInput = document.getElementById('blockHeightInput');
        const searchBlockBtn = document.getElementById('searchBlockBtn');

        if (searchBlockBtn) {
            searchBlockBtn.addEventListener('click', () => {
                const height = parseInt(blockHeightInput.value);
                if (height >= 0) {
                    this.searchBlockByHeight(height);
                }
            });
        }

        // Recherche de transaction par hash
        const txHashInput = document.getElementById('txHashInput');
        const searchTxBtn = document.getElementById('searchTxBtn');

        if (searchTxBtn) {
            searchTxBtn.addEventListener('click', () => {
                const txHash = txHashInput.value.trim();
                if (txHash) {
                    this.searchTransactionByHash(txHash);
                }
            });
        }

        // Recherche par Entrée sur les inputs
        if (blockHeightInput) {
            blockHeightInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const height = parseInt(blockHeightInput.value);
                    if (height >= 0) {
                        this.searchBlockByHeight(height);
                    }
                }
            });
        }

        if (txHashInput) {
            txHashInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const txHash = txHashInput.value.trim();
                    if (txHash) {
                        this.searchTransactionByHash(txHash);
                    }
                }
            });
        }

        // Rich List filter dropdown
        const richlistLimit = document.getElementById('richlistLimit');
        if (richlistLimit) {
            richlistLimit.addEventListener('change', () => {
                if (AppState.currentPage === 'richlist') {
                    PageManager.loadRichlistPage();
                }
            });
        }
    },

    loadRecentSearches() {
        try {
            const stored = localStorage.getItem('amadeus_recent_searches');
            if (stored) {
                this.recentSearches = JSON.parse(stored);
            }
        } catch (error) {
            console.error('Error loading recent searches:', error);
            this.recentSearches = [];
        }
    },

    saveRecentSearches() {
        try {
            localStorage.setItem('amadeus_recent_searches', JSON.stringify(this.recentSearches));
        } catch (error) {
            console.error('Error saving recent searches:', error);
        }
    },

    addToRecentSearches(query) {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return;

        // Supprimer la recherche si elle existe déjà
        this.recentSearches = this.recentSearches.filter(search => search.query !== trimmedQuery);

        // Ajouter la nouvelle recherche en première position
        this.recentSearches.unshift({
            query: trimmedQuery,
            timestamp: Date.now(),
            type: this.detectSearchType(trimmedQuery)
        });

        // Limiter le nombre de recherches récentes
        if (this.recentSearches.length > this.maxRecentSearches) {
            this.recentSearches = this.recentSearches.slice(0, this.maxRecentSearches);
        }

        this.saveRecentSearches();
    },

    detectSearchType(query) {
        if (/^\d+$/.test(query)) {
            return 'block';
        } else if (query.length === 64 || query.length === 44) {
            return 'hash';
        } else if (query.length === 98 || query.length === 48 || query.length === 66) {
            return 'address';
        }
        return 'unknown';
    },

    initSearchHistory(searchInput) {
        // Créer le dropdown pour l'historique
        const searchContainer = searchInput.parentElement;
        const dropdown = document.createElement('div');
        dropdown.id = 'searchHistoryDropdown';
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: rgba(20, 20, 40, 0.95);
            border: 1px solid rgba(0, 212, 255, 0.3);
            border-radius: 8px;
            max-height: 300px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            margin-top: 4px;
            backdrop-filter: blur(10px);
        `;
        searchContainer.style.position = 'relative';
        searchContainer.appendChild(dropdown);

        // Events pour afficher/cacher l'historique
        searchInput.addEventListener('focus', () => {
            this.showSearchHistory(dropdown);
        });

        searchInput.addEventListener('input', () => {
            if (searchInput.value.trim()) {
                this.hideSearchHistory(dropdown);
            } else {
                this.showSearchHistory(dropdown);
            }
        });

        // Cacher quand on clique ailleurs
        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target)) {
                this.hideSearchHistory(dropdown);
            }
        });
    },

    showSearchHistory(dropdown) {
        if (this.recentSearches.length === 0) {
            dropdown.style.display = 'none';
            return;
        }

        const html = this.recentSearches.map((search, index) => {
            const typeIcon = {
                'block': 'fas fa-cube',
                'hash': 'fas fa-hashtag',
                'address': 'fas fa-wallet',
                'unknown': 'fas fa-search'
            }[search.type];

            const timeAgo = this.getTimeAgo(search.timestamp);

            return `
                <div class="search-history-item" onclick="SearchManager.selectRecentSearch('${search.query.replace(/'/g, "\\'")}')"
                     style="padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 0.75rem; transition: background-color 0.2s;"
                     onmouseover="this.style.backgroundColor='rgba(0, 212, 255, 0.1)'"
                     onmouseout="this.style.backgroundColor='transparent'">
                    <i class="${typeIcon}" style="color: rgb(24, 255, 178); width: 16px;"></i>
                    <div style="flex: 1;">
                        <div style="font-size: 0.9em; color: #ffffff;">${Utils.formatHash(search.query, 20)}</div>
                        <div style="font-size: 0.75em; color: #b3b3b3;">${timeAgo}</div>
                    </div>
                    <i class="fas fa-times" onclick="event.stopPropagation(); SearchManager.removeRecentSearch(${index})"
                       style="color: #666; font-size: 0.8em; padding: 4px; cursor: pointer;"
                       title="Supprimer"></i>
                </div>
            `;
        }).join('');

        dropdown.innerHTML = `
            <div style="padding: 0.5rem 1rem; font-size: 0.8em; color: #b3b3b3; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <i class="fas fa-history"></i> Recherches récentes
            </div>
            ${html}
            <div style="padding: 0.5rem 1rem; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
                <button onclick="SearchManager.clearRecentSearches()" style="background: none; border: none; color: #b3b3b3; cursor: pointer; font-size: 0.8em;">
                    <i class="fas fa-trash"></i> Effacer tout
                </button>
            </div>
        `;

        dropdown.style.display = 'block';
    },

    hideSearchHistory(dropdown) {
        dropdown.style.display = 'none';
    },

    selectRecentSearch(query) {
        const searchInput = document.getElementById('searchInput');
        searchInput.value = query;
        this.hideSearchHistory(document.getElementById('searchHistoryDropdown'));
        this.performSearch(query);
    },

    removeRecentSearch(index) {
        this.recentSearches.splice(index, 1);
        this.saveRecentSearches();
        this.showSearchHistory(document.getElementById('searchHistoryDropdown'));
    },

    clearRecentSearches() {
        this.recentSearches = [];
        this.saveRecentSearches();
        this.hideSearchHistory(document.getElementById('searchHistoryDropdown'));
    },

    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days > 0) return `il y a ${days}j`;
        if (hours > 0) return `il y a ${hours}h`;
        if (minutes > 0) return `il y a ${minutes}min`;
        return 'maintenant';
    },

    async performSearch(query) {
        if (!query.trim()) return;

        const trimmedQuery = query.trim();
        console.log('Searching for:', trimmedQuery, 'Length:', trimmedQuery.length);

        // Cacher le dropdown d'historique
        this.hideSearchHistory(document.getElementById('searchHistoryDropdown'));

        try {
            // Ajouter à l'historique de recherche
            this.addToRecentSearches(trimmedQuery);

            // Détecter le type de recherche
            if (/^\d+$/.test(trimmedQuery)) {
                console.log('Detected as block height');
                await this.searchBlockByHeight(parseInt(trimmedQuery));
            } else if (trimmedQuery.length === 64 || trimmedQuery.length === 44) {
                console.log('Detected as hash');
                await this.searchByHash(trimmedQuery);
            } else if (trimmedQuery.length === 98 || trimmedQuery.length === 48 || trimmedQuery.length === 66) {
                console.log('Detected as address');
                await this.searchAddress(trimmedQuery);
            } else {
                console.log('Unrecognized format, length:', trimmedQuery.length);
                Utils.showToast(`Unrecognized search format (${trimmedQuery.length} characters)`, 'error');
            }
        } catch (error) {
            Utils.showToast('Search error', 'error');
            console.error('Search error:', error);
        }
    },

    async searchBlockByHeight(height) {
        try {
            const blockData = await API.getBlocksByHeight(height);
            if (blockData.entries && blockData.entries.length > 0) {
                // Utiliser les données directement au lieu d'un nouvel appel API
                const block = blockData.entries[0];
                BlockExplorer.renderBlockModal(block);
                document.getElementById('modal').style.display = 'block';
            } else {
                Utils.showToast('No block found at this height', 'error');
            }
        } catch (error) {
            Utils.showToast('Block not found', 'error');
            console.error('searchBlockByHeight error:', error);
        }
    },

    async searchByHash(hash) {
        try {
            // Essayer en tant que transaction
            const txData = await API.getTransaction(hash);
            if (txData) {
                this.showTransactionModal(txData);
                return;
            }
        } catch (error) {
            // Pas une transaction - pour les blocks, il faudrait connaître la hauteur
            Utils.showToast('Hash not found or block search by hash not supported', 'error');
            console.log('Hash search failed - if this is a block hash, try searching by block height instead');
        }
    },

    async searchAddress(address) {
        console.log('Searching address:', address);
        try {
            // Naviguer vers la page adresse
            AppState.currentAddress = address;
            PageManager.showPage('address');
        } catch (error) {
            console.error('Erreur recherche adresse:', error);
            Utils.showToast('Error opening address page', 'error');
        }
    },

    async searchTransactionByHash(txHash) {
        console.log('Searching transaction:', txHash);
        try {
            const txData = await API.getTransaction(txHash);
            if (txData) {
                this.showTransactionModal(txData);
                Utils.showToast('Transaction found!', 'success');
            } else {
                Utils.showToast('Transaction not found', 'error');
            }
        } catch (error) {
            console.error('searchTransactionByHash error:', error);
            Utils.showToast('Transaction not found', 'error');
        }
    },

    showTransactionModal(tx) {
        const modalBody = document.getElementById('modalBody');
        const action = tx.tx.actions[0];
        const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

        // Extraire les informations de transfer si c'est le cas
        let transferInfo = '';
        if (isTransfer && action.args.length >= 2) {
            const recipient = action.args[0];
            const amountValue = action.args[1];
            const symbol = action.args[2] || 'AMA';

            let formattedAmount = '';
            try {
                formattedAmount = `${parseFloat(amountValue) / 1e9} ${symbol}`;
            } catch (e) {
                formattedAmount = `${amountValue} ${symbol}`;
            }

            transferInfo = `
                <div style="background: rgba(0, 212, 255, 0.1); padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                    <h3 style="margin: 0 0 1rem 0; color: rgb(24, 255, 178);"><i class="fas fa-exchange-alt"></i> Transfer Details</h3>
                    <div style="display: grid; gap: 0.75rem;">
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center;">
                            <strong>From:</strong>
                            <span onclick="BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">
                                ${Utils.formatHash(tx.tx.signer, 16)}
                            </span>
                        </div>
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center;">
                            <strong>To:</strong>
                            <span onclick="BlockExplorer.viewAddress('${recipient}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">
                                ${Utils.formatHash(recipient, 16)}
                            </span>
                        </div>
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center;">
                            <strong>Amount:</strong>
                            <span style="font-weight: bold; color: rgb(24, 255, 178); font-size: 1.1em;">
                                ${formattedAmount}
                            </span>
                        </div>
                        ${tx.metadata && tx.metadata.entry_slot ? `
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center;">
                            <strong>Date:</strong>
                            <span style="color: #b3b3b3;">
                                ${Utils.formatSlotToDateTime(tx.metadata.entry_slot)}
                            </span>
                        </div>` : ''}
                    </div>
                </div>
            `;
        }

        const html = `
            <h2>Transaction Details</h2>
            ${transferInfo}
            <div style="margin: 2rem 0;">
                <div style="display: grid; gap: 1rem;">
                    <div><strong>Hash:</strong> <span onclick="Utils.copyToClipboard('${tx.hash}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;" title="Cliquer pour copier">${tx.hash}</span></div>
                    ${!isTransfer ? `<div><strong>Signer:</strong> <span onclick="BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(tx.tx.signer, 16)}</span></div>` : ''}
                    <div><strong>Nonce:</strong> ${tx.tx.nonce}</div>
                    <div><strong>Contract:</strong> ${action.contract}</div>
                    <div><strong>Function:</strong> ${action.function}</div>
                    ${tx.metadata ? `<div><strong>Block:</strong> <span onclick="Utils.copyToClipboard('${tx.metadata.entry_hash}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;" title="Cliquer pour copier">${Utils.formatHash(tx.metadata.entry_hash, 16)}</span></div>` : ''}
                    ${tx.metadata ? `<div><strong>Slot:</strong> ${tx.metadata.entry_slot}</div>` : ''}
                </div>
            </div>

            ${action.args && action.args.length > 0 ? `
                <div style="margin-top: 2rem;">
                    <h3>Raw Arguments</h3>
                    <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; font-family: monospace; font-size: 0.9em; overflow-x: auto;">
                        <pre>${JSON.stringify(action.args, null, 2)}</pre>
                    </div>
                </div>
            ` : ''}
        `;
        modalBody.innerHTML = html;
        document.getElementById('modal').style.display = 'block';
    },

    showAddressModal(address, balances) {
        const modalBody = document.getElementById('modalBody');
        const html = `
            <h2>Address Details</h2>
            <div style="margin: 2rem 0;">
                <div><strong>Address:</strong> <span onclick="Utils.copyToClipboard('${address}')" style="cursor: pointer; color: rgb(24, 255, 178);">${Utils.formatHash(address, 16)}</span></div>
                <h3 style="margin: 2rem 0 1rem 0;">Balances:</h3>
                <div style="display: grid; gap: 0.5rem;">
                    ${balances.map(balance => `
                        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <span>${balance.symbol}</span>
                            <span class="text-primary">${balance.float}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        modalBody.innerHTML = html;
        document.getElementById('modal').style.display = 'block';
    }
};

// Modal
const ModalManager = {
    init() {
        const modal = document.getElementById('modal');
        const closeBtn = document.querySelector('.modal-close');

        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
};

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', () => {
    PageManager.init();
    SearchManager.init();
    ModalManager.init();

    // Rafraîchissement automatique toutes les 30 secondes
    setInterval(() => {
        if (AppState.currentPage === 'home') {
            PageManager.loadHomePage();
        }
    }, 30000);
});
