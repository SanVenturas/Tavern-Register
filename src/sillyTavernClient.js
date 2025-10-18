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
        return kebabCase(String(handle ?? '').trim());
    }

    async registerUser({ handle, name, password, makeAdmin = false }) {
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
        };
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
