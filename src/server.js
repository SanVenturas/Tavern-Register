import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import multer from 'multer';
import AdmZip from 'adm-zip';
import path from 'node:path';
import os from 'node:os';
import { promises as fsPromises } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { SillyTavernClient } from './sillyTavernClient.js';
import { OAuthService } from './oauthService.js';
import { DataStore } from './dataStore.js';
import { InviteCodeService } from './inviteCodeService.js';
import { requireAdminAuth, verifyAdminPassword } from './adminAuth.js';
import LoginLimiter from './loginLimiter.js';
import { EmailService, cleanupVerificationCodes } from './emailService.js';

const config = loadConfig();
// const client = new SillyTavernClient(config); //不再使用全局客户端
const oauthService = new OAuthService(config);

// 初始化邮箱服务
const emailService = new EmailService(config);

// 初始化登录限制器
const loginLimiter = new LoginLimiter(config.maxLoginAttempts, config.loginLockoutTime);

// 定期清理过期记录（每小时）
setInterval(() => {
    loginLimiter.cleanup();
    cleanupVerificationCodes(); // 清理过期验证码
}, 60 * 60 * 1000);

const STORAGE_LIMIT_CHECK_INTERVAL = 60 * 1000;
const storageCheckState = new Map();

async function getDirectorySize(targetPath) {
    try {
        const stat = await fsPromises.stat(targetPath);
        if (!stat.isDirectory()) {
            return stat.size;
        }

        const entries = await fsPromises.readdir(targetPath, { withFileTypes: true });
        let total = 0;
        for (const entry of entries) {
            const entryPath = path.join(targetPath, entry.name);
            if (entry.isDirectory()) {
                total += await getDirectorySize(entryPath);
            } else if (entry.isFile()) {
                const fileStat = await fsPromises.stat(entryPath);
                total += fileStat.size;
            }
        }
        return total;
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return 0;
        }
        throw error;
    }
}

function resolveStorageLimitBytes(value, unit) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }

    const normalizedUnit = String(unit ?? 'mb').toLowerCase();
    const multiplier = normalizedUnit === 'gb' ? 1024 ** 3 : 1024 ** 2;
    return Math.round(numeric * multiplier);
}

