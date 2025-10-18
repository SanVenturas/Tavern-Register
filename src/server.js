import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { SillyTavernClient } from './sillyTavernClient.js';

const config = loadConfig();
const client = new SillyTavernClient(config);

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        sillyTavern: config.baseUrl,
    });
});

app.post('/register', async (req, res) => {
    try {
        const { handle, name, password } = sanitizeInput(req.body ?? {});
        const result = await client.registerUser({ handle, name, password });

        res.status(201).json({
            success: true,
            handle: result.handle,
            loginUrl: `${config.baseUrl}/login`,
        });
    } catch (error) {
        const status = deriveStatus(error);
        console.error('注册请求失败：', error);
        res.status(status).json({
            success: false,
            message: error.message ?? '发生未知错误，请稍后再试。',
        });
    }
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: '接口不存在',
    });
});

const port = config.port;
app.listen(port, () => {
    console.log(`TavernRegister listening on http://localhost:${port}`);
});

function sanitizeInput(payload) {
    const handle = typeof payload.handle === 'string' ? payload.handle.trim() : '';
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password.trim() : '';

    if (!handle) {
        throw new Error('用户标识不能为空');
    }

    if (!name) {
        throw new Error('显示名称不能为空');
    }

    if (handle.length > 64) {
        throw new Error('用户标识过长（最多 64 个字符）');
    }

    if (name.length > 64) {
        throw new Error('显示名称过长（最多 64 个字符）');
    }

    if (!password) {
        throw new Error('密码不能为空');
    }

    if (password.length > 128) {
        throw new Error('密码过长（最多 128 个字符）');
    }

    return { handle, name, password };
}

function deriveStatus(error) {
    if (!error?.message) {
        return 500;
    }

    if (error.message.includes('必填') || error.message.includes('不能为空') || error.message.includes('Missing required')) {
        return 400;
    }

    if (error.message.includes('已存在')) {
        return 409;
    }

    if (error.message.includes('管理员登录失败') || error.message.includes('管理员账户')) {
        return 502;
    }

    if (error.message.includes('CSRF') || error.message.includes('会话 Cookie')) {
        return 502;
    }

    return 500;
}
