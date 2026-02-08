/**
 * 基金浏览器主应用
 */

const App = {
    // 状态
    state: {
        funds: [],        // 自选基金代码列表
        fundData: [],     // 基金实时数据
        sha: null,        // GitHub 文件 SHA
        isLoading: false,
        searchTimeout: null
    },

    // DOM 元素
    elements: {},

    /**
     * 初始化应用
     */
    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadData();
    },

    /**
     * 缓存 DOM 元素
     */
    cacheElements() {
        this.elements = {
            fundList: document.getElementById('fundList'),
            fundCount: document.getElementById('fundCount'),
            loading: document.getElementById('loading'),
            empty: document.getElementById('empty'),
            searchInput: document.getElementById('searchInput'),
            searchResults: document.getElementById('searchResults'),
            clearSearch: document.getElementById('clearSearch'),
            refreshBtn: document.getElementById('refreshBtn'),
            refreshBtn: document.getElementById('refreshBtn'),
            toast: document.getElementById('toast')
        };
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 搜索
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e));
        this.elements.clearSearch.addEventListener('click', () => this.clearSearch());

        // 点击外部关闭搜索结果
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search')) {
                this.elements.searchResults.classList.remove('active');
            }
        });

        // 刷新
        this.elements.refreshBtn.addEventListener('click', () => this.refreshData());
    },

    /**
     * 加载数据
     */
    async loadData() {
        this.showLoading(true);

        try {
            // 先尝试从 GitHub 加载
            if (GitHubAPI.isConfigured()) {
                try {
                    const { content, sha } = await GitHubAPI.readFile();
                    this.state.funds = content.funds || [];
                    this.state.sha = sha;
                } catch (error) {
                    console.warn('从 GitHub 加载失败，使用本地数据:', error);
                    this.loadFromLocal();
                }
            } else {
                // 从 localStorage 加载
                this.loadFromLocal();
            }

            // 获取实时数据
            if (this.state.funds.length > 0) {
                this.state.fundData = await FundAPI.getMultipleFunds(this.state.funds);
            }

            this.render();
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showToast('加载失败: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 从 localStorage 加载
     */
    loadFromLocal() {
        const saved = localStorage.getItem('fund_list');
        if (saved) {
            try {
                this.state.funds = JSON.parse(saved);
            } catch (e) {
                this.state.funds = [];
            }
        }
    },

    /**
     * 保存到 localStorage
     */
    saveToLocal() {
        localStorage.setItem('fund_list', JSON.stringify(this.state.funds));
    },

    /**
     * 刷新数据
     */
    async refreshData() {
        if (this.state.isLoading) return;

        const btn = this.elements.refreshBtn;
        btn.classList.add('loading');

        try {
            this.state.fundData = await FundAPI.getMultipleFunds(this.state.funds);
            this.render();
            this.showToast('刷新成功', 'success');
        } catch (error) {
            this.showToast('刷新失败: ' + error.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    /**
     * 搜索处理
     */
    handleSearch(e) {
        const keyword = e.target.value.trim();

        // 防抖
        clearTimeout(this.state.searchTimeout);

        if (!keyword) {
            this.elements.searchResults.classList.remove('active');
            return;
        }

        this.state.searchTimeout = setTimeout(async () => {
            const results = await FundAPI.searchFunds(keyword);
            this.renderSearchResults(results);
        }, 300);
    },

    /**
     * 渲染搜索结果
     */
    renderSearchResults(results) {
        if (!results.length) {
            this.elements.searchResults.innerHTML = `
                <div class="search__item" style="justify-content: center; color: var(--text-muted);">
                    未找到相关基金
                </div>
            `;
        } else {
            this.elements.searchResults.innerHTML = results.map(fund => {
                const isAdded = this.state.funds.includes(fund.code);
                return `
                    <div class="search__item" data-code="${fund.code}">
                        <div class="search__item-info">
                            <div class="search__item-name">${fund.name}</div>
                            <div class="search__item-code">${fund.code} · ${fund.type}</div>
                        </div>
                        <button class="search__item-add ${isAdded ? 'added' : ''}" 
                                onclick="App.addFund('${fund.code}')"
                                ${isAdded ? 'disabled' : ''}>
                            ${isAdded ? '✓' : '+'}
                        </button>
                    </div>
                `;
            }).join('');
        }

        this.elements.searchResults.classList.add('active');
    },

    /**
     * 清除搜索
     */
    clearSearch() {
        this.elements.searchInput.value = '';
        this.elements.searchResults.classList.remove('active');
    },

    /**
     * 添加基金
     */
    async addFund(code) {
        if (this.state.funds.includes(code)) return;

        this.state.funds.push(code);
        this.saveToLocal();

        // 获取新基金数据
        const newFundData = await FundAPI.getFundRealtime(code);
        if (newFundData) {
            this.state.fundData.push(newFundData);
        }

        this.render();
        this.renderSearchResults(await FundAPI.searchFunds(this.elements.searchInput.value));
        this.showToast('添加成功', 'success');

        // 自动同步到 GitHub
        if (GitHubAPI.isConfigured()) {
            this.syncToGitHub(true);
        }
    },

    /**
     * 删除基金
     */
    async removeFund(code) {
        const index = this.state.funds.indexOf(code);
        if (index === -1) return;

        this.state.funds.splice(index, 1);
        this.state.fundData = this.state.fundData.filter(f => f.code !== code);
        this.saveToLocal();
        this.render();
        this.showToast('已删除', 'success');

        // 自动同步到 GitHub
        if (GitHubAPI.isConfigured()) {
            this.syncToGitHub(true);
        }
    },

    /**
     * 同步到 GitHub
     */
    async syncToGitHub(silent = false) {
        if (!GitHubAPI.isConfigured()) {
            if (!silent) {
                this.showToast('请先配置 GitHub 设置', 'error');
            }
            return;
        }

        try {
            await GitHubAPI.syncFunds(this.state.funds);
            if (!silent) {
                this.showToast('同步成功', 'success');
            }
        } catch (error) {
            if (!silent) {
                this.showToast('同步失败: ' + error.message, 'error');
            }
            console.error('同步到 GitHub 失败:', error);
        }
    },

    /**
     * 渲染基金列表
     */
    render() {
        this.elements.fundCount.textContent = this.state.funds.length;

        if (this.state.funds.length === 0) {
            this.elements.empty.style.display = 'flex';
            // 移除已有的基金卡片
            const cards = this.elements.fundList.querySelectorAll('.fund-card');
            cards.forEach(card => card.remove());
            return;
        }

        this.elements.empty.style.display = 'none';

        // 按涨跌幅排序
        const sortedData = [...this.state.fundData].sort((a, b) =>
            (b.estimateChange || 0) - (a.estimateChange || 0)
        );

        const html = sortedData.map(fund => {
            const change = fund.estimateChange || 0;
            const changeClass = change >= 0 ? 'rise' : 'fall';
            const changeText = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;

            return `
                <div class="fund-card ${changeClass}" data-code="${fund.code}">
                    <div class="fund-card__info">
                        <div class="fund-card__name">${fund.name}</div>
                        <div class="fund-card__code">${fund.code}</div>
                    </div>
                    <div class="fund-card__prev">
                        <div class="fund-card__prev-value">${fund.netValue?.toFixed(4) || '-'}</div>
                        <div class="fund-card__prev-label">前日净值</div>
                    </div>
                    <div class="fund-card__estimate">
                        <div class="fund-card__estimate-value">${fund.estimateValue?.toFixed(4) || '-'}</div>
                        <div class="fund-card__estimate-change">${changeText}</div>
                    </div>
                    <button class="fund-card__delete" onclick="App.removeFund('${fund.code}')" aria-label="删除">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');

        // 保留loading和empty，替换其他内容
        const existingCards = this.elements.fundList.querySelectorAll('.fund-card');
        existingCards.forEach(card => card.remove());

        this.elements.fundList.insertAdjacentHTML('beforeend', html);
    },

    /**
     * 显示/隐藏加载状态
     */
    showLoading(show) {
        this.state.isLoading = show;
        this.elements.loading.style.display = show ? 'flex' : 'none';
    },

    /**
     * 显示 Toast 提示
     */
    showToast(message, type = 'info') {
        const toast = this.elements.toast;
        toast.textContent = message;
        toast.className = 'toast active ' + type;

        setTimeout(() => {
            toast.classList.remove('active');
        }, 2500);
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());

// 导出供全局调用
window.App = App;