async function enforceStorageLimits() {
    try {
        const servers = DataStore.getServers();
        if (!servers.length) {
            return;
        }

        const users = DataStore.getUsers();

        for (const server of servers) {
            if (!server.storageLimitBytes || !server.localDataRoot) {
                continue;
            }

            const intervalMinutes = Number(server.storageCheckIntervalMinutes ?? 5);
            const intervalMs = Number.isFinite(intervalMinutes) && intervalMinutes > 0
                ? intervalMinutes * 60 * 1000
                : 5 * 60 * 1000;
            const lastChecked = storageCheckState.get(server.id) || 0;
            if (Date.now() - lastChecked < intervalMs) {
                continue;
            }
            storageCheckState.set(server.id, Date.now());

            const serverUsers = users.filter(u => Number(u.serverId) === Number(server.id));
            if (!serverUsers.length) {
                continue;
            }

            const client = new SillyTavernClient({
                baseUrl: server.url,
                adminHandle: server.admin_username,
                adminPassword: server.admin_password,
            });

            for (const user of serverUsers) {
                const normalizedHandle = client.normalizeHandle(user.handle);
                if (!normalizedHandle) {
                    continue;
                }

                const userRoot = path.join(server.localDataRoot, normalizedHandle);
                let usageBytes = 0;
                try {
                    usageBytes = await getDirectorySize(userRoot);
                } catch (error) {
                    console.error('读取用户目录大小失败:', normalizedHandle, error?.message || error);
                    continue;
                }

                DataStore.updateUser(normalizedHandle, {
                    lastQuotaUsageBytes: usageBytes,
                    lastQuotaCheckedAt: new Date().toISOString(),
                });

                if (usageBytes >= server.storageLimitBytes) {
                    try {
                        await client.disableUser({ handle: normalizedHandle });
                        DataStore.updateUser(normalizedHandle, {
                            quotaDisabledAt: new Date().toISOString(),
                        });
                    } catch (error) {
                        console.error('禁用超限用户失败:', normalizedHandle, error?.message || error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('执行存储限额检查失败:', error?.message || error);
    }
}

setInterval(() => {
    enforceStorageLimits();
}, STORAGE_LIMIT_CHECK_INTERVAL);

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet({
    contentSecurityPolicy: false,
    originAgentCluster: false, // 禁用 Origin-Agent-Cluster 头，避免浏览器的 agent cluster 警告
}));

// 安全中间件：规范化路径，防止双斜杠绕过
app.use((req, res, next) => {
    if (req.url.includes('//')) {
        const normalizedUrl = req.url.replace(/\/+/g, '/');
        return res.redirect(301, normalizedUrl);
    }
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 会话配置（用于存储 OAuth state 和 pending 用户）
const sessionSecret = process.env.SESSION_SECRET || 'tavern-register-secret-change-in-production';

// 安全检查：生产环境必须设置自定义 SESSION_SECRET
if (process.env.NODE_ENV === 'production' && sessionSecret === 'tavern-register-secret-change-in-production') {
    console.error('⚠️  安全警告：生产环境必须设置 SESSION_SECRET 环境变量！');
    console.error('⚠️  当前使用默认密钥，存在安全风险！');
    // 可以选择抛出错误强制退出，或仅警告
    // throw new Error('生产环境必须设置 SESSION_SECRET');
}

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true',
        httpOnly: true,
        maxAge: 30 * 60 * 1000, // 30 分钟
        sameSite: 'lax', // 增加CSRF保护
    },
}));
const publicDir = path.join(__dirname, '../public');
const indexHtmlPath = path.join(publicDir, 'index.html');
const registerHtmlPath = path.join(publicDir, 'register.html');
const selectServerHtmlPath = path.join(publicDir, 'select-server.html');
const loginHtmlPath = path.join(publicDir, 'login.html');
const upload = multer({
    dest: path.join(os.tmpdir(), 'tavern-register-uploads'),
    limits: { fileSize: 1024 * 1024 * 1024 },
});
function appendLog(message) {
    console.log(message.trim());
}

function formatLogLine(level, context) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${JSON.stringify(context)}\n`;
}

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
    });
});

// 获取注册配置
app.get('/api/config', (_req, res) => {
    res.json({
        requireInviteCode: config.requireInviteCode || false,
        requireEmailVerification: config.requireEmailVerification || false,
        enableIpLimit: config.enableIpLimit || false,
    });
});

// 发送邮箱验证码
app.post('/api/email/send-code', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email || typeof email !== 'string') {
            return res.status(400).json({
                success: false,
                message: '邮箱地址不能为空',
            });
        }
        
        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({
                success: false,
                message: '邮箱格式不正确',
            });
        }
        
        // 检查邮箱是否已被注册
        if (DataStore.isEmailUsed(email)) {
            return res.status(409).json({
                success: false,
                message: '该邮箱已被注册，请使用其他邮箱或直接登录',
            });
        }
        
        // 发送验证码
        const result = await emailService.sendVerificationCode(email.trim());
        res.json(result);
        
    } catch (error) {
        console.error('发送验证码失败:', error);
        res.status(500).json({
            success: false,
            message: error.message || '发送验证码失败，请稍后重试',
        });
    }
});

function sendRegisterPage(res) {
    res.sendFile(registerHtmlPath);
}

app.get('/', (req, res) => {
    if (req.session.userHandle) {
        return res.redirect('/select-server');
    }
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    if (req.session.userHandle) {
        return res.redirect('/select-server');
    }
    res.sendFile(loginHtmlPath);
});

app.post('/api/login', (req, res) => {
    const { handle, password } = req.body;
    if (!handle || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    // 标准化 handle
    const tempClient = new SillyTavernClient({});
    const normalizedHandle = tempClient.normalizeHandle(handle);

    const user = DataStore.getUserByHandle(normalizedHandle);
    if (!user) {
        // 模糊错误信息以提高安全性
        return res.status(401).json({ success: false, message: '用户不存在或密码错误' });
    }

    // 禁止第三方登录用户使用账号密码方式登录
    if (user.registrationMethod && String(user.registrationMethod).startsWith('oauth:')) {
        return res.status(403).json({
            success: false,
            message: '该账户为第三方登录账户，请通过相应的第三方登录入口登录',
        });
    }

    // 简单比对密码
    if (user.password !== password) {
            return res.status(401).json({ success: false, message: '用户不存在或密码错误' });
    }

    req.session.userHandle = user.handle;
    res.json({ success: true, redirectUrl: '/select-server' });
});

app.get('/register', (_req, res) => {
    sendRegisterPage(res);
});

app.get('/select-server', (req, res) => {
    // 允许已登录用户或正在注册流程中的用户
    if (!req.session.userHandle && !req.session.pendingUserHandle) {
        return res.redirect('/login');
    }
    res.sendFile(selectServerHtmlPath);
});

app.post('/register', async (req, res) => {
    try {
        const { handle, name, password, inviteCode, email, emailCode } = sanitizeInput(req.body ?? {});
        
        // 标准化用户名
        const tempClient = new SillyTavernClient({}); // 仅用于 normalizeHandle
        const normalizedHandle = tempClient.normalizeHandle(handle);
        
        // 获取客户端 IP
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        // IP 注册限制检查
        if (config.enableIpLimit) {
            if (DataStore.hasIpRegistered(clientIp)) {
                return res.status(403).json({
                    success: false,
                    message: '您的 IP 地址已注册过账号，每个 IP 只能注册一次',
                });
            }
        }
        
        // 本地重复检查 - 提供更友好的提示
        const existingUser = DataStore.getUserByHandle(normalizedHandle);
        if (existingUser) {
            const methodText = existingUser.registrationMethod === 'manual' 
                ? '手动注册' 
                : existingUser.registrationMethod.startsWith('oauth:')
                    ? `${existingUser.registrationMethod.replace('oauth:', '').toUpperCase()} 一键注册`
                    : '其他方式';
            
            return res.status(409).json({
                success: false,
                message: `该用户名已被注册（注册方式：${methodText}，注册时间：${new Date(existingUser.registeredAt).toLocaleString('zh-CN')}）`,
            });
        }
        
        // 邮箱验证
        let verifiedEmail = null;
        if (config.requireEmailVerification) {
            if (!email || typeof email !== 'string' || !email.trim()) {
                return res.status(400).json({
                    success: false,
                    message: '邮箱地址不能为空',
                });
            }
            
            // 验证邮箱格式
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                return res.status(400).json({
                    success: false,
                    message: '邮箱格式不正确',
                });
            }
            
            // 检查邮箱是否已被使用
            if (DataStore.isEmailUsed(email)) {
                return res.status(409).json({
                    success: false,
                    message: '该邮箱已被注册，请使用其他邮箱或直接登录',
                });
            }
            
            // 验证邮箱验证码
            if (!emailCode || typeof emailCode !== 'string' || !emailCode.trim()) {
                return res.status(400).json({
                    success: false,
                    message: '邮箱验证码不能为空',
                });
            }
            
            const verification = emailService.verifyCode(email.trim(), emailCode.trim());
            if (!verification.valid) {
                return res.status(400).json({
                    success: false,
                    message: verification.message || '验证码无效',
                });
            }
            
            verifiedEmail = email.trim().toLowerCase();
        }
        
        // 如果启用了邀请码，验证邀请码
        if (config.requireInviteCode) {
            if (!inviteCode || typeof inviteCode !== 'string' || !inviteCode.trim()) {
                return res.status(400).json({
                    success: false,
                    message: '邀请码不能为空',
                });
            }
            
            const validation = InviteCodeService.validate(inviteCode.trim().toUpperCase());
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.message || '邀请码无效',
                });
            }
        }
        
        // 如果没有提供密码，使用默认密码
        const finalPassword = password || oauthService.getDefaultPassword();
        
        // 仅在本地创建用户记录，标记为 pending_selection
        const newUser = DataStore.recordUser({
            handle: normalizedHandle,
            name: name.trim(),
            password: finalPassword, // 暂时存储密码，用于后续绑定服务器时使用
            ip: clientIp,
            email: verifiedEmail, // 存储验证后的邮箱
            inviteCode: inviteCode ? inviteCode.trim().toUpperCase() : null,
            registrationMethod: 'manual',
            registrationStatus: 'pending_selection'
        });

        // 如果使用了邀请码，标记为已使用
        if (config.requireInviteCode && inviteCode) {
            InviteCodeService.use(inviteCode.trim().toUpperCase(), newUser.handle);
        }

        const timestamp = new Date().toISOString();
        console.info(`[注册审计] 时间 ${timestamp}，IP ${clientIp}，用户名 ${newUser.handle}，邮箱 ${verifiedEmail || '无'}，本地创建成功，等待选服`);

        // 设置 session，用于后续选服
        req.session.pendingUserHandle = newUser.handle;

        res.status(201).json({
            success: true,
            handle: newUser.handle,
            redirectUrl: '/select-server',
            message: '账号创建成功，请选择服务器',
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

// 获取可用服务器列表（给用户选服用）
app.get('/api/servers/available', (req, res) => {
    try {
        const handle = req.session.userHandle || req.session.pendingUserHandle;
        const user = handle ? DataStore.getUserByHandle(handle) : null;
        const userServerId = user && user.serverId ? Number(user.serverId) : null;
        const isRegistered = user && user.registrationStatus === 'active';
        
        const allUsers = DataStore.getUsers();
        const allServers = DataStore.getActiveServers();
        
        // 对于已注册用户，显示所有服务器（包括暂停注册的），但标记暂停状态
        // 对于未注册用户，只显示未暂停注册的服务器
        const filteredServers = isRegistered 
            ? allServers  // 已注册用户可以看到所有服务器
            : allServers.filter(s => !s.registrationPaused);  // 未注册用户只能看到未暂停的服务器
        
        const servers = filteredServers.map(s => {
            // 兼容旧数据：旧用户记录里的 serverId 或 server.id 可能是字符串
            const serverNumericId = Number(s.id);
            const registeredUserCount = allUsers.filter(u => {
                if (u.serverId == null) return false;
                return Number(u.serverId) === serverNumericId;
            }).length;
            return {
                // 对外统一返回数字类型的 id，方便前端严格比较
                id: serverNumericId,
                name: s.name,
                url: s.url,
                description: s.description || '',
                provider: s.provider || '',
                maintainer: s.maintainer || '',
                contact: s.contact || '',
                announcement: s.announcement || '',
                registeredUserCount,
                registrationPaused: s.registrationPaused === true,  // 是否暂停注册
            };
        });
        res.json({ success: true, servers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

    // 获取当前用户状态
app.get('/api/user/status', (req, res) => {
    const handle = req.session.userHandle || req.session.pendingUserHandle;
    if (!handle) {
        return res.status(401).json({ success: false, loggedIn: false });
    }
    const user = DataStore.getUserByHandle(handle);
    if (!user) {
            return res.status(404).json({ success: false, loggedIn: false });
    }

    // 兼容旧数据：serverId 可能是字符串，将其标准化为数字
    const normalizedServerId = user.serverId != null ? Number(user.serverId) : null;
    const server = normalizedServerId != null ? DataStore.getServerById(normalizedServerId) : null;
    
    // 排除敏感信息：密码
    const { password, ...safeUser } = user;
    
    res.json({
        success: true,
        loggedIn: true,
        handle: safeUser.handle,
        serverId: normalizedServerId,
        serverUrl: server ? server.url : null,
        serverName: server ? server.name : null,
        registrationStatus: safeUser.registrationStatus
    });
});

// 绑定服务器并远程注册
app.post('/api/users/bind-server', async (req, res) => {
    const { serverId } = req.body;
    const handle = req.session.userHandle || req.session.pendingUserHandle;
    if (!handle) {
        return res.status(401).json({ success: false, message: '会话已过期，请重新注册或登录' });
    }
    if (!serverId) {
        return res.status(400).json({ success: false, message: '请选择一个服务器' });
    }

    try {
        const user = DataStore.getUserByHandle(handle);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }

        if (user.registrationStatus === 'active') {
             return res.status(400).json({ success: false, message: '该用户已激活' });
        }

        const server = DataStore.getServerById(serverId);
        if (!server || !server.isActive) {
            return res.status(404).json({ success: false, message: '服务器不存在或不可用' });
        }

        // 检查服务器是否暂停注册
        if (server.registrationPaused === true) {
            return res.status(403).json({ success: false, message: '该服务器已暂停注册，无法绑定新用户' });
        }

        // 初始化客户端连接目标服务器
        const client = new SillyTavernClient({
            baseUrl: server.url,
            adminHandle: server.admin_username,
            adminPassword: server.admin_password
        });

        // 远程注册（包含邮箱信息）
        await client.registerUser({
            handle: user.handle,
            name: user.name,
            password: user.password, // 使用之前暂存的密码
            email: user.email // 将邮箱上传到酒馆
        });

        // 更新本地状态
        DataStore.updateUser(handle, {
            serverId: server.id,
            registrationStatus: 'active',
            // password: null // 保留密码以便后续登录
        });
        
        // 清除 pending 状态，确保登录状态
        delete req.session.pendingUserHandle;
        req.session.userHandle = handle;

        const defaultPassword = oauthService.getDefaultPassword();
        const isDefaultPassword = user.password === defaultPassword; // 注意：这里 user.password 已经是 null 了，逻辑有点问题。应该在 update 之前判断。
        // 修正：
        // const isDefaultPassword = user.password === oauthService.getDefaultPassword();

        res.json({
            success: true,
            loginUrl: `${server.url}/login`, // 返回该服务器的登录地址
            message: '注册成功！'
        });

    } catch (error) {
        console.error('绑定服务器失败:', error);
        res.status(500).json({ success: false, message: `注册失败: ${error.message}` });
    }
});

// 下载用户备份（通过 SillyTavern API）
app.post('/api/users/backup-download', async (req, res) => {
    try {
        const handle = req.session.userHandle || req.session.pendingUserHandle;
        if (!handle) {
            return res.status(401).json({ success: false, message: '会话已过期，请重新登录' });
        }

        const user = DataStore.getUserByHandle(handle);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }

        const serverId = req.body?.serverId ?? user.serverId;
        if (!serverId || Number(serverId) !== Number(user.serverId)) {
            return res.status(403).json({ success: false, message: '无权访问该服务器的备份' });
        }

        const server = DataStore.getServerById(serverId);
        if (!server) {
            return res.status(404).json({ success: false, message: '服务器不存在' });
        }

        const client = new SillyTavernClient({
            baseUrl: server.url,
            adminHandle: server.admin_username,
            adminPassword: server.admin_password,
        });

        const upstream = await client.downloadBackup({ handle: user.handle });
        const contentType = upstream.headers.get('content-type') || 'application/zip';
        const disposition = upstream.headers.get('content-disposition');

        res.status(200);
        res.setHeader('content-type', contentType);
        if (disposition) {
            res.setHeader('content-disposition', disposition);
        } else {
            res.attachment(`${user.handle}-backup.zip`);
        }

        upstream.body.pipe(res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || '下载备份失败' });
    }
});

// 应用用户备份（同机模式）
app.post('/api/users/backup-apply', upload.single('backup'), async (req, res) => {
    try {
        const handle = req.session.userHandle || req.session.pendingUserHandle;
        if (!handle) {
            await appendLog(formatLogLine('WARN', { action: 'backup-apply', reason: 'no-session', ip: req.ip }));
            return res.status(401).json({ success: false, message: '会话已过期，请重新登录' });
        }

        const user = DataStore.getUserByHandle(handle);
        if (!user) {
            await appendLog(formatLogLine('WARN', { action: 'backup-apply', reason: 'user-not-found', handle, ip: req.ip }));
            return res.status(404).json({ success: false, message: '用户不存在' });
        }

        const serverId = req.body?.serverId ?? user.serverId;
        if (!serverId || Number(serverId) !== Number(user.serverId)) {
            await appendLog(formatLogLine('WARN', { action: 'backup-apply', reason: 'server-mismatch', handle, serverId, userServerId: user.serverId, ip: req.ip }));
            return res.status(403).json({ success: false, message: '无权操作该服务器的备份' });
        }

        const server = DataStore.getServerById(serverId);
        if (!server) {
            await appendLog(formatLogLine('WARN', { action: 'backup-apply', reason: 'server-not-found', handle, serverId, ip: req.ip }));
            return res.status(404).json({ success: false, message: '服务器不存在' });
        }

        if (!server.localDataRoot) {
            await appendLog(formatLogLine('WARN', { action: 'backup-apply', reason: 'missing-local-data-root', handle, serverId, ip: req.ip }));
            return res.status(400).json({ success: false, message: '仅同机部署可应用备份，请先在服务器管理中配置本体数据目录' });
        }

        if (!req.file) {
            await appendLog(formatLogLine('WARN', { action: 'backup-apply', reason: 'missing-file', handle, serverId, ip: req.ip }));
            return res.status(400).json({ success: false, message: '未检测到备份文件' });
        }

        const client = new SillyTavernClient({
            baseUrl: server.url,
            adminHandle: server.admin_username,
            adminPassword: server.admin_password,
        });
        const normalizedHandle = client.normalizeHandle(user.handle);
        if (!normalizedHandle) {
            return res.status(400).json({ success: false, message: '用户标识无效' });
        }

        const userRoot = path.join(server.localDataRoot, normalizedHandle);
        const resolvedUserRoot = path.resolve(userRoot);
        const zipPath = req.file.path;

        await appendLog(formatLogLine('INFO', {
            action: 'backup-apply',
            stage: 'start',
            handle: normalizedHandle,
            serverId,
            zipPath,
            userRoot,
            ip: req.ip,
        }));

        try {
            await fsPromises.rm(userRoot, { recursive: true, force: true });
            await fsPromises.mkdir(userRoot, { recursive: true });

            const zip = new AdmZip(zipPath);
            const entries = zip.getEntries();

            await appendLog(formatLogLine('INFO', {
                action: 'backup-apply',
                stage: 'entries',
                handle: normalizedHandle,
                count: entries.length,
            }));

            for (const entry of entries) {
                const entryName = entry.entryName.replace(/\\/g, '/');
                const targetPath = path.resolve(userRoot, entryName);
                if (!targetPath.startsWith(resolvedUserRoot)) {
                    await appendLog(formatLogLine('WARN', {
                        action: 'backup-apply',
                        stage: 'skip-entry',
                        handle: normalizedHandle,
                        entry: entryName,
                    }));
                    continue;
                }

                if (entry.isDirectory) {
                    await fsPromises.mkdir(targetPath, { recursive: true });
                    continue;
                }

                await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
                await fsPromises.writeFile(targetPath, entry.getData());
            }
            await appendLog(formatLogLine('INFO', {
                action: 'backup-apply',
                stage: 'completed',
                handle: normalizedHandle,
            }));
        } finally {
            await fsPromises.rm(zipPath, { force: true });
        }

        res.json({ success: true, message: '备份已应用，重新登录后生效' });
    } catch (error) {
        await appendLog(formatLogLine('ERROR', {
            action: 'backup-apply',
            stage: 'failed',
            message: error?.message || error,
        }));
        res.status(500).json({ success: false, message: error.message || '应用备份失败' });
    }
});

// 从请求中获取基础 URL（用于 OAuth 回调）
function getRequestBaseUrl(req) {
    // 优先使用配置的 baseRegisterUrl
    if (config.baseRegisterUrl && config.baseRegisterUrl !== `http://localhost:${config.port}`) {
        return config.baseRegisterUrl;
    }
    
    // 从请求头中获取协议和主机
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers.host || `${req.socket?.remoteAddress || 'localhost'}:${config.port}`;
    
    return `${protocol}://${host}`;
}

