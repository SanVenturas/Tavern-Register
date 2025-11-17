import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_ENV = [
    'SILLYTAVERN_BASE_URL',
    'SILLYTAVERN_ADMIN_HANDLE',
    'SILLYTAVERN_ADMIN_PASSWORD',
];

/**
 * 解析布尔值环境变量
 * @param {string|undefined} value
 * @returns {boolean}
 */
function parseBoolean(value) {
    if (!value) {
        return false;
    }
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

// 管理员面板配置（可选）
const ADMIN_PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD || 'admin123';
const REQUIRE_INVITE_CODE = parseBoolean(process.env.REQUIRE_INVITE_CODE);
const ADMIN_LOGIN_PATH = process.env.ADMIN_LOGIN_PATH || '/admin/login';
const ADMIN_PANEL_PATH = process.env.ADMIN_PANEL_PATH || '/admin';
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOGIN_LOCKOUT_TIME = parseInt(process.env.LOGIN_LOCKOUT_TIME || '15', 10) * 60 * 1000; // 转换为毫秒

// OAuth 配置是可选的
const OPTIONAL_OAUTH_ENV = [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'LINUXDO_CLIENT_ID',
    'LINUXDO_CLIENT_SECRET',
    'LINUXDO_AUTH_URL',
    'LINUXDO_TOKEN_URL',
    'LINUXDO_USERINFO_URL',
];

export function loadConfig() {
    const missingKeys = REQUIRED_ENV.filter((key) => !process.env[key] || !process.env[key]?.trim());

    if (missingKeys.length > 0) {
        const formatted = missingKeys.join(', ');
        throw new Error(`缺少必要的环境变量：${formatted}`);
    }

    const baseUrlEnv = process.env.SILLYTAVERN_BASE_URL ?? '';
    const adminHandleEnv = process.env.SILLYTAVERN_ADMIN_HANDLE ?? '';
    const adminPasswordEnv = process.env.SILLYTAVERN_ADMIN_PASSWORD ?? '';

    const rawBaseUrl = baseUrlEnv.trim();
    let parsedBaseUrl;
    try {
        parsedBaseUrl = new URL(rawBaseUrl);
    } catch (error) {
        throw new Error('SILLYTAVERN_BASE_URL 必须是包含协议的完整网址，例如 https://example.com:8000');
    }

    const baseUrl = parsedBaseUrl.toString().replace(/\/$/, '');
    const port = Number.parseInt(process.env.PORT ?? '3070', 10);

    if (!Number.isFinite(port) || port <= 0) {
        throw new Error('PORT 必须是大于 0 的数字');
    }

    const listenHostEnv = process.env.LISTEN_HOST ?? process.env.HOST ?? '0.0.0.0';
    const listenHost = listenHostEnv.trim() || '0.0.0.0';

    // 收集 OAuth 配置
    const oauthConfig = {};
    for (const key of OPTIONAL_OAUTH_ENV) {
        const value = process.env[key];
        if (value && value.trim()) {
            oauthConfig[key] = value.trim();
        }
    }

    // 收集 OAuth 启用状态
    const oauthEnabled = {
        github: parseBoolean(process.env.ENABLE_GITHUB_OAUTH),
        discord: parseBoolean(process.env.ENABLE_DISCORD_OAUTH),
        linuxdo: parseBoolean(process.env.ENABLE_LINUXDO_OAUTH),
    };

    // 获取基础 URL（用于 OAuth 回调）
    const baseRegisterUrl = process.env.REGISTER_BASE_URL || `http://localhost:${port}`;

    return {
        port,
        host: listenHost,
        baseUrl,
        baseRegisterUrl,
        adminHandle: adminHandleEnv.trim(),
        adminPassword: adminPasswordEnv,
        adminPanelPassword: ADMIN_PANEL_PASSWORD,
        requireInviteCode: REQUIRE_INVITE_CODE,
        adminLoginPath: ADMIN_LOGIN_PATH,
        adminPanelPath: ADMIN_PANEL_PATH,
        maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
        loginLockoutTime: LOGIN_LOCKOUT_TIME,
        oauthEnabled,
        ...oauthConfig,
    };
}
