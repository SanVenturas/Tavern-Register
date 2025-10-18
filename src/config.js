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

    const baseUrl = process.env.SILLYTAVERN_BASE_URL.trim().replace(/\/$/, '');
    const port = Number.parseInt(process.env.PORT ?? '3070', 10);

    if (!Number.isFinite(port) || port <= 0) {
        throw new Error('PORT 必须是大于 0 的数字');
    }

    return {
        port,
        baseUrl,
        adminHandle: process.env.SILLYTAVERN_ADMIN_HANDLE.trim(),
        adminPassword: process.env.SILLYTAVERN_ADMIN_PASSWORD,
    };
}