// OAuth 路由
app.get('/oauth/auth/:provider', (req, res) => {
    const { provider } = req.params;
    const validProviders = ['github', 'discord', 'linuxdo'];
    
    if (!validProviders.includes(provider)) {
        return res.status(400).json({
            success: false,
            message: `不支持的 OAuth 提供商: ${provider}`,
        });
    }

    try {
        const requestBaseUrl = getRequestBaseUrl(req);
        const { url, state } = oauthService.getAuthUrl(provider, requestBaseUrl);
        // 将 state 和 baseUrl 存储到会话中（回调时需要）
        req.session.oauthState = state;
        req.session.oauthProvider = provider;
        req.session.oauthBaseUrl = requestBaseUrl;
        res.redirect(url);
    } catch (error) {
        console.error(`OAuth 授权失败 (${provider}):`, error);
        res.status(500).json({
            success: false,
            message: error.message || 'OAuth 授权失败',
        });
    }
});

// OAuth 回调路由
app.get('/oauth/callback/:provider', async (req, res) => {
    const { provider } = req.params;
    const { code, state } = req.query;

    // 验证 state
    if (!req.session.oauthState || req.session.oauthState !== state) {
        return res.status(400).send(`
            <html>
                <head><title>OAuth 验证失败</title></head>
                <body>
                    <h1>OAuth 验证失败</h1>
                    <p>State 验证失败，请重试。</p>
                    <a href="/">返回注册页面</a>
                </body>
            </html>
        `);
    }

    if (!code) {
        return res.status(400).send(`
            <html>
                <head><title>OAuth 授权失败</title></head>
                <body>
                    <h1>OAuth 授权失败</h1>
                    <p>未收到授权码，请重试。</p>
                    <a href="/">返回注册页面</a>
                </body>
            </html>
        `);
    }

    try {
        // 获取回调时使用的基础 URL（优先使用会话中保存的，否则从请求中获取）
        const requestBaseUrl = req.session.oauthBaseUrl || getRequestBaseUrl(req);
        
        // 交换授权码获取访问令牌
        const accessToken = await oauthService.exchangeCode(provider, code, requestBaseUrl);
        
        // 获取用户信息
        const userInfo = await oauthService.getUserInfo(provider, accessToken);
        
        // 生成用户名和显示名称
        const tempClient = new SillyTavernClient({});
        const handle = tempClient.normalizeHandle(userInfo.username || userInfo.id);
        const displayName = userInfo.displayName || userInfo.username || `用户_${userInfo.id.slice(0, 8)}`;

        // 获取客户端 IP（用于 IP 限制检查）
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

        // 无论当前是否需要邀请码，都先检查本地是否已存在该用户
        const existingUser = DataStore.getUserByHandle(handle);
        if (existingUser) {
            // 已注册用户：直接登录（走本地 session），不再重复注册或再次填写邀请码
            req.session.userHandle = existingUser.handle;

            // 清除 OAuth 相关临时状态
            delete req.session.oauthState;
            delete req.session.oauthProvider;
            delete req.session.oauthBaseUrl;

            return res.redirect('/select-server');
        }
        
        // IP 注册限制检查（新用户才检查）
        if (config.enableIpLimit) {
            if (DataStore.hasIpRegistered(clientIp)) {
                // 清除 OAuth 状态
                delete req.session.oauthState;
                delete req.session.oauthProvider;
                delete req.session.oauthBaseUrl;
                
                return res.status(403).send(`
                    <html>
                        <head><title>注册限制</title></head>
                        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                            <h1>⚠️ 注册受限</h1>
                            <p>您的 IP 地址已注册过账号，每个 IP 只能注册一次。</p>
                            <a href="/login" style="color: #667eea;">返回登录</a>
                        </body>
                    </html>
                `);
            }
        }
        
        // 如果启用了邀请码或邮箱验证，跳转到验证页面（首次注册才会到这里）
        if (config.requireInviteCode || config.requireEmailVerification) {
            // 将用户信息存入 session
            req.session.oauthPendingUser = {
                handle,
                displayName,
                provider,
                ip: clientIp,
            };
            
            // 清除 OAuth 状态
            delete req.session.oauthState;
            delete req.session.oauthProvider;
            delete req.session.oauthBaseUrl;
            
            // 跳转到验证页面（邀请码 + 邮箱验证）
            return res.redirect('/oauth/invite');
        }
        
        // 创建新用户 (本地)
        const defaultPassword = oauthService.getDefaultPassword();
        
        const newUser = DataStore.recordUser({
            handle: handle,
            name: displayName,
            password: defaultPassword,
            ip: clientIp,
            email: null, // OAuth 流程不强制要求邮箱
            inviteCode: null,
            registrationMethod: `oauth:${provider}`,
            registrationStatus: 'pending_selection'
        });

        const timestamp = new Date().toISOString();
        console.info(`[OAuth注册审计] 时间 ${timestamp}，IP ${clientIp}，提供商 ${provider}，用户名 ${newUser.handle}`);

        // 清除会话中的 OAuth 数据
        delete req.session.oauthState;
        delete req.session.oauthProvider;
        delete req.session.oauthBaseUrl;

        // 设置 session 用于选服
        req.session.pendingUserHandle = newUser.handle;

        // 跳转到选服页面
        res.redirect('/select-server');

    } catch (error) {
        console.error(`OAuth 回调处理失败 (${provider}):`, error);
        
        // 清除会话
        delete req.session.oauthState;
        delete req.session.oauthProvider;
        delete req.session.oauthBaseUrl;

        const errorMessage = error.message || '注册失败，请稍后再试';
        res.status(500).send(`注册失败: ${errorMessage}`);
    }
});

