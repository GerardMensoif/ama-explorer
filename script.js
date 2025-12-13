// Configuration de l'API
const API_BASE = 'https://nodes.amadeus.bot';
const WS_URL = 'wss://nodes.amadeus.bot/ws/rpc';

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
    },
    websocket: null,
    wsConnected: false,
    validatorsInterval: null,
    lastHeight: null,  // Pour détecter les changements de hauteur
    accountTracking: {
        enabled: false,
        address: null,
        transactions: []
    }
};

// Gestionnaire WebSocket
const WebSocketManager = {
    ws: null,
    reconnectTimeout: null,
    rejoined: false,
    startTime: null,

    init() {
        this.connect();
    },

    connect() {
        this.startTime = Date.now();
        this.rejoined = false;

        try {
            this.ws = new WebSocket(WS_URL);
            AppState.websocket = this.ws;

            this.ws.addEventListener('open', (event) => {
                console.log('WebSocket connected');
                AppState.wsConnected = true;
                this.updateConnectionStatus(true);
            });

            this.ws.addEventListener('close', (event) => {
                console.log('WebSocket closed, reconnecting:', event.code, event.reason);
                AppState.wsConnected = false;
                this.updateConnectionStatus(false);
                this.reconnect();
            });

            this.ws.addEventListener('error', (event) => {
                console.log('WebSocket error:', event);
                this.reconnect();
            });

            this.ws.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            });

        } catch (error) {
            console.error('Error creating WebSocket:', error);
            this.reconnect();
        }
    },

    async reconnect() {
        if (this.rejoined) return;

        this.rejoined = true;
        AppState.websocket = null;
        AppState.wsConnected = false;

        // Don't try to reconnect too rapidly
        const timeSinceLastJoin = Date.now() - this.startTime;
        if (timeSinceLastJoin < 10000) {
            // Less than 10 seconds elapsed since last join. Pause a bit.
            await new Promise(resolve => setTimeout(resolve, 10000 - timeSinceLastJoin));
        }

        // Reconnect
        this.connect();
    },

    handleMessage(data) {
        console.log('WebSocket message:', data);

        switch (data.op) {
            case 'event_stats':
                this.handleStatsUpdate(data.stats);
                break;
            case 'event_entry':
                this.handleNewEntry(data.entry);
                break;
            case 'event_txs':
                this.handleNewTransactions(data.txs);
                break;
            case 'event_account_tx':
                this.handleAccountTransaction(data);
                break;
            default:
                console.log('Unknown WebSocket op:', data.op);
        }
    },

    handleAccountTransaction(data) {
        // Handle real-time account tracking transactions
        if (AppState.accountTracking.enabled && data.tx) {
            console.log('Account transaction received:', data.tx);
            AccountTracker.addRealtimeTransaction(data.tx);
        }
    },

    subscribeToAccount(address) {
        if (!this.ws || !AppState.wsConnected) {
            console.error('WebSocket not connected');
            return false;
        }

        try {
            const message = {
                op: 'subscribe_account',
                account: address
            };
            this.ws.send(JSON.stringify(message));
            console.log('Subscribed to account:', address);
            return true;
        } catch (error) {
            console.error('Error subscribing to account:', error);
            return false;
        }
    },

    unsubscribeFromAccount(address) {
        if (!this.ws || !AppState.wsConnected) {
            console.error('WebSocket not connected');
            return false;
        }

        try {
            const message = {
                op: 'unsubscribe_account',
                account: address
            };
            this.ws.send(JSON.stringify(message));
            console.log('Unsubscribed from account:', address);
            return true;
        } catch (error) {
            console.error('Error unsubscribing from account:', error);
            return false;
        }
    },

    handleStatsUpdate(stats) {
        // Mettre à jour les stats en temps réel
        console.log('handleStatsUpdate called, currentPage:', AppState.currentPage);
        if (AppState.currentPage === 'home') {
            console.log('Updating stats display');
            const previousHeight = AppState.lastHeight;
            const newHeight = stats.height;

            AppState.stats = stats;
            AppState.lastHeight = newHeight;
            PageManager.updateStats(stats);

            // Recharger les blocs seulement si la hauteur a changé
            if (previousHeight !== null && newHeight > previousHeight) {
                console.log(`Height changed from ${previousHeight} to ${newHeight}, reloading blocks`);
                PageManager.loadLatestBlocks();
            }
        }
    },

    handleNewEntry(entry) {
        // Ajouter le nouveau bloc en tête de liste
        console.log('handleNewEntry called, currentPage:', AppState.currentPage);
        if (AppState.currentPage === 'home') {
            console.log('Adding new entry to blocks');

            // Vérifier si le bloc n'existe pas déjà (éviter les doublons)
            const existingBlock = AppState.latestBlocks.find(b => b.hash === entry.hash);
            if (!existingBlock) {
                AppState.latestBlocks.unshift(entry);
                // Garder seulement les 10 plus récents (triés par hauteur)
                AppState.latestBlocks.sort((a, b) => b.header.height - a.header.height);
                AppState.latestBlocks = AppState.latestBlocks.slice(0, 10);
                PageManager.renderLatestBlocks(AppState.latestBlocks);
            }
        }
    },

    handleNewTransactions(txs) {
        // Ajouter les nouvelles transactions
        if (AppState.currentPage === 'home' && txs.length > 0) {
            // Ajouter toutes les nouvelles transactions (pas de filtre)
            AppState.latestTransactions = [...txs, ...AppState.latestTransactions].slice(0, 10);
            // Recharger les détails complets pour les nouvelles transactions
            this.loadTransactionDetails(txs);
        }
    },

    async loadTransactionDetails(txs) {
        const detailPromises = txs.map(tx =>
            API.getTransaction(tx.hash).catch(() => tx)
        );
        const txsWithDetails = await Promise.all(detailPromises);

        // Mettre à jour la liste avec les détails
        AppState.latestTransactions = [
            ...txsWithDetails,
            ...AppState.latestTransactions.filter(t => !txs.find(newTx => newTx.hash === t.hash))
        ].slice(0, 10);

        PageManager.renderLatestTransactions(AppState.latestTransactions);
    },

    updateConnectionStatus(connected) {
        // Afficher un indicateur de connexion (optionnel)
        const indicator = document.getElementById('wsIndicator');
        if (indicator) {
            indicator.style.backgroundColor = connected ? '#32cd32' : '#ff6347';
            indicator.title = connected ? 'WebSocket connected' : 'WebSocket disconnected';
        }
    },

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
    }
};

