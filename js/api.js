/**
 * 天天基金 API 封装
 * 注意：这些是非官方接口，可能随时失效
 */

const FundAPI = {
    // 基金代码列表缓存
    fundList: null,

    // ⚠️ 部署 worker.js 到 Cloudflare 后，将你的 Worker URL 填入这里
    // 格式: https://你的worker名.你的用户名.workers.dev
    WORKER_URL: 'https://aiaiai829.aiaiai829.workers.dev/',  // 例如: 'https://fund-proxy.zhangsan.workers.dev'

    /**
     * 带代理的 fetch 请求
     */
    async fetchWithProxy(url) {
        // 优先使用自建Worker
        if (this.WORKER_URL) {
            try {
                const proxyUrl = `${this.WORKER_URL}?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                if (response.ok) {
                    return await response.text();
                }
            } catch (e) {
                console.warn('Worker代理失败:', e.message);
            }
        }

        // 备用：尝试公共代理
        const fallbackProxies = [
            'https://corsproxy.org/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];

        for (const proxy of fallbackProxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(url));
                if (response.ok) {
                    return await response.text();
                }
            } catch (e) {
                console.warn(`备用代理失败:`, e.message);
            }
        }

        throw new Error('所有代理均失败，请配置 WORKER_URL');
    },

    /**
     * 加载所有基金代码列表（用于搜索）
     * 数据源：http://fund.eastmoney.com/js/fundcode_search.js
     */
    async loadFundList() {
        if (this.fundList) return this.fundList;

        try {
            const url = 'https://fund.eastmoney.com/js/fundcode_search.js';
            const text = await this.fetchWithProxy(url);

            // 解析 JavaScript 变量: var r = [["000001","HXCZHH","华夏成长混合","混合型-偏股","HUAXIACHENGZHANGHUNHE"],...]
            const match = text.match(/var r = (\[.+\]);/);
            if (match) {
                const data = JSON.parse(match[1]);
                // 转换为对象数组
                this.fundList = data.map(item => ({
                    code: item[0],
                    spell: item[1],
                    name: item[2],
                    type: item[3],
                    pinyin: item[4]
                }));
                console.log(`已加载 ${this.fundList.length} 只基金`);
                return this.fundList;
            }
        } catch (error) {
            console.error('加载基金列表失败:', error);
        }
        return [];
    },

    /**
     * 搜索基金（本地过滤）
     * @param {string} keyword - 代码、名称或拼音
     * @param {number} limit - 返回结果数量限制
     */
    async searchFunds(keyword, limit = 20) {
        const list = await this.loadFundList();
        if (!keyword || !list.length) return [];

        const kw = keyword.toLowerCase();
        const results = list.filter(fund =>
            fund.code.includes(kw) ||
            fund.name.toLowerCase().includes(kw) ||
            fund.spell.toLowerCase().includes(kw) ||
            fund.pinyin.toLowerCase().includes(kw)
        );

        return results.slice(0, limit);
    },

    /**
     * 获取单只基金实时估值
     * @param {string} code - 基金代码
     */
    async getFundRealtime(code) {
        try {
            // JSONP 接口：http://fundgz.1234567.com.cn/js/{code}.js
            // 返回格式：jsonpgz({...})
            const timestamp = Date.now();
            const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${timestamp}`;

            const text = await this.fetchWithProxy(url);

            // 提取 JSON 数据
            const match = text.match(/jsonpgz\((.+)\)/);
            if (match) {
                const data = JSON.parse(match[1]);
                return {
                    code: data.fundcode,
                    name: data.name,
                    netValue: parseFloat(data.dwjz),      // 单位净值
                    estimateValue: parseFloat(data.gsz), // 估算净值
                    estimateChange: parseFloat(data.gszzl), // 估算涨跌幅 %
                    valueDate: data.jzrq,                // 净值日期
                    estimateTime: data.gztime            // 估算时间
                };
            }
        } catch (error) {
            console.error(`获取基金 ${code} 数据失败:`, error);
        }
        return null;
    },

    /**
     * 批量获取多只基金实时数据
     * @param {string[]} codes - 基金代码数组
     */
    async getMultipleFunds(codes) {
        if (!codes || !codes.length) return [];

        const promises = codes.map(code => this.getFundRealtime(code));
        const results = await Promise.allSettled(promises);

        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
    }
};

// 导出
window.FundAPI = FundAPI;