// OAuth 邀请码验证页面
app.get('/oauth/invite', (req, res) => {
    if (!req.session.oauthPendingUser) {
        return res.redirect('/');
    }
    res.sendFile(path.join(publicDir, 'oauth-invite.html'));
});

// OAuth 邀请码/邮箱验证 API
app.post('/oauth/invite', async (req, res) => {
    if (!req.session.oauthPendingUser) {
        return res.status(400).json({
            success: false,
            message: '会话已过期，请重新登录',
        });
    }
    
    const { inviteCode, email, emailCode } = req.body;
    
    // 邮箱验证
    let verifiedEmail = null;
    if (config.requireEmailVerification) {
        if (!email || typeof email !== 'string' || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: '邮箱地址不能为空',
            });
        }
        
        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({
                success: false,
                message: '邮箱格式不正确',
            });
        }
        
        // 检查邮箱是否已被使用
        if (DataStore.isEmailUsed(email)) {
            return res.status(409).json({
                success: false,
                message: '该邮箱已被注册，请使用其他邮箱或直接登录',
            });
        }
        
        // 验证邮箱验证码
        if (!emailCode || typeof emailCode !== 'string' || !emailCode.trim()) {
            return res.status(400).json({
                success: false,
                message: '邮箱验证码不能为空',
            });
        }
        
        const verification = emailService.verifyCode(email.trim(), emailCode.trim());
        if (!verification.valid) {
            return res.status(400).json({
                success: false,
                message: verification.message || '验证码无效',
            });
        }
        
        verifiedEmail = email.trim().toLowerCase();
    }
    
    // 邀请码验证
    if (config.requireInviteCode) {
        if (!inviteCode || typeof inviteCode !== 'string' || !inviteCode.trim()) {
            return res.status(400).json({
                success: false,
                message: '邀请码不能为空',
            });
        }
        
        // 验证邀请码
        const validation = InviteCodeService.validate(inviteCode.trim().toUpperCase());
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message || '邀请码无效',
            });
        }
    }
    
    try {
        const { handle, displayName, provider, ip: storedIp } = req.session.oauthPendingUser;
        
        // 检查是否已注册
        const existingUser = DataStore.getUserByHandle(handle);
        if (existingUser) {
            // 如果用户已经存在，说明之前已经完成过 OAuth 注册和邀请码验证。
            // 此时视为「登录」，直接建立会话并告知前端可以跳转到登录/选服页面。
            delete req.session.oauthPendingUser;
            req.session.userHandle = existingUser.handle;

            return res.json({
                success: false,
                isAlreadyRegistered: true,
                handle: existingUser.handle,
                loginUrl: '/select-server',
                message: '该账号已完成注册，正在为您直接登录',
            });
        }
        
        // 创建新用户 (本地)
        const defaultPassword = oauthService.getDefaultPassword();
        
        // 使用存储的 IP 或从当前请求获取
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = storedIp || forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        const newUser = DataStore.recordUser({
            handle: handle,
            name: displayName,
            password: defaultPassword,
            ip: clientIp,
            email: verifiedEmail, // 存储验证后的邮箱
            inviteCode: inviteCode ? inviteCode.trim().toUpperCase() : null,
            registrationMethod: `oauth:${provider}`,
            registrationStatus: 'pending_selection'
        });

        // 标记邀请码为已使用
        if (config.requireInviteCode && inviteCode) {
            InviteCodeService.use(inviteCode.trim().toUpperCase(), newUser.handle);
        }

        const timestamp = new Date().toISOString();
        console.info(`[OAuth注册审计] 时间 ${timestamp}，IP ${clientIp}，提供商 ${provider}，用户名 ${newUser.handle}，邮箱 ${verifiedEmail || '无'}，邀请码 ${inviteCode ? inviteCode.trim().toUpperCase() : '无'}`);

        // 清除会话中的待注册用户信息
        delete req.session.oauthPendingUser;
        
        // 设置 session 用于选服
        req.session.pendingUserHandle = newUser.handle;
        
        // 返回用户名和后续跳转地址，便于前端在成功弹窗中正确展示
        res.json({
            success: true,
            handle: newUser.handle,
            // OAuth 流程下此时用户尚未绑定具体 SillyTavern 服务器，
            // 先跳转到本系统的选服页面，由用户选择服务器后再完成远程注册。
            loginUrl: '/select-server',
            redirectUrl: '/select-server',
        });
        
    } catch (error) {
        console.error(`OAuth 用户创建失败:`, error);
        res.status(500).json({
            success: false,
            message: error.message || '创建用户失败，请稍后再试',
        });
    }
});

