import fetch from 'node-fetch';
import kebabCase from 'lodash.kebabcase';

class SessionContext {
    constructor(cookie, csrfToken) {
        this.cookie = cookie ?? null;
        this.csrfToken = csrfToken;
    }
}

function extractSessionCookies(setCookieHeaders) {
    if (!setCookieHeaders) {
        return null;
    }

    const items = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const sessionParts = [];

    for (const rawCookie of items) {
        if (typeof rawCookie !== 'string') {
            continue;
        }

        const token = rawCookie.trim().split(';')[0];
        if (!token) {
            continue;
        }

        const lower = token.toLowerCase();
        if (lower.startsWith('session-') || lower.includes('session-') || lower.includes('.sig')) {
            sessionParts.push(token);
        }
    }

    if (sessionParts.length === 0) {
        return null;
    }

    // Remove duplicates while preserving order
    const seen = new Set();
    const uniqueParts = sessionParts.filter((part) => {
        if (seen.has(part)) {
            return false;
        }
        seen.add(part);
        return true;
    });

    return uniqueParts.join('; ');
}

export class SillyTavernClient {
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.adminHandle = config.adminHandle;
        this.adminPassword = config.adminPassword;
    }

    normalizeHandle(handle) {
        // 移除 kebabCase，避免数字和字母被拆分
        // 只允许字母、数字、下划线、减号，其他字符替换为减号
        // 保持原始大小写或转为小写取决于需求，这里为了兼容性和文件系统安全，转为小写
        return String(handle ?? '').trim().replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    }

    /**
     * 测试连接
     */
    async testConnection() {
        try {
            const session = await this.#loginAsAdmin();
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async registerUser({ handle, name, password, email, makeAdmin = false }) {
        if (!handle || !name) {
            throw new Error('用户标识和显示名称均为必填项');
        }

        const normalizedHandle = this.normalizeHandle(handle);
        if (!normalizedHandle) {
            throw new Error('无法将该用户标识转换为有效格式');
        }

        const session = await this.#loginAsAdmin();
        const createContext = await this.#fetchCsrfToken(session.cookie);
        const authCookie = createContext.cookie ?? session.cookie;

        const payload = {
            handle: normalizedHandle,
            name: name.trim(),
        };

        if (password) {
            payload.password = password;
        }

        // 添加邮箱到 payload（SillyTavern 可能会存储到用户配置中）
        if (email) {
            payload.email = email.trim().toLowerCase();
        }

        if (makeAdmin) {
            payload.admin = true;
        }

        const headers = {
            'content-type': 'application/json',
            'accept': 'application/json',
            'x-csrf-token': createContext.csrfToken,
        };

        if (authCookie) {
            headers.cookie = authCookie;
        }

        const response = await fetch(`${this.baseUrl}/api/users/create`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });

        if (response.status === 409) {
            throw new Error('该用户已存在');
        }

        if (!response.ok) {
            const message = await this.#safeReadError(response);
            throw new Error(`创建用户请求失败：${response.status} ${message}`);
        }

        const data = /** @type {Record<string, any>} */ (await response.json());
        return {
            handle: data.handle,
            name: payload.name,
            email: payload.email,
        };
    }

    async listUsers() {
        const session = await this.#loginAsAdmin();
        const listContext = await this.#fetchCsrfToken(session.cookie);
        const authCookie = listContext.cookie ?? session.cookie;

        const headers = {
            'accept': 'application/json',
            'x-csrf-token': listContext.csrfToken,
        };

        if (authCookie) {
            headers.cookie = authCookie;
        }

        const response = await fetch(`${this.baseUrl}/api/users/get`, {
            method: 'POST',
            headers,
        });

        if (!response.ok) {
            const message = await this.#safeReadError(response);
            throw new Error(`获取用户列表失败：${response.status} ${message}`);
        }

        const data = /** @type {Record<string, any>[]} */ (await response.json());
        return data;
    }

    async deleteUser({ handle, purge = false }) {
        if (!handle) {
            throw new Error('用户标识不能为空');
        }

        const normalizedHandle = this.normalizeHandle(handle);
        if (!normalizedHandle) {
            throw new Error('无法将该用户标识转换为有效格式');
        }

        const session = await this.#loginAsAdmin();
        const deleteContext = await this.#fetchCsrfToken(session.cookie);
        const authCookie = deleteContext.cookie ?? session.cookie;

        const headers = {
            'content-type': 'application/json',
            'accept': 'application/json',
            'x-csrf-token': deleteContext.csrfToken,
        };

        if (authCookie) {
            headers.cookie = authCookie;
        }

        const response = await fetch(`${this.baseUrl}/api/users/delete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ handle: normalizedHandle, purge: !!purge }),
        });

        if (!response.ok) {
            const message = await this.#safeReadError(response);
            throw new Error(`删除用户失败：${response.status} ${message}`);
        }
    }

    async changePassword({ handle, newPassword }) {
        if (!handle) {
            throw new Error('用户标识不能为空');
        }

        if (!newPassword) {
            throw new Error('新密码不能为空');
        }

        const normalizedHandle = this.normalizeHandle(handle);
        if (!normalizedHandle) {
            throw new Error('无法将该用户标识转换为有效格式');
        }

        const session = await this.#loginAsAdmin();
        const updateContext = await this.#fetchCsrfToken(session.cookie);
        const authCookie = updateContext.cookie ?? session.cookie;

        const headers = {
            'content-type': 'application/json',
            'accept': 'application/json',
            'x-csrf-token': updateContext.csrfToken,
        };

        if (authCookie) {
            headers.cookie = authCookie;
        }

        const response = await fetch(`${this.baseUrl}/api/users/change-password`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ handle: normalizedHandle, newPassword }),
        });

        if (!response.ok) {
            const message = await this.#safeReadError(response);
            throw new Error(`修改密码失败：${response.status} ${message}`);
        }
    }

    async disableUser({ handle }) {
        if (!handle) {
            throw new Error('用户标识不能为空');
        }

        const normalizedHandle = this.normalizeHandle(handle);
        if (!normalizedHandle) {
            throw new Error('无法将该用户标识转换为有效格式');
        }

        const session = await this.#loginAsAdmin();
        const updateContext = await this.#fetchCsrfToken(session.cookie);
        const authCookie = updateContext.cookie ?? session.cookie;

        const headers = {
            'content-type': 'application/json',
            'accept': 'application/json',
            'x-csrf-token': updateContext.csrfToken,
        };

        if (authCookie) {
            headers.cookie = authCookie;
        }

        const response = await fetch(`${this.baseUrl}/api/users/disable`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ handle: normalizedHandle }),
        });

        if (!response.ok) {
            const message = await this.#safeReadError(response);
            throw new Error(`禁用用户失败：${response.status} ${message}`);
        }
    }

    async #loginAsAdmin() {
        const session = await this.#fetchCsrfToken();

        const headers = {
            'content-type': 'application/json',
            'accept': 'application/json',
            'x-csrf-token': session.csrfToken,
        };

        if (session.cookie) {
            headers.cookie = session.cookie;
        }

        const response = await fetch(`${this.baseUrl}/api/users/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                handle: this.adminHandle,
                password: this.adminPassword,
            }),
        });

        if (!response.ok) {
            const message = await this.#safeReadError(response);
            throw new Error(`管理员登录失败：${response.status} ${message}`);
        }

        const updatedCookie = extractSessionCookies(response.headers.raw()['set-cookie']);
        if (updatedCookie) {
            session.cookie = updatedCookie;
        }

        if (!session.cookie) {
            throw new Error('管理员登录成功，但未收到会话 Cookie');
        }

        await this.#assertAdmin(session.cookie);
        return session;
    }

    async #assertAdmin(cookie) {
        const response = await fetch(`${this.baseUrl}/api/users/me`, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'cookie': cookie,
            },
        });

        if (!response.ok) {
            throw new Error(`管理员会话验证失败：${response.status}`);
        }

        const profile = /** @type {Record<string, any>} */ (await response.json());
        if (!profile?.admin) {
            throw new Error('配置的管理员账户没有管理员权限');
        }
    }

    async #fetchCsrfToken(cookie) {
        const headers = { 'accept': 'application/json' };
        if (cookie) {
            headers.cookie = cookie;
        }

        const response = await fetch(`${this.baseUrl}/csrf-token`, {
            method: 'GET',
            headers,
        });

        if (!response.ok) {
            throw new Error(`无法获取 CSRF 令牌：${response.status}`);
        }

        const data = /** @type {Record<string, any>} */ (await response.json());
        const sessionCookie = extractSessionCookies(response.headers.raw()['set-cookie']);
        const effectiveCookie = sessionCookie ?? cookie ?? null;

        if (!effectiveCookie && data.token !== 'disabled') {
            throw new Error('未从 SillyTavern 收到会话 Cookie');
        }

        return new SessionContext(effectiveCookie, data.token);
    }

    async #safeReadError(response) {
        try {
            const text = await response.text();
            return text || '未知错误';
        } catch (error) {
            return error?.message ?? '未知错误';
        }
    }
}
