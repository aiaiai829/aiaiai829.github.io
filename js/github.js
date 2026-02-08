/**
 * GitHub API 封装
 * 用于读写 GitHub 仓库中的 JSON 文件
 */

const GitHubAPI = {
    config: {
        token: '',
        repo: '',    // 格式: owner/repo
        path: 'data/funds.json'
    },

    /**
     * 从 localStorage 加载配置
     */
    loadConfig() {
        const saved = localStorage.getItem('github_config');
        if (saved) {
            try {
                Object.assign(this.config, JSON.parse(saved));
            } catch (e) {
                console.error('加载GitHub配置失败:', e);
            }
        }
        return this.config;
    },

    /**
     * 保存配置到 localStorage
     */
    saveConfig(config) {
        Object.assign(this.config, config);
        localStorage.setItem('github_config', JSON.stringify(this.config));
    },

    /**
     * 检查是否已配置
     */
    isConfigured() {
        return !!(this.config.token && this.config.repo);
    },

    /**
     * GitHub API 请求封装
     */
    async request(endpoint, options = {}) {
        const url = `https://api.github.com${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${this.config.token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `GitHub API 错误: ${response.status}`);
        }

        return response.json();
    },

    /**
     * 读取文件内容
     */
    async readFile() {
        if (!this.isConfigured()) {
            throw new Error('请先配置 GitHub Token 和仓库地址');
        }

        try {
            const data = await this.request(
                `/repos/${this.config.repo}/contents/${this.config.path}`
            );

            // 解码 Base64 内容
            const content = atob(data.content);
            return {
                content: JSON.parse(content),
                sha: data.sha  // 更新文件时需要
            };
        } catch (error) {
            if (error.message.includes('404') || error.message.includes('Not Found')) {
                // 文件不存在，返回默认结构
                return {
                    content: { funds: [], updatedAt: '' },
                    sha: null
                };
            }
            throw error;
        }
    },

    /**
     * 写入/更新文件
     * @param {object} content - 要写入的 JSON 内容
     * @param {string} sha - 现有文件的 SHA（更新时需要）
     */
    async writeFile(content, sha = null) {
        if (!this.isConfigured()) {
            throw new Error('请先配置 GitHub Token 和仓库地址');
        }

        const body = {
            message: `Update fund list - ${new Date().toLocaleString('zh-CN')}`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
        };

        if (sha) {
            body.sha = sha;
        }

        const data = await this.request(
            `/repos/${this.config.repo}/contents/${this.config.path}`,
            {
                method: 'PUT',
                body: JSON.stringify(body)
            }
        );

        return data.content.sha;
    },

    /**
     * 同步基金列表到 GitHub
     * @param {string[]} funds - 基金代码数组
     */
    async syncFunds(funds) {
        // 先读取获取 SHA
        let sha = null;
        try {
            const existing = await this.readFile();
            sha = existing.sha;
        } catch (e) {
            // 文件可能不存在，继续创建
        }

        const content = {
            funds: funds,
            updatedAt: new Date().toISOString()
        };

        return await this.writeFile(content, sha);
    }
};

// 初始化时加载配置
GitHubAPI.loadConfig();

// 导出
window.GitHubAPI = GitHubAPI;