// 获取可用的 OAuth 提供商
app.get('/oauth/providers', (_req, res) => {
    const providers = [];
    
    // 检查 GitHub OAuth 是否启用且配置完整
    if (config.oauthEnabled?.github && config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
        providers.push({ id: 'github', name: 'GitHub', icon: 'github' });
    }
    
    // 检查 Discord OAuth 是否启用且配置完整
    if (config.oauthEnabled?.discord && config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET) {
        providers.push({ id: 'discord', name: 'Discord', icon: 'discord' });
    }
    
    // 检查 Linux.do OAuth 是否启用且配置完整
    if (config.oauthEnabled?.linuxdo && config.LINUXDO_CLIENT_ID && config.LINUXDO_CLIENT_SECRET) {
        providers.push({ id: 'linuxdo', name: 'Linux.do', icon: 'linuxdo' });
    }
    
    res.json({ providers });
});

// ==================== 管理员面板路由 ====================

// 获取客户端 IP
function getClientIp(req) {
    const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
    return forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || 'unknown';
}

// 管理员登录页面（使用可配置路径）
app.get(config.adminLoginPath, (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin-login.html'));
});

// 管理员登录 API（带防暴力破解）
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const clientIp = getClientIp(req);
    
    // 检查登录限制
    const checkResult = loginLimiter.check(clientIp);
    if (!checkResult.allowed) {
        const lockMinutes = checkResult.lockMinutes || Math.ceil((checkResult.lockUntil.getTime() - Date.now()) / 60000);
        return res.status(429).json({
            success: false,
            message: `登录尝试次数过多，请 ${lockMinutes} 分钟后再试`,
            lockUntil: checkResult.lockUntil,
        });
    }
    
    if (verifyAdminPassword(password, config.adminPanelPassword)) {
        // 登录成功，清除失败记录
        loginLimiter.clear(clientIp);
        req.session.isAdmin = true;
        
        const adminPanelPath = config.adminPanelPath || '/admin';
        console.log(`[管理员登录] IP: ${clientIp}, 跳转路径: ${adminPanelPath}`);
        
        res.json({ 
            success: true,
            adminPanelPath: adminPanelPath,
        });
    } else {
        // 登录失败，记录失败尝试
        loginLimiter.recordFailure(clientIp);
        const remaining = checkResult.remainingAttempts - 1;
        res.status(401).json({
            success: false,
            message: remaining > 0 ? `密码错误，剩余尝试次数：${remaining}` : '密码错误，账户已被锁定',
            remainingAttempts: remaining,
        });
    }
});

