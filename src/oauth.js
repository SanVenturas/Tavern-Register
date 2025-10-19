import crypto from 'node:crypto';
import { URLSearchParams } from 'node:url';
import fetch from 'node-fetch';
import { findBinding } from './db.js';

const STATE_TTL_MS = 5 * 60 * 1000;
const AUTH_TICKET_TTL_MS = 5 * 60 * 1000;

const stateStore = new Map();
const authorizationTickets = new Map();
const availableProviders = [];

const PROVIDERS = [
    {
        name: 'github',
        displayName: 'GitHub',
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userUrl: 'https://api.github.com/user',
        scope: 'read:user',
        envPrefix: 'GITHUB',
        mapUser: (userJson) => ({
            id: String(userJson.id),
            username: userJson.login,
        }),
        tokenRequestBody: (config, code, redirectUri, state) => new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri,
            state,
        }),
        tokenHeaders: { Accept: 'application/json' },
        userRequestHeaders: (token) => ({
            Authorization: `token ${token}`,
            'User-Agent': 'TavernRegister',
        }),
    },
];

function getProviderConfig(provider) {
    const clientId = process.env[`${provider.envPrefix}_CLIENT_ID`];
    const clientSecret = process.env[`${provider.envPrefix}_CLIENT_SECRET`];
    const callbackUrl = process.env[`${provider.envPrefix}_CALLBACK_URL`];

    if (!clientId || !clientSecret || !callbackUrl) {
        return undefined;
    }

    return {
        clientId,
        clientSecret,
        callbackUrl,
    };
}

/**
 * Register OAuth start/callback routes for each configured provider.
 * @param {import('express').Express} app
 */
export function registerOAuthRoutes(app) {
    availableProviders.length = 0;

    for (const provider of PROVIDERS) {
        const config = getProviderConfig(provider);
        if (!config) {
            continue;
        }

        availableProviders.push({
            name: provider.name,
            displayName: provider.displayName,
        });

        app.get(`/oauth/${provider.name}/start`, (_req, res) => {
            const redirectUri = config.callbackUrl;
            const state = createState();
            const params = new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: redirectUri,
                scope: provider.scope,
                state,
            });
            res.redirect(`${provider.authUrl}?${params.toString()}`);
        });

        app.get(`/oauth/${provider.name}/callback`, async (req, res) => {
            const { code, state } = req.query;
            if (typeof code !== 'string' || typeof state !== 'string') {
                return res.status(400).send('缺少必要的 OAuth 参数');
            }

            if (!consumeState(state)) {
                return res.status(400).send('OAuth 状态码无效或已过期，请重新尝试');
            }

            try {
                const token = await exchangeToken(provider, config, code, state);
                const user = await fetchUserInfo(provider, token);
                if (!user?.id) {
                    throw new Error('未能获取 OAuth 用户 ID');
                }

                const binding = await findBinding(provider.name, user.id);
                if (binding?.tavern_handle) {
                    const params = new URLSearchParams({
                        status: 'bound',
                        handle: binding.tavern_handle,
                    });
                    return res.redirect(`/register?${params.toString()}`);
                }

                const ticket = createAuthorizationTicket({
                    provider: provider.name,
                    providerId: user.id,
                    username: user.username ?? '',
                });

                const params = new URLSearchParams({
                    ticket,
                });
                return res.redirect(`/register?${params.toString()}`);
            } catch (error) {
                console.error(`处理 ${provider.name} OAuth 回调失败:`, error);
                return res.status(502).send('第三方登录失败，请稍后再试');
            }
        });
    }

    app.get('/oauth/authorization/:ticket', (req, res) => {
        const ticket = req.params.ticket;
        const data = getAuthorizationTicket(ticket);
        if (!data) {
            return res.status(404).json({
                success: false,
                message: '授权凭据已失效或不存在，请重新授权',
            });
        }

        res.json({
            success: true,
            authorization: {
                provider: data.provider,
                providerId: data.providerId,
                username: data.username,
            },
        });
    });
}

export function listAvailableProviders() {
    return availableProviders.slice();
}

export function getAuthorizationTicket(ticket) {
    if (!ticket) {
        return undefined;
    }

    const entry = authorizationTickets.get(ticket);
    if (!entry) {
        return undefined;
    }

    if (entry.used) {
        return undefined;
    }

    if (Date.now() > entry.expiresAt) {
        authorizationTickets.delete(ticket);
        return undefined;
    }

    return {
        provider: entry.provider,
        providerId: entry.providerId,
        username: entry.username,
    };
}

export function finalizeAuthorizationTicket(ticket) {
    if (!ticket) {
        return;
    }

    const entry = authorizationTickets.get(ticket);
    if (!entry) {
        return;
    }

    entry.used = true;
    authorizationTickets.delete(ticket);
}

function createAuthorizationTicket(details) {
    const ticket = crypto.randomUUID();
    authorizationTickets.set(ticket, {
        provider: details.provider,
        providerId: details.providerId,
        username: details.username,
        createdAt: Date.now(),
        expiresAt: Date.now() + AUTH_TICKET_TTL_MS,
        used: false,
    });
    return ticket;
}

function createState() {
    const value = crypto.randomUUID();
    stateStore.set(value, Date.now());
    return value;
}

function consumeState(state) {
    const timestamp = stateStore.get(state);
    if (!timestamp) {
        return false;
    }
    stateStore.delete(state);
    const age = Date.now() - timestamp;
    return age <= STATE_TTL_MS;
}

async function exchangeToken(provider, config, code, state) {
    const body = provider.tokenRequestBody(config, code, config.callbackUrl, state);
    const response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: provider.tokenHeaders ?? {},
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`交换访问令牌失败：HTTP ${response.status} ${text}`);
    }

    const data = /** @type {Record<string, any>} */ (await response.json());
    const token = data.access_token;
    if (!token) {
        throw new Error('第三方未返回访问令牌');
    }
    return token;
}

async function fetchUserInfo(provider, token) {
    const response = await fetch(provider.userUrl, {
        headers: provider.userRequestHeaders(token),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`获取用户信息失败：HTTP ${response.status} ${text}`);
    }

    const json = /** @type {Record<string, any>} */ (await response.json());
    return provider.mapUser(json);
}

setInterval(() => {
    const cutoffState = Date.now() - STATE_TTL_MS;
    for (const [state, createdAt] of stateStore.entries()) {
        if (createdAt < cutoffState) {
            stateStore.delete(state);
        }
    }

    const now = Date.now();
    for (const [ticket, entry] of authorizationTickets.entries()) {
        if (entry.used || entry.expiresAt <= now) {
            authorizationTickets.delete(ticket);
        }
    }
}, 60 * 1000).unref();
