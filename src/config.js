import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_ENV = [
    'SILLYTAVERN_BASE_URL',
    'SILLYTAVERN_ADMIN_HANDLE',
    'SILLYTAVERN_ADMIN_PASSWORD',
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

    return {
        port,
        host: listenHost,
        baseUrl,
        adminHandle: adminHandleEnv.trim(),
        adminPassword: adminPasswordEnv,
    };
}