// 管理员登出
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, message: '登出失败' });
        }
        res.json({ success: true });
    });
});

// 管理员面板首页（使用可配置路径）
app.get(config.adminPanelPath, requireAdminAuth(config), (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
});

// 获取用户列表（支持分页）
app.get('/api/admin/users', requireAdminAuth(config), (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '20', 10);
        
        if (page < 1) {
            return res.status(400).json({
                success: false,
                message: '页码必须大于 0',
            });
        }
        
        if (limit < 1 || limit > 100) {
            return res.status(400).json({
                success: false,
                message: '每页数量必须在 1-100 之间',
            });
        }
        
        const allUsers = DataStore.getUsers();
        const total = allUsers.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        
        // 将用户关联到 server 信息
        const servers = DataStore.getServers();
        const users = allUsers.slice(startIndex, endIndex).map(u => {
            const server = servers.find(s => s.id === u.serverId);
            // 排除敏感信息：密码
            const { password, ...safeUser } = u;
            return {
                ...safeUser,
                serverName: server ? server.name : (u.serverId ? '未知服务器' : '未选择')
            };
        });
        
        res.json({
            success: true,
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '获取用户列表失败',
        });
    }
});

// 同步 SillyTavern 用户到本地记录
app.post('/api/admin/users/sync', requireAdminAuth(config), async (req, res) => {
    try {
        const { serverId } = req.body ?? {};
        const servers = serverId ? [DataStore.getServerById(serverId)].filter(Boolean) : DataStore.getServers();

        if (!servers.length) {
            return res.status(404).json({ success: false, message: '未找到可用服务器' });
        }

        const summary = {
            totalServers: servers.length,
            syncedServers: 0,
            totalRemoteUsers: 0,
            added: 0,
            updated: 0,
            errors: [],
        };

        for (const server of servers) {
            try {
                const client = new SillyTavernClient({
                    baseUrl: server.url,
                    adminHandle: server.admin_username,
                    adminPassword: server.admin_password,
                });

                const remoteUsers = await client.listUsers();
                summary.totalRemoteUsers += remoteUsers.length;

                for (const remote of remoteUsers) {
                    const handle = client.normalizeHandle(remote.handle);
                    if (!handle) {
                        continue;
                    }

                    const existing = DataStore.getUserByHandle(handle);
                    if (existing) {
                        DataStore.updateUser(handle, {
                            name: remote.name || existing.name,
                            serverId: existing.serverId ?? server.id,
                            registrationStatus: existing.registrationStatus || 'active',
                            syncedAt: new Date().toISOString(),
                            remoteCreatedAt: remote.created ?? existing.remoteCreatedAt,
                        });
                        summary.updated += 1;
                    } else {
                        DataStore.recordUser({
                            handle,
                            name: remote.name || handle,
                            registrationMethod: 'synced',
                            registrationStatus: 'active',
                            serverId: server.id,
                            syncedAt: new Date().toISOString(),
                            remoteCreatedAt: remote.created ?? null,
                        });
                        summary.added += 1;
                    }
                }

                summary.syncedServers += 1;
            } catch (error) {
                summary.errors.push({
                    serverId: server.id,
                    serverName: server.name,
                    message: error?.message || '同步失败',
                });
            }
        }

        res.json({ success: summary.errors.length === 0, summary });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || '同步用户失败' });
    }
});

// 删除 SillyTavern 用户
app.post('/api/admin/users/delete-remote', requireAdminAuth(config), async (req, res) => {
    try {
        const { handle, serverId, purge } = req.body ?? {};
        if (!handle || !serverId) {
            return res.status(400).json({ success: false, message: '缺少必要参数' });
        }

        const server = DataStore.getServerById(serverId);
        if (!server) {
            return res.status(404).json({ success: false, message: '服务器不存在' });
        }

        const client = new SillyTavernClient({
            baseUrl: server.url,
            adminHandle: server.admin_username,
            adminPassword: server.admin_password,
        });

        await client.deleteUser({ handle, purge: !!purge });
        DataStore.deleteUser(client.normalizeHandle(handle));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || '删除用户失败' });
    }
});