// Utilitaires
const Utils = {
    // Formatter les nombres
    formatNumber(num) {
        if (num >= 1e9) return Math.floor(num / 1e9) + 'B';
        if (num >= 1e6) return Math.floor(num / 1e6) + 'M';
        if (num >= 1e3) return Math.floor(num / 1e3) + 'K';
        return num.toString();
    },

    // Formatter les hash (tronquer)
    formatHash(hash, length = 8) {
        if (!hash) return '-';
        if (hash.length <= length * 2) return hash;
        return hash.substring(0, length) + '...' + hash.substring(hash.length - length);
    },


    // Copier dans le presse-papier
    async copyToClipboard(text) {
        try {
            // Méthode moderne (HTTPS uniquement)
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                this.showToast('Copied to clipboard!');
            } else {
                // Fallback pour HTTP
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                this.showToast('Copied to clipboard!');
            }
        } catch (err) {
            console.error('Copy error:', err);
            this.showToast('Failed to copy', 'error');
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

// Account Tracker - Real-time transaction monitoring
const AccountTracker = {
    init() {
        // Initialize tracking controls on address page
        const toggleBtn = document.getElementById('toggleTrackingBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleTracking());
        }
    },

    toggleTracking() {
        if (AppState.accountTracking.enabled) {
            this.stopTracking();
        } else {
            this.startTracking();
        }
    },

    startTracking() {
        const address = AppState.currentAddress;
        if (!address) {
            Utils.showToast('No address selected', 'error');
            return;
        }

        if (!AppState.wsConnected) {
            Utils.showToast('WebSocket not connected', 'error');
            return;
        }

        // Subscribe to account via WebSocket
        const success = WebSocketManager.subscribeToAccount(address);

        if (success) {
            AppState.accountTracking.enabled = true;
            AppState.accountTracking.address = address;
            AppState.accountTracking.transactions = [];

            // Update UI
            const toggleBtn = document.getElementById('toggleTrackingBtn');
            const trackingStatus = document.getElementById('trackingStatus');
            const realtimeContainer = document.getElementById('realtimeTransactions');

            toggleBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Tracking';
            toggleBtn.style.background = '#ff6347';
            toggleBtn.style.color = 'white';

            trackingStatus.style.display = 'block';
            realtimeContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: rgba(255, 255, 255, 0.5);"><i class="fas fa-spinner fa-pulse" style="font-size: 2rem;"></i><p style="margin-top: 1rem;">Waiting for transactions...</p></div>';

            Utils.showToast('Real-time tracking started', 'success');
        }
    },

    stopTracking() {
        const address = AppState.accountTracking.address;
        if (address) {
            WebSocketManager.unsubscribeFromAccount(address);
        }

        AppState.accountTracking.enabled = false;
        AppState.accountTracking.address = null;
        AppState.accountTracking.transactions = [];

        // Update UI
        const toggleBtn = document.getElementById('toggleTrackingBtn');
        const trackingStatus = document.getElementById('trackingStatus');
        const realtimeContainer = document.getElementById('realtimeTransactions');

        toggleBtn.innerHTML = '<i class="fas fa-play"></i> Start Tracking';
        toggleBtn.style.background = 'rgb(24, 255, 178)';
        toggleBtn.style.color = '#141428';

        trackingStatus.style.display = 'none';
        realtimeContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: rgba(255, 255, 255, 0.5);"><i class="fas fa-play-circle" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;"></i><p>Click "Start Tracking" to monitor transactions for this address in real-time</p></div>';

        Utils.showToast('Tracking stopped', 'success');
    },

    addRealtimeTransaction(tx) {
        // Add transaction to the beginning of the array
        AppState.accountTracking.transactions.unshift(tx);

        // Keep only last 50 transactions
        if (AppState.accountTracking.transactions.length > 50) {
            AppState.accountTracking.transactions.pop();
        }

        // Update display
        this.renderRealtimeTransactions();
    },

    renderRealtimeTransactions() {
        const container = document.getElementById('realtimeTransactions');
        const transactions = AppState.accountTracking.transactions;

        if (!transactions || transactions.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: rgba(255, 255, 255, 0.5);"><i class="fas fa-spinner fa-pulse" style="font-size: 2rem;"></i><p style="margin-top: 1rem;">Waiting for transactions...</p></div>';
            return;
        }

        const html = `
            <div style="margin-bottom: 1rem; color: rgba(255, 255, 255, 0.7);">
                <i class="fas fa-check-circle" style="color: rgb(24, 255, 178);"></i>
                <strong>${transactions.length}</strong> transaction${transactions.length > 1 ? 's' : ''} tracked
            </div>
            <div class="transactions-list">
                ${transactions.map(tx => {
                    if (!tx.tx || !tx.tx.action) return '';

                    const action = tx.tx.action;
                    const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

                    // Get status
                    let txStatus = 'pending';
                    let statusColor = '#ffa500';
                    if (tx.result && tx.result.error) {
                        txStatus = tx.result.error;
                        const isSuccess = txStatus === 'ok' || txStatus === ':ok';
                        statusColor = isSuccess ? '#32cd32' : '#ff6347';
                    } else if (tx.receipt && tx.receipt.result) {
                        txStatus = tx.receipt.result;
                        const isSuccess = txStatus === 'ok' || txStatus === ':ok';
                        statusColor = isSuccess ? '#32cd32' : '#ff6347';
                    }

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

                    const timestamp = tx.tx.nonce ? new Date(tx.tx.nonce / 1000000).toLocaleTimeString() : 'Just now';

                    return `
                        <div class="transaction-item" onclick="SearchManager.showTransactionFromHash('${tx.hash}')" style="border-left: 3px solid ${statusColor}; animation: slideInRight 0.3s ease;">
                            <div class="tx-main-info">
                                <div class="tx-hash">${Utils.formatHash(tx.hash, 16)}</div>
                                <div class="tx-function">${action.function}</div>
                                <span style="font-size: 0.8em; color: ${statusColor}; margin-left: 0.5rem;">${txStatus.replace(/^:/, '').toUpperCase()}</span>
                            </div>
                            <div class="tx-details">
                                ${isTransfer ?
                                    `<div>From: <span style="color: rgb(24, 255, 178);">${Utils.formatHash(tx.tx.signer, 12)}</span></div>
                                     ${recipient ? `<div>To: <span style="color: rgb(24, 255, 178);">${Utils.formatHash(recipient, 12)}</span></div>` : ''}` :
                                    `<div>Signer: <span style="color: rgb(24, 255, 178);">${Utils.formatHash(tx.tx.signer, 12)}</span></div>`
                                }
                                <div class="tx-contract">${action.contract}</div>
                            </div>
                            <div class="tx-meta">
                                ${amount ? `<div class="tx-amount">${amount}</div>` : ''}
                                ${tx.result && tx.result.exec_used ? `<div style="font-size: 0.8em; color: rgb(255, 193, 7);">Gas: ${(tx.result.exec_used / 1e9).toFixed(4)}</div>` : ''}
                                <div class="tx-time">${timestamp}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        container.innerHTML = html;
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

    // Entry (bloc) avec filtrage optionnel par fonction
    async getEntry(entryHash, filterFunction = null) {
        const filter = filterFunction ? `?filter_on_function=${filterFunction}` : '';
        return await this.request(`/api/chain/hash/${entryHash}${filter}`);
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
            // Ajouter un timestamp pour éviter le cache
            const timestamp = Date.now();
            const response = await fetch(`/pflops_data.json?t=${timestamp}`, {
                cache: 'no-cache'
            });
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error loading PFLOPS data:', error);
            throw error;
        }
    },

    // Validators scores from current epoch
    async getValidators() {
        return await this.request('/api/epoch/score');
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

        // Gérer les URLs au chargement
        this.initUrlRouting();

        // Afficher la page d'accueil par défaut ou parser l'URL actuelle
        const urlData = this.parseUrl();
        this.showPage(urlData.page, false, urlData.params);
    },

    showPage(pageName, updateUrl = true, params = null) {
        // Stop account tracking if leaving address page
        if (AppState.currentPage === 'address' && pageName !== 'address' && AppState.accountTracking.enabled) {
            AccountTracker.stopTracking();
        }

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

            // Mettre à jour l'URL
            if (updateUrl) {
                this.updateUrl(pageName, params);
            }

            // Charger les données de la page
            this.loadPageData(pageName, params);
        }
    },

    updateUrl(pageName, params = null) {
        let url = '/';

        switch (pageName) {
            case 'address':
                if (params && params.address) {
                    url = `/address/${params.address}`;
                }
                break;
            case 'block':
                if (params && params.blockNumber) {
                    url = `/block/${params.blockNumber}`;
                }
                break;
            case 'transaction':
                if (params && params.txHash) {
                    url = `/transaction/${params.txHash}`;
                }
                break;
            case 'home':
                url = '/';
                break;
            default:
                url = `/${pageName}`;
                break;
        }

        history.pushState({ page: pageName, params }, '', url);
    },

    parseUrl() {
        // Vérifier d'abord le hash pour les URLs de fallback
        let path = window.location.pathname;
        if (window.location.hash && window.location.hash.startsWith('#/')) {
            path = window.location.hash.substring(1); // Enlever le #
        }

        const pathParts = path.split('/').filter(part => part);

        if (pathParts.length === 0) {
            return { page: 'home', params: null };
        }

        if (pathParts.length === 2) {
            const [type, value] = pathParts;

            if (type === 'address') {
                AppState.currentAddress = value;
                return { page: 'address', params: { address: value } };
            }

            if (type === 'block') {
                return { page: 'block', params: { blockNumber: value } };
            }

            if (type === 'transaction' || type === 'tx') {
                return { page: 'transaction', params: { txHash: value } };
            }
        }

        // Page simple (blocks, transactions, richlist, pflops)
        if (['blocks', 'transactions', 'richlist', 'pflops'].includes(pathParts[0])) {
            return { page: pathParts[0], params: null };
        }

        return { page: 'home', params: null };
    },

    initUrlRouting() {
        // Gérer le bouton retour/avant du navigateur
        window.addEventListener('popstate', (event) => {
            if (event.state) {
                this.showPage(event.state.page, false, event.state.params);
            } else {
                const urlData = this.parseUrl();
                this.showPage(urlData.page, false, urlData.params);
            }
        });
    },

    async loadPageData(pageName, params = null) {
        console.log('Loading page:', pageName, 'with params:', params);

        // Clear validators auto-refresh interval when leaving the page
        if (pageName !== 'validators' && AppState.validatorsInterval) {
            clearInterval(AppState.validatorsInterval);
            AppState.validatorsInterval = null;
        }

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
            case 'validators':
                await this.loadValidatorsPage();
                break;
            case 'pflops':
                await this.loadPflopPage();
                break;
            case 'block':
                await this.loadBlockPage(params);
                break;
            case 'transaction':
                await this.loadTransactionPage(params);
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
                AppState.stats = statsData.stats;
                AppState.lastHeight = statsData.stats.height;  // Initialiser la hauteur
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

        // Animer le changement de hauteur avec effet flip
        this.animateHeight(stats.height || 0);

        document.getElementById('currentEpoch').textContent = currentEpoch;
        document.getElementById('circulatingSupply').textContent = `${Utils.formatNumber(stats.circulating || 0)}`;
        document.getElementById('pflopsStat').textContent = (stats.pflops || 0).toFixed(2);
        document.getElementById('tpsStat').textContent = (stats.txs_per_sec || 0).toFixed(1);

        AppState.stats = stats;
    },

    animateHeight(newHeight) {
        const heightElement = document.getElementById('currentHeight');
        const newHeightStr = newHeight.toLocaleString('en-US');

        // Mise à jour directe sans animation
        heightElement.textContent = newHeightStr;
        heightElement.setAttribute('data-height', newHeightStr);
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
                    const blockData = await API.request(`/api/chain/height/${height}`);
                    if (blockData.entries && blockData.entries.length > 0) {
                        blocks.push(blockData.entries[0]);
                    }
                } catch (error) {
                    console.warn(`Impossible de charger le block ${height}:`, error);
                }
            }

            await this.renderLatestBlocks(blocks.slice(0, 10));
        } catch (error) {
            console.error('Error loading latest blocks:', error);
        }
    },

    async renderLatestBlocks(blocks) {
        const container = document.getElementById('latestBlocks');

        if (!blocks || blocks.length === 0) {
            container.innerHTML = '<div class="text-secondary">No blocks available</div>';
            return;
        }

        const html = blocks.map((block, index) => {
            return `
                <div class="block-item" onclick="PageManager.showPage('block', true, {blockNumber: '${block.header.height}'})">
                    <div class="block-info">
                        <h4>Block #${block.header.height}</h4>
                        <p class="text-truncate">${Utils.formatHash(block.hash, 12)}</p>
                    </div>
                    <div class="block-meta">
                        <div class="tx-count">${block.tx_count || 0} txs</div>
                    </div>
                </div>
            `;
        }).join('');

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

            // Charger les détails complets (avec result) pour les 10 premières transactions en parallèle
            const txsToDisplay = allTransactions.slice(0, 10);
            const detailPromises = txsToDisplay.map(tx =>
                API.getTransaction(tx.hash).catch(() => tx) // Fallback sur la transaction sans détails
            );
            const txsWithDetails = await Promise.all(detailPromises);

            this.renderLatestTransactions(txsWithDetails);

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

        const html = transactions.filter(tx => tx.tx && tx.tx.action).map(tx => {
            const action = tx.tx.action;
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

            // Extraire et formater le statut
            let txStatus = 'pending';
            if (tx.result && tx.result.error) {
                txStatus = tx.result.error;
            } else if (tx.receipt && tx.receipt.result) {
                txStatus = tx.receipt.result;
            }
            const isSuccess = txStatus === 'ok' || txStatus === ':ok';

            const formatStatus = (status) => {
                if (status === 'ok' || status === ':ok') return 'OK';
                return status
                    .replace(/^:/, '')
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            };

            const statusText = formatStatus(txStatus);
            const statusBadge = `<span style="
                display: inline-block;
                padding: 0.1rem 0.4rem;
                border-radius: 8px;
                font-size: 0.65rem;
                font-weight: bold;
                background: ${isSuccess ? 'rgba(50, 205, 50, 0.2)' : 'rgba(255, 99, 71, 0.2)'};
                color: ${isSuccess ? '#32cd32' : '#ff6347'};
                margin-left: 0.3rem;
            ">${statusText}</span>`;

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
                <div class="transaction-item-small" onclick="SearchManager.showTransactionFromHash('${tx.hash}')">
                    <div class="tx-info">
                        <div class="tx-hash-small">${Utils.formatHash(tx.hash, 12)}</div>
                        <div class="tx-function-small">${action.function} ${statusBadge}</div>
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
        container.innerHTML = '<div class="loading">Loading latest 20 blocks...</div>';

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

            // Charger les 20 derniers blocks
            for (let i = 0; i < 20; i++) {
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

        const html = `
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-cubes"></i> Latest 20 Blocks</h2>
                </div>
                <div class="card-content">
                    <div class="blocks-list">
                        ${blocks.map((block, index) => `
                            <div class="block-item" onclick="PageManager.showPage('block', true, {blockNumber: '${block.header.height}'})">
                                <div class="block-info">
                                    <h4>Block #${block.header.height}</h4>
                                    <p class="text-truncate">${Utils.formatHash(block.hash, 16)}</p>
                                </div>
                                <div class="block-meta">
                                    <div class="tx-count">${block.tx_count || 0} txs</div>
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
        container.innerHTML = '<div class="loading">Loading latest 20 transactions...</div>';

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
            for (let i = 0; i < 15 && allTransactions.length < 20; i++) {
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
                                if (allTransactions.length >= 20) break;
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
                    <h2><i class="fas fa-exchange-alt"></i> Latest 20 Transactions</h2>
                </div>
                <div class="card-content">
                    <div class="transactions-list">
                        ${transactions.filter(tx => tx.tx && tx.tx.action).map(tx => {
                            const action = tx.tx.action;
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
                                <div class="transaction-item" onclick="SearchManager.showTransactionFromHash('${tx.hash}')">
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
                                        <div class="tx-time">${tx.metadata?.entry_height ? 'Slot ' + tx.metadata.entry_height : '-'}</div>
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

    async loadValidatorsPage() {
        // Clear existing interval if any
        if (AppState.validatorsInterval) {
            clearInterval(AppState.validatorsInterval);
            AppState.validatorsInterval = null;
        }

        const loadData = async () => {
            const container = document.getElementById('validatorsContainer');
            const totalValidatorsEl = document.getElementById('totalValidators');
            const totalScoreEl = document.getElementById('totalScore');
            const topValidatorEl = document.getElementById('topValidator');
            const totalBurnedEl = document.getElementById('totalBurned');

            try {
                // Get validators data
                const validators = await API.getValidators();

                // Get chain stats for burned value
                const statsData = await API.getStats();
                const burned = statsData?.stats?.burned || 0;

                // Calculate statistics
                const totalValidators = validators.length;
                const totalScore = validators.reduce((sum, [, score]) => sum + score, 0);
                const topValidator = validators.length > 0 ? Utils.formatHash(validators[0][0], 8) : 'N/A';

                // Update statistics
                totalValidatorsEl.textContent = Utils.formatNumber(totalValidators);
                totalScoreEl.textContent = Utils.formatNumber(totalScore);
                topValidatorEl.textContent = topValidator;
                totalBurnedEl.textContent = Utils.formatNumber(burned) + ' AMA';

                // Render validators table
                this.renderValidatorsTable(validators);

            } catch (error) {
                console.error('Error loading validators:', error);
                container.innerHTML = `
                    <div class="card">
                        <div class="card-content">
                            <p>Error loading validators data. Please try again later.</p>
                        </div>
                    </div>
                `;
            }
        };

        // Load initial data
        await loadData();

        // Auto-refresh every 30 seconds
        AppState.validatorsInterval = setInterval(() => {
            if (AppState.currentPage === 'validators') {
                loadData();
            }
        }, 30000);
    },

    renderValidatorsTable(validators) {
        const container = document.getElementById('validatorsContainer');

        if (!validators || validators.length === 0) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>No validators data available.</p>
                    </div>
                </div>
            `;
            return;
        }

        const html = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 80px;">Rank</th>
                        <th>Validator Address</th>
                        <th style="width: 150px; text-align: right;">Score</th>
                        <th style="width: 120px; text-align: right;">Percentage</th>
                    </tr>
                </thead>
                <tbody>
                    ${validators.map(([address, score], index) => {
                        const totalScore = validators.reduce((sum, [, s]) => sum + s, 0);
                        const percentage = totalScore > 0 ? ((score / totalScore) * 100).toFixed(2) : '0.00';
                        return `
                            <tr>
                                <td style="text-align: center;">
                                    ${index === 0 ? '<i class="fas fa-crown" style="color: gold;"></i>' : '#' + (index + 1)}
                                </td>
                                <td>
                                    <span onclick="BlockExplorer.viewAddress('${address}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">
                                        ${Utils.formatHash(address, 16)}
                                    </span>
                                </td>
                                <td style="text-align: right; font-weight: 600;">
                                    ${Utils.formatNumber(score)}
                                </td>
                                <td style="text-align: right;">
                                    ${percentage}%
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    },

    async loadPflopPage() {
        console.log('Loading PFLOPS page...');
        const chartContainer = document.getElementById('pflopschartContainer');
        const chartLoading = document.getElementById('chartLoading');
        const tpsChartContainer = document.getElementById('tpschartContainer');
        const tpsChartLoading = document.getElementById('tpsChartLoading');

        try {
            if (chartLoading) chartLoading.style.display = 'block';
            if (tpsChartLoading) tpsChartLoading.style.display = 'block';

            // Get PFLOPS data
            console.log('Fetching PFLOPS data...');
            const data = await API.getPflopData();
            console.log('PFLOPS data received:', data);
            const pflopData = data.data || [];
            console.log('PFLOPS data array:', pflopData.length, 'entries');

            if (pflopData.length === 0) {
                chartContainer.innerHTML = `
                    <div class="card">
                        <div class="card-content">
                            <p>No PFLOPS data available yet. The data collection script needs to run first.</p>
                            <p>Run: <code>node collect_pflops.js</code> to start collecting data.</p>
                        </div>
                    </div>
                `;
                tpsChartContainer.innerHTML = `
                    <div class="card">
                        <div class="card-content">
                            <p>No TPS data available yet.</p>
                        </div>
                    </div>
                `;
                return;
            }

            // Update statistics
            this.updatePflopStats(pflopData);

            // Initialize PFLOPS chart
            console.log('Initializing PFLOPS chart...');
            this.initPflopChart(pflopData);
            console.log('PFLOPS chart initialized');

            // Initialize TPS chart
            console.log('Initializing TPS chart...');
            this.initTpsChart(pflopData);
            console.log('TPS chart initialized');

            // Reset time filter buttons to default (24h)
            this.resetTimeFilters();

            // Initialize time filters
            this.initTimeFilters(pflopData);

            if (chartLoading) chartLoading.style.display = 'none';
            if (tpsChartLoading) tpsChartLoading.style.display = 'none';

        } catch (error) {
            console.error('Error loading PFLOPS page:', error);
            if (chartLoading) chartLoading.style.display = 'none';
            if (tpsChartLoading) tpsChartLoading.style.display = 'none';
            chartContainer.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>Error loading PFLOPS data. Please try again later.</p>
                    </div>
                </div>
            `;
            tpsChartContainer.innerHTML = `
                <div class="card">
                    <div class="card-content">
                        <p>Error loading TPS data. Please try again later.</p>
                    </div>
                </div>
            `;
        }
    },

    updatePflopStats(data) {
        console.log('Updating PFLOP stats with', data.length, 'entries');
        const currentPflops = document.getElementById('currentPflops');
        const avgPflops24h = document.getElementById('avgPflops24h');
        const peakPflops24h = document.getElementById('peakPflops24h');
        const currentTps = document.getElementById('currentTps');

        if (data.length === 0) return;

        // Current PFLOPS and TPS
        const latest = data[data.length - 1];
        console.log('Latest entry:', latest);
        currentPflops.textContent = latest.pflops.toFixed(2);
        currentTps.textContent = (latest.txs_per_sec || 0).toFixed(1);
        console.log('Set TPS to:', latest.txs_per_sec || 0);

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

    },

    initPflopChart(data) {
        console.log('initPflopChart called with data:', data.length, 'entries');
        const ctx = document.getElementById('pflopsChart').getContext('2d');

        // Store chart instance for later updates
        if (window.pflopChart && typeof window.pflopChart.destroy === 'function') {
            window.pflopChart.destroy();
        }

        console.log('Processing chart data...');
        const chartData = this.processChartData(data, '24h');
        console.log('Chart data processed:', chartData);

        // Store timestamps and heights for tooltips
        this.chartTimestamps = chartData.timestamps;
        this.chartHeights = chartData.heights;

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
                                if (!context || !context[0]) return '';
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
                                return context[0].label || '';
                            },
                            label: function(context) {
                                if (!context) return '';
                                const index = context.dataIndex;
                                const pflops = `PFLOPS: ${context.parsed.y.toFixed(2)}`;
                                const height = PageManager.chartHeights && PageManager.chartHeights[index]
                                    ? `Block: ${PageManager.chartHeights[index].toLocaleString()}`
                                    : 'Block: N/A';
                                return [pflops, height];
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
                            stepSize: 5,
                            callback: function(value) {
                                return value.toFixed(0);
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
                        grace: '5%'
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    },

    initTpsChart(data) {
        console.log('initTpsChart called with data:', data.length, 'entries');
        const ctx = document.getElementById('tpsChart').getContext('2d');

        // Store chart instance for later updates
        if (window.tpsChart && typeof window.tpsChart.destroy === 'function') {
            window.tpsChart.destroy();
        }

        console.log('Processing TPS chart data...');
        const chartData = this.processTpsChartData(data, '24h');
        console.log('TPS chart data processed:', chartData);

        // Store timestamps and heights for tooltips (reuse same variables as PFLOPS)
        this.chartTimestamps = chartData.timestamps;
        this.chartHeights = chartData.heights;

        window.tpsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: 'TPS',
                    data: chartData.values,
                    borderColor: 'rgb(255, 193, 7)',
                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
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
                        titleColor: 'rgb(255, 193, 7)',
                        bodyColor: '#ffffff',
                        borderColor: 'rgb(255, 193, 7)',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                if (!context || !context[0]) return '';
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
                                return context[0].label || '';
                            },
                            label: function(context) {
                                if (!context) return '';
                                const index = context.dataIndex;
                                const tps = `TPS: ${context.parsed.y.toFixed(1)}`;
                                const height = PageManager.chartHeights && PageManager.chartHeights[index]
                                    ? `Block: ${PageManager.chartHeights[index].toLocaleString()}`
                                    : 'Block: N/A';
                                return [tps, height];
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
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#b3b3b3',
                            stepSize: 5,
                            callback: function(value) {
                                return value.toFixed(0);
                            }
                        },
                        grace: '10%'
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
            default:
                filtered = data.filter(entry => now - entry.timestamp <= 7 * 24 * 60 * 60 * 1000);
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
            timestamps: filtered.map(entry => entry.timestamp),
            heights: filtered.map(entry => entry.height || null)
        };
    },

    processTpsChartData(data, period) {
        const now = Date.now();
        let filtered = data;

        // Filter by time period
        switch (period) {
            case '24h':
                filtered = data.filter(entry => now - entry.timestamp <= 24 * 60 * 60 * 1000);
                break;
            case '7d':
            default:
                filtered = data.filter(entry => now - entry.timestamp <= 7 * 24 * 60 * 60 * 1000);
                break;
        }

        // Always use filtered data but ensure TPS values exist
        const chartEntries = filtered;

        return {
            labels: chartEntries.map(entry => {
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
            values: chartEntries.map(entry => entry.txs_per_sec || 0),
            timestamps: chartEntries.map(entry => entry.timestamp),
            heights: chartEntries.map(entry => entry.height || null)
        };
    },

    resetTimeFilters() {
        const filters = document.querySelectorAll('.time-filter');
        filters.forEach(filter => {
            filter.classList.remove('active');
            if (filter.dataset.period === '24h') {
                filter.classList.add('active');
            }
        });
    },

    initTimeFilters(data) {
        const filters = document.querySelectorAll('.time-filter');
        filters.forEach(filter => {
            filter.addEventListener('click', (e) => {
                // Update active filter
                filters.forEach(f => f.classList.remove('active'));
                e.target.classList.add('active');

                // Update both charts
                const period = e.target.dataset.period;
                console.log('Updating charts for period:', period);
                const pflopChartData = this.processChartData(data, period);
                const tpsChartData = this.processTpsChartData(data, period);

                console.log('PFLOP chart data:', pflopChartData);
                console.log('TPS chart data:', tpsChartData);

                // Update stored data for tooltips
                this.chartTimestamps = pflopChartData.timestamps;
                this.chartHeights = pflopChartData.heights;

                if (window.pflopChart && pflopChartData.labels.length > 0) {
                    window.pflopChart.data.labels = pflopChartData.labels;
                    window.pflopChart.data.datasets[0].data = pflopChartData.values;
                    window.pflopChart.update();
                } else {
                    console.log('PFLOP chart not updated - missing chart or data');
                }

                if (window.tpsChart && tpsChartData.labels.length > 0) {
                    window.tpsChart.data.labels = tpsChartData.labels;
                    window.tpsChart.data.datasets[0].data = tpsChartData.values;
                    window.tpsChart.update();
                } else {
                    console.log('TPS chart not updated - missing chart or data');
                }
            });
        });
    },

    async loadBlockPage(params) {
        if (!params || !params.blockNumber) {
            this.showPage('home');
            return;
        }

        const blockNumber = parseInt(params.blockNumber);
        if (isNaN(blockNumber)) {
            Utils.showToast('Invalid block number', 'error');
            this.showPage('home');
            return;
        }

        try {
            // Charger les données du bloc
            const blockData = await API.getBlocksByHeight(blockNumber);
            if (!blockData || !blockData.entries || blockData.entries.length === 0) {
                Utils.showToast('Block not found', 'error');
                this.showPage('home');
                return;
            }

            // Utiliser l'ancien système de modal mais pour cette page
            const block = blockData.entries[0];
            BlockExplorer.renderBlockModal(block);
            document.getElementById('modal').style.display = 'block';

        } catch (error) {
            console.error('Error loading block page:', error);
            Utils.showToast('Error loading block', 'error');
            this.showPage('home');
        }
    },

    async loadTransactionPage(params) {
        if (!params || !params.txHash) {
            this.showPage('home');
            return;
        }

        try {
            // Récupérer les données de la transaction depuis l'API
            const txData = await API.getTransaction(params.txHash);
            if (!txData) {
                Utils.showToast('Transaction not found', 'error');
                this.showPage('home');
                return;
            }

            // Utiliser le système de modal existant pour les transactions
            SearchManager.showTransactionModal(txData);
        } catch (error) {
            console.error('Error loading transaction page:', error);
            Utils.showToast('Error loading transaction', 'error');
            this.showPage('home');
        }
    },

    renderBlockDetails(block, container) {
        const html = `
            <div class="card">
                <div class="card-header">
                    <h2><i class="fas fa-cube"></i> Block Information</h2>
                </div>
                <div class="card-content">
                    <div class="block-details">
                        <div class="detail-row">
                            <span class="label">Height:</span>
                            <span class="value">${block.header.height}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Hash:</span>
                            <span class="value hash">${block.hash}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Previous Hash:</span>
                            <span class="value hash">${block.header.previous_hash}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Slot:</span>
                            <span class="value">${block.header.slot}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Timestamp:</span>
                            <span class="value">${new Date(block.header.timestamp * 1000).toLocaleString()}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Transactions:</span>
                            <span class="value">${block.tx_count || 0}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = html;
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

        // Bouton refresh
        document.getElementById('refreshAddressBtn').onclick = async () => {
            try {
                // Reset cursor and reload all address data
                AppState.currentAddressData.cursor = null;
                AppState.currentAddressData.transactions = [];

                const typeFilter = document.getElementById('txTypeFilter');
                const limitFilter = document.getElementById('txLimitFilter');

                // Reload balances
                const balanceData = await API.getAllBalances(address);
                this.renderAddressBalances(balanceData.balances || []);

                // Reload transactions
                await this.loadAddressTransactions(address, typeFilter.value, parseInt(limitFilter.value));

                Utils.showToast('Address data refreshed', 'success');
            } catch (error) {
                console.error('Error refreshing address data:', error);
                Utils.showToast('Error refreshing data', 'error');
            }
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
                                    ${(entry.pk.startsWith('69TDon8KJ') || entry.pk.startsWith('6969GaCysicY')) ? '<span class="team-badge">Treasury</span>' : ''}
                                </div>
                                <div class="balance-col">
                                    <span class="balance-amount">${Math.floor(balance).toLocaleString('en-US')} AMA</span>
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

    // Helper pour déduire le type de transaction
    deduceTxType(tx, currentAddress) {
        if (tx.metadata?.tx_event) {
            return tx.metadata.tx_event;
        }
        if (currentAddress) {
            if (tx.tx.signer === currentAddress) {
                return 'sent';
            }
            const action = tx.tx.action;
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';
            if (isTransfer && action.args.length > 0 && action.args[0] === currentAddress) {
                return 'recv';
            }
        }
        return 'transaction';
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

        const html = transactions.filter(tx => tx.tx && tx.tx.action).map(tx => {
            const action = tx.tx.action;
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';
            const txType = this.deduceTxType(tx, AppState.currentAddress);

            // Extraire et formater le statut
            let txStatus = 'pending';
            if (tx.result && tx.result.error) {
                txStatus = tx.result.error;
            } else if (tx.receipt && tx.receipt.result) {
                txStatus = tx.receipt.result;
            }
            const isSuccess = txStatus === 'ok' || txStatus === ':ok';

            const formatStatus = (status) => {
                if (status === 'ok' || status === ':ok') return 'OK';
                return status
                    .replace(/^:/, '')
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            };

            const statusText = formatStatus(txStatus);
            const statusBadge = `<span style="
                display: inline-block;
                padding: 0.15rem 0.4rem;
                border-radius: 8px;
                font-size: 0.7rem;
                font-weight: bold;
                background: ${isSuccess ? 'rgba(50, 205, 50, 0.2)' : 'rgba(255, 99, 71, 0.2)'};
                color: ${isSuccess ? '#32cd32' : '#ff6347'};
                margin-left: 0.3rem;
            ">${statusText}</span>`;

            let amount = '';
            if (isTransfer && action.args.length >= 2) {
                const amountValue = action.args[1];
                const symbol = action.args[2] || 'AMA';
                amount = `${parseFloat(amountValue) / 1e9} ${symbol}`;
            }

            return `
                <div class="transaction-item" onclick="SearchManager.showTransactionFromHash('${tx.hash}')">
                    <div class="tx-main-info">
                        <div class="tx-hash">${Utils.formatHash(tx.hash, 16)}</div>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start;">
                            <span class="tx-type ${txType}" style="display: inline-block; width: auto;">${txType === 'sent' ? 'Sent' : txType === 'recv' ? 'Received' : action.function}</span>
                            ${tx.metadata?.entry_height ? `<span style="font-size: 0.8em; color: #b3b3b3;">${
                                (tx.tx && tx.tx.nonce) ?
                                    new Date(tx.tx.nonce / 1000000).toLocaleString('fr-FR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                    }) :
                                    tx.nonce ?
                                    new Date(tx.nonce / 1000000).toLocaleString('fr-FR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                    }) :
                                    Utils.formatSlotToDateTime(tx.metadata.entry_height)
                            }</span>` : ''}
                        </div>
                    </div>
                    <div class="tx-details">
                        <div class="tx-function">${action.function} ${statusBadge}</div>
                        <div class="tx-contract">${Utils.formatHash(action.contract, 8)}</div>
                    </div>
                    <div class="tx-meta">
                        ${amount ? `<div class="tx-amount">${amount}</div>` : ''}
                        <div class="tx-time">${tx.metadata?.entry_height ? 'Slot ' + tx.metadata.entry_height : '-'}</div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    },

    updateTransactionStats(transactions) {
        const sentCount = transactions.filter(tx => this.deduceTxType(tx, AppState.currentAddress) === 'sent').length;
        const recvCount = transactions.filter(tx => this.deduceTxType(tx, AppState.currentAddress) === 'recv').length;
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
            <h2>Block #${block.header.height} Details</h2>
            <div style="margin: 2rem 0;">
                <div style="display: grid; gap: 1rem;">
                    <div><strong>Hash:</strong> <span onclick="Utils.copyToClipboard('${block.hash}')" style="cursor: pointer; color: rgb(24, 255, 178);">${block.hash}</span></div>
                    <div><strong>Height:</strong> ${block.header.height}</div>
                    <div><strong>Slot:</strong> ${block.header.slot}</div>
                    <div><strong>Previous Slot:</strong> ${block.header.prev_slot}</div>
                    <div><strong>Previous Hash:</strong> ${Utils.formatHash(block.header.prev_hash, 16)}</div>
                    <div><strong>Signer:</strong> ${Utils.formatHash(block.header.signer, 12)}</div>
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
                // Charger les détails complets (avec result) pour toutes les transactions en parallèle
                const detailPromises = txsData.txs.map(tx =>
                    API.getTransaction(tx.hash).catch(() => tx) // Fallback sur la transaction sans détails
                );
                const txsWithDetails = await Promise.all(detailPromises);

                this.renderBlockTransactions(txsWithDetails, transactionsContainer);
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
        const html = transactions.filter(tx => tx.tx && tx.tx.action).map((tx, index) => {
            const action = tx.tx.action;
            const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

            // Extraire et formater le statut
            let txStatus = 'pending';
            if (tx.result && tx.result.error) {
                txStatus = tx.result.error;
            } else if (tx.receipt && tx.receipt.result) {
                txStatus = tx.receipt.result;
            }
            const isSuccess = txStatus === 'ok' || txStatus === ':ok';

            const formatStatus = (status) => {
                if (status === 'ok' || status === ':ok') return 'OK';
                return status
                    .replace(/^:/, '')
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            };

            const statusText = formatStatus(txStatus);
            const statusBadge = `<span style="
                display: inline-block;
                padding: 0.2rem 0.5rem;
                border-radius: 8px;
                font-size: 0.75rem;
                font-weight: bold;
                background: ${isSuccess ? 'rgba(50, 205, 50, 0.2)' : 'rgba(255, 99, 71, 0.2)'};
                color: ${isSuccess ? '#32cd32' : '#ff6347'};
                margin-left: 0.5rem;
            ">${statusText}</span>`;

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
                <div class="transaction-item-modal" onclick="SearchManager.showTransactionFromHash('${tx.hash}')" style="
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
                            <div>${action.function} ${statusBadge}</div>
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
        PageManager.showPage('address', true, { address: address });
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
            PageManager.showPage('address', true, { address: address });
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

    async showTransactionFromHash(hash) {
        try {
            const txData = await API.getTransaction(hash);
            if (txData) {
                this.showTransactionModal(txData);
            } else {
                Utils.showToast('Transaction not found', 'error');
            }
        } catch (error) {
            console.error('Error loading transaction:', error);
            Utils.showToast('Error loading transaction', 'error');
        }
    },

    goToTransactionPage(txHash) {
        // Fermer le modal d'abord
        const modal = document.getElementById('modal');
        if (modal) {
            modal.style.display = 'none';
        }
        // Puis naviguer vers la page transaction
        PageManager.showPage('transaction', true, {txHash: txHash});
    },

    goToBlockBySlot(slot) {
        // Fermer le modal d'abord
        const modal = document.getElementById('modal');
        if (modal) {
            modal.style.display = 'none';
        }
        // Utiliser le slot comme numéro de bloc
        PageManager.showPage('block', true, {blockNumber: slot.toString()});
    },


    showTransactionModal(tx) {
        const modalBody = document.getElementById('modalBody');

        if (!tx.tx || !tx.tx.action) {
            modalBody.innerHTML = '<p>Error: Invalid transaction data</p>';
            return;
        }

        const action = tx.tx.action;
        const isTransfer = action.contract === 'Coin' && action.function === 'transfer';

        // Extraire et formater le statut de la transaction
        let txStatus = 'pending';
        if (tx.result && tx.result.error) {
            txStatus = tx.result.error;
        } else if (tx.receipt && tx.receipt.result) {
            txStatus = tx.receipt.result;
        }

        const isSuccess = txStatus === 'ok' || txStatus === ':ok';

        // Formater le statut pour l'affichage (snake_case -> Title Case)
        const formatStatus = (status) => {
            if (status === 'ok' || status === ':ok') return 'OK';
            return status
                .replace(/^:/, '')
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        };

        const statusText = formatStatus(txStatus);
        const statusBadge = `
            <span style="
                display: inline-block;
                padding: 0.3rem 0.8rem;
                border-radius: 12px;
                font-size: 0.85rem;
                font-weight: bold;
                background: ${isSuccess ? 'rgba(50, 205, 50, 0.2)' : 'rgba(255, 99, 71, 0.2)'};
                color: ${isSuccess ? '#32cd32' : '#ff6347'};
                border: 1px solid ${isSuccess ? '#32cd32' : '#ff6347'};
            ">
                <i class="fas fa-${isSuccess ? 'check-circle' : 'times-circle'}"></i> ${statusText}
            </span>
        `;

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
                        ${tx.metadata && tx.metadata.entry_height ? `
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center;">
                            <strong>Date:</strong>
                            <span style="color: #b3b3b3;">
                                ${tx.tx.nonce ?
                                    new Date(tx.tx.nonce / 1000000).toLocaleString('fr-FR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                    }) :
                                    Utils.formatSlotToDateTime(tx.metadata.entry_height)
                                }
                            </span>
                        </div>` : ''}
                    </div>
                </div>
            `;
        }

        // Format execution info section
        let executionInfo = '';
        if (tx.result) {
            const hasExecUsed = tx.result.exec_used !== undefined;
            const hasLogs = tx.result.logs && tx.result.logs.length > 0;

            if (hasExecUsed || hasLogs) {
                executionInfo = `
                    <div style="background: rgba(255, 193, 7, 0.1); padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                        <h3 style="margin: 0 0 1rem 0; color: rgb(255, 193, 7);"><i class="fas fa-tachometer-alt"></i> Execution Details</h3>
                        <div style="display: grid; gap: 0.75rem;">
                            ${hasExecUsed ? `
                                <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center;">
                                    <strong>Gas Used:</strong>
                                    <span style="font-family: monospace; color: rgb(255, 193, 7);">${(tx.result.exec_used / 1e9).toFixed(6)} AMA</span>
                                </div>
                            ` : ''}
                            ${hasLogs ? `
                                <div style="display: grid; gap: 0.5rem;">
                                    <strong>Logs:</strong>
                                    <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 6px; border-left: 3px solid rgb(255, 193, 7);">
                                        ${tx.result.logs.map((log, idx) => `
                                            <div style="font-family: monospace; font-size: 0.9em; padding: 0.25rem 0; color: #e0e0e0;">
                                                <span style="color: rgb(255, 193, 7); margin-right: 0.5rem;">[${idx + 1}]</span>${log}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }
        }

        const html = `
            <h2>Transaction Details</h2>
            ${transferInfo}
            ${executionInfo}
            <div style="margin: 2rem 0;">
                <div style="display: grid; gap: 1rem;">
                    <div><strong>Hash:</strong> <span onclick="SearchManager.goToTransactionPage('${tx.hash}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;" title="Cliquer pour aller à la page de la transaction">${tx.hash}</span></div>
                    <div><strong>Status:</strong> ${statusBadge}</div>
                    ${!isTransfer ? `<div><strong>Signer:</strong> <span onclick="BlockExplorer.viewAddress('${tx.tx.signer}')" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;">${Utils.formatHash(tx.tx.signer, 16)}</span></div>` : ''}
                    <div><strong>Nonce:</strong> ${tx.tx.nonce}</div>
                    <div><strong>Contract:</strong> ${action.contract}</div>
                    <div><strong>Function:</strong> ${action.function}</div>
                    ${tx.metadata ? `<div><strong>Block:</strong> <span onclick="SearchManager.goToBlockBySlot(${tx.metadata.entry_height})" style="cursor: pointer; color: rgb(24, 255, 178); text-decoration: underline;" title="Cliquer pour voir les détails du bloc">${tx.metadata.entry_height}</span></div>` : ''}
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
            // Si on est sur une page "block" ou "transaction", retourner à la page précédente
            if (AppState.currentPage === 'block' || AppState.currentPage === 'transaction') {
                PageManager.showPage('home');
            }
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                // Si on est sur une page "block" ou "transaction", retourner à la page précédente
                if (AppState.currentPage === 'block' || AppState.currentPage === 'transaction') {
                    PageManager.showPage('home');
                }
            }
        });
    }
};

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', () => {
    PageManager.init();
    SearchManager.init();
    ModalManager.init();
    WebSocketManager.init();
    AccountTracker.init();

    // Rafraîchissement automatique désactivé (WebSocket prend le relais)
    // setInterval(() => {
    //     if (AppState.currentPage === 'home') {
    //         PageManager.loadHomePage();
    //     }
    // }, 30000);

    // Rafraîchissement automatique désactivé (WebSocket prend le relais)
    // setInterval(async () => {
    //     if (AppState.currentPage === 'home') {
    //         try {
    //             // Charger seulement les stats pour avoir le slot actuel
    //             const stats = await API.getStats();
    //             if (stats) {
    //                 AppState.stats = stats.stats;
    //             }
    //
    //             // Charger seulement les derniers blocs
    //             await PageManager.loadLatestBlocks();
    //         } catch (error) {
    //             console.error('Error refreshing latest blocks:', error);
    //         }
    //     }
    // }, 10000);

    // Mise à jour des temps relatifs toutes les secondes
    // On ajoute le temps écoulé depuis le chargement au temps initial
    setInterval(() => {
        if (AppState.currentPage === 'home') {
            const timeElements = document.querySelectorAll('.block-item .time');
            const now = Date.now();

            timeElements.forEach(element => {
                const loadTime = parseInt(element.getAttribute('data-load-time'));
                const initialText = element.getAttribute('data-initial-text');

                if (!loadTime || !initialText) return;

                // Calculer le temps écoulé depuis le chargement
                const elapsedSeconds = Math.floor((now - loadTime) / 1000);

                // Parser le texte initial pour extraire la valeur
                let match;
                let baseSeconds = 0;

                if (initialText === 'now') {
                    baseSeconds = 0;
                } else if (match = initialText.match(/il y a (\d+)s/)) {
                    baseSeconds = parseInt(match[1]);
                } else if (match = initialText.match(/il y a (\d+)min/)) {
                    baseSeconds = parseInt(match[1]) * 60;
                } else if (match = initialText.match(/il y a (\d+)h/)) {
                    baseSeconds = parseInt(match[1]) * 3600;
                } else if (match = initialText.match(/il y a (\d+)j/)) {
                    baseSeconds = parseInt(match[1]) * 86400;
                } else {
                    // Format non reconnu, ne rien changer
                    return;
                }

                // Temps total = temps initial + temps écoulé
                const totalSeconds = baseSeconds + elapsedSeconds;
                const minutes = Math.floor(totalSeconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                let newText;
                if (days > 0) newText = `il y a ${days}j`;
                else if (hours > 0) newText = `il y a ${hours}h`;
                else if (minutes > 0) newText = `il y a ${minutes}min`;
                else if (totalSeconds > 30) newText = `il y a ${totalSeconds}s`;
                else newText = 'now';

                element.textContent = newText;
            });
        }
    }, 1000);
});