// 修改 SillyTavern 用户密码
app.post('/api/admin/users/change-password-remote', requireAdminAuth(config), async (req, res) => {
    try {
        const { handle, serverId, newPassword } = req.body ?? {};
        if (!handle || !serverId || !newPassword) {
            return res.status(400).json({ success: false, message: '缺少必要参数' });
        }

        const server = DataStore.getServerById(serverId);
        if (!server) {
            return res.status(404).json({ success: false, message: '服务器不存在' });
        }

        const client = new SillyTavernClient({
            baseUrl: server.url,
            adminHandle: server.admin_username,
            adminPassword: server.admin_password,
        });

        await client.changePassword({ handle, newPassword });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || '修改密码失败' });
    }
});

// 获取服务器列表（管理员用）
app.get('/api/admin/servers', requireAdminAuth(config), (req, res) => {
    try {
        const servers = DataStore.getServers();
        const users = DataStore.getUsers();

        const enriched = servers.map(s => {
            const serverNumericId = Number(s.id);
            const registeredUserCount = users.filter(u => {
                if (u.serverId == null) return false;
                return Number(u.serverId) === serverNumericId;
            }).length;
            // 排除敏感信息：管理员用户名和密码
            const { admin_username, admin_password, ...safeServer } = s;
            return {
                ...safeServer,
                id: serverNumericId,
                registeredUserCount,
                registrationPaused: s.registrationPaused === true,  // 确保返回布尔值，兼容旧数据
                storageLimitValue: s.storageLimitValue ?? null,
                storageLimitUnit: s.storageLimitUnit || 'mb',
                storageCheckIntervalMinutes: s.storageCheckIntervalMinutes ?? 5,
            };
        });

        res.json({ success: true, servers: enriched });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 添加服务器
app.post('/api/admin/servers', requireAdminAuth(config), async (req, res) => {
    try {
        const { 
            name, 
            url, 
            admin_username, 
            admin_password,
            // 可选展示字段
            description,
            provider,
            maintainer,
            contact,
            announcement,
        } = req.body;
        
        // 验证连接
        const tempClient = new SillyTavernClient({
            baseUrl: url,
            adminHandle: admin_username,
            adminPassword: admin_password
        });
        
        const testResult = await tempClient.testConnection();
        if (!testResult.success) {
             return res.status(400).json({ success: false, message: `连接失败: ${testResult.message}` });
        }

        const rawLimitValue = req.body.storageLimitValue;
        const normalizedLimitValue = rawLimitValue === '' || rawLimitValue === null || rawLimitValue === undefined
            ? null
            : Number(rawLimitValue);
        const storageLimitBytes = resolveStorageLimitBytes(normalizedLimitValue, req.body.storageLimitUnit);
        const rawIntervalValue = req.body.storageCheckIntervalMinutes;
        const normalizedInterval = rawIntervalValue === '' || rawIntervalValue === null || rawIntervalValue === undefined
            ? 5
            : Number(rawIntervalValue);
        const newServer = DataStore.addServer({
            name,
            url,
            admin_username,
            admin_password, // 注意：生产环境应加密存储
            localDataRoot: typeof req.body.localDataRoot === 'string' ? req.body.localDataRoot.trim() : '',
            storageLimitValue: normalizedLimitValue,
            storageLimitUnit: req.body.storageLimitUnit || 'mb',
            storageLimitBytes,
            storageCheckIntervalMinutes: Number.isFinite(normalizedInterval) && normalizedInterval > 0 ? normalizedInterval : 5,
            description,
            provider,
            maintainer,
            contact,
            announcement,
        });
        res.json({ success: true, server: newServer });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 获取单个服务器详细信息（用于编辑，包含敏感信息）
app.get('/api/admin/servers/:id', requireAdminAuth(config), (req, res) => {
    try {
        const { id } = req.params;
        const server = DataStore.getServerById(id);
        
        if (!server) {
            return res.status(404).json({ success: false, message: '服务器不存在' });
        }
        
        // 返回完整信息（包括管理员账号密码，仅管理员可见）
        res.json({ success: true, server });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 更新服务器
app.put('/api/admin/servers/:id', requireAdminAuth(config), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, url, admin_username, admin_password, isActive, registrationPaused } = req.body;
        
        const server = DataStore.getServerById(id);
        if (!server) {
            return res.status(404).json({ success: false, message: '服务器不存在' });
        }
        
        // 构建更新对象，只包含提供的字段
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (url !== undefined) updates.url = url;
        if (admin_username !== undefined && admin_username !== null && admin_username !== '') {
            updates.admin_username = admin_username;
        }
        // 密码：如果提供了新密码，则更新；如果为空字符串或未提供，则保留原密码
        if (admin_password !== undefined && admin_password !== null && admin_password !== '') {
            updates.admin_password = admin_password;
        }
        if (isActive !== undefined) updates.isActive = isActive;
        if (registrationPaused !== undefined) updates.registrationPaused = registrationPaused;
        
        // 如果更新了其他字段，也需要包含
        if (req.body.description !== undefined) updates.description = req.body.description;
        if (req.body.provider !== undefined) updates.provider = req.body.provider;
        if (req.body.maintainer !== undefined) updates.maintainer = req.body.maintainer;
        if (req.body.contact !== undefined) updates.contact = req.body.contact;
        if (req.body.announcement !== undefined) updates.announcement = req.body.announcement;
        if (req.body.localDataRoot !== undefined) {
            updates.localDataRoot = typeof req.body.localDataRoot === 'string' ? req.body.localDataRoot.trim() : '';
        }
        if (req.body.storageLimitValue !== undefined || req.body.storageLimitUnit !== undefined) {
            const rawLimitValue = req.body.storageLimitValue;
            const normalizedLimitValue = rawLimitValue === '' || rawLimitValue === null || rawLimitValue === undefined
                ? null
                : Number(rawLimitValue);
            const storageLimitBytes = resolveStorageLimitBytes(normalizedLimitValue, req.body.storageLimitUnit);
            updates.storageLimitValue = normalizedLimitValue;
            updates.storageLimitUnit = req.body.storageLimitUnit || 'mb';
            updates.storageLimitBytes = storageLimitBytes;
        }
        if (req.body.storageCheckIntervalMinutes !== undefined) {
            const rawIntervalValue = req.body.storageCheckIntervalMinutes;
            const normalizedInterval = rawIntervalValue === '' || rawIntervalValue === null || rawIntervalValue === undefined
                ? 5
                : Number(rawIntervalValue);
            updates.storageCheckIntervalMinutes = Number.isFinite(normalizedInterval) && normalizedInterval > 0 ? normalizedInterval : 5;
        }
        
        // 如果更改了连接信息，验证连接
        if (updates.url || updates.admin_username || updates.admin_password) {
            const tempClient = new SillyTavernClient({
                baseUrl: updates.url || server.url,
                adminHandle: updates.admin_username || server.admin_username,
                adminPassword: updates.admin_password || server.admin_password
            });
            const testResult = await tempClient.testConnection();
            if (!testResult.success) {
                return res.status(400).json({ success: false, message: `连接失败: ${testResult.message}` });
            }
        }

        const updatedServer = DataStore.updateServer(id, updates);
        res.json({ success: true, server: updatedServer });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 删除服务器
app.delete('/api/admin/servers/:id', requireAdminAuth(config), (req, res) => {
    try {
        const { id } = req.params;
        DataStore.deleteServer(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 测试服务器连接
app.post('/api/admin/servers/test', requireAdminAuth(config), async (req, res) => {
    try {
        const { url, admin_username, admin_password } = req.body;
        const tempClient = new SillyTavernClient({
            baseUrl: url,
            adminHandle: admin_username,
            adminPassword: admin_password
        });
        const testResult = await tempClient.testConnection();
        if (testResult.success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, message: testResult.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 获取邀请码列表（支持分页）
app.get('/api/admin/invite-codes', requireAdminAuth(config), (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '20', 10);
        
        if (page < 1) {
            return res.status(400).json({
                success: false,
                message: '页码必须大于 0',
            });
        }
        
        if (limit < 1 || limit > 100) {
            return res.status(400).json({
                success: false,
                message: '每页数量必须在 1-100 之间',
            });
        }
        
        const allCodes = DataStore.getInviteCodes();
        const total = allCodes.length;
        const totalPages = Math.ceil(total / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const codes = allCodes.slice(startIndex, endIndex);
        
        res.json({
            success: true,
            codes,
            pagination: {
                page,
                limit,
                total,
                totalPages,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '获取邀请码列表失败',
        });
    }
});

// 创建邀请码
app.post('/api/admin/invite-codes', requireAdminAuth(config), (req, res) => {
    try {
        const { count = 1, maxUses = 1, expiresAt = null } = req.body;
        
        if (count < 1 || count > 100) {
            return res.status(400).json({
                success: false,
                message: '邀请码数量必须在 1-100 之间',
            });
        }
        
        if (maxUses < 1 || maxUses > 1000) {
            return res.status(400).json({
                success: false,
                message: '最大使用次数必须在 1-1000 之间',
            });
        }
        
        const codes = InviteCodeService.createInviteCodes({
            count: parseInt(count),
            maxUses: parseInt(maxUses),
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdBy: 'admin',
        });
        
        res.json({ success: true, codes });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '创建邀请码失败',
        });
    }
});

// 删除邀请码
app.delete('/api/admin/invite-codes/:code', requireAdminAuth(config), (req, res) => {
    try {
        const { code } = req.params;
        const deleted = DataStore.deleteInviteCode(code);
        
        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({
                success: false,
                message: '邀请码不存在',
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '删除邀请码失败',
        });
    }
});

// 禁用/启用邀请码
app.patch('/api/admin/invite-codes/:code', requireAdminAuth(config), (req, res) => {
    try {
        const { code } = req.params;
        const { isActive } = req.body;
        
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'isActive 必须是布尔值',
            });
        }
        
        const updated = DataStore.toggleInviteCode(code, isActive);
        
        if (updated) {
            res.json({ success: true });
        } else {
            res.status(404).json({
                success: false,
                message: '邀请码不存在',
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '更新邀请码失败',
        });
    }
});

// 获取统计信息
app.get('/api/admin/stats', requireAdminAuth(config), (_req, res) => {
    try {
        const users = DataStore.getUsers();
        const codes = DataStore.getInviteCodes();
        const servers = DataStore.getServers();
        
        // 排除敏感信息：用户密码
        const safeRecentUsers = users.slice(-10).reverse().map(u => {
            const { password, ...safeUser } = u;
            return safeUser;
        });
        
        const stats = {
            totalUsers: users.length,
            totalInviteCodes: codes.length,
            activeInviteCodes: codes.filter(c => c.isActive).length,
            usedInviteCodes: codes.filter(c => c.usedCount > 0).length,
            totalServers: servers.length,
            activeServers: servers.filter(s => s.isActive).length,
            recentUsers: safeRecentUsers,
        };
        
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '获取统计信息失败',
        });
    }
});

// 防止直接访问受保护的静态文件（必须通过路由访问）
app.use((req, res, next) => {
    const protectedFiles = ['/admin.html', '/admin-login.html', '/oauth-invite.html', '/select-server.html'];
    if (protectedFiles.includes(req.path)) {
        return res.status(404).json({
            success: false,
            message: '接口不存在',
        });
    }
    next();
});

// 静态文件服务（放在路由之后，避免拦截管理员路由）
app.use(express.static(publicDir));

// Catch-all 路由（排除管理员路径）
app.use((req, res) => {
    // 排除管理员相关路径
    if (req.path === config.adminLoginPath || req.path === config.adminPanelPath || req.path.startsWith('/api/admin')) {
        return res.status(404).json({
            success: false,
            message: '接口不存在',
        });
    }
    
    const accept = req.headers.accept ?? '';
    if (accept.includes('text/html')) {
        sendRegisterPage(res);
        return;
    }

    res.status(404).json({
        success: false,
        message: '接口不存在',
    });
});

const port = config.port;
const host = config.host ?? '0.0.0.0';
const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;

app.listen(port, host, () => {
    console.log(`TavernRegister listening on http://${displayHost}:${port} (bound to ${host})`);
});

function sanitizeInput(payload) {
    const handle = typeof payload.handle === 'string' ? payload.handle.trim() : '';
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password.trim() : '';
    const inviteCode = typeof payload.inviteCode === 'string' ? payload.inviteCode.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    const emailCode = typeof payload.emailCode === 'string' ? payload.emailCode.trim() : '';

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

    // 密码可以为空（将使用默认密码）
    if (password && password.length > 128) {
        throw new Error('密码过长（最多 128 个字符）');
    }

    // 邀请码可以为空（如果未启用邀请码功能）
    if (inviteCode && inviteCode.length > 32) {
        throw new Error('邀请码过长（最多 32 个字符）');
    }

    // 邮箱验证
    if (email && email.length > 256) {
        throw new Error('邮箱地址过长（最多 256 个字符）');
    }

    // 邮箱验证码
    if (emailCode && emailCode.length > 10) {
        throw new Error('验证码格式不正确');
    }

    return {
        handle,
        name,
        password,
        inviteCode,
        email,
        emailCode,
    };
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
