import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { SillyTavernClient } from './sillyTavernClient.js';
import { OAuthService } from './oauthService.js';
import { DataStore } from './dataStore.js';
import { InviteCodeService } from './inviteCodeService.js';
import { requireAdminAuth, verifyAdminPassword } from './adminAuth.js';
import LoginLimiter from './loginLimiter.js';

const config = loadConfig();
// const client = new SillyTavernClient(config); //不再使用全局客户端
const oauthService = new OAuthService(config);

// 初始化登录限制器
const loginLimiter = new LoginLimiter(config.maxLoginAttempts, config.loginLockoutTime);

// 定期清理过期记录（每小时）
setInterval(() => {
    loginLimiter.cleanup();
}, 60 * 60 * 1000);

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

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
    });
});

// 获取注册配置
app.get('/api/config', (_req, res) => {
    res.json({
        requireInviteCode: config.requireInviteCode || false,
    });
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
        const { handle, name, password, inviteCode } = sanitizeInput(req.body ?? {});
        
        // 标准化用户名
        const tempClient = new SillyTavernClient({}); // 仅用于 normalizeHandle
        const normalizedHandle = tempClient.normalizeHandle(handle);
        
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
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        const newUser = DataStore.recordUser({
            handle: normalizedHandle,
            name: name.trim(),
            password: finalPassword, // 暂时存储密码，用于后续绑定服务器时使用
            ip: clientIp,
            inviteCode: inviteCode ? inviteCode.trim().toUpperCase() : null,
            registrationMethod: 'manual',
            registrationStatus: 'pending_selection'
        });

        // 如果使用了邀请码，标记为已使用
        if (config.requireInviteCode && inviteCode) {
            InviteCodeService.use(inviteCode.trim().toUpperCase(), newUser.handle);
        }

        const timestamp = new Date().toISOString();
        console.info(`[注册审计] 时间 ${timestamp}，IP ${clientIp}，用户名 ${newUser.handle}，本地创建成功，等待选服`);

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
        const allUsers = DataStore.getUsers();
        const servers = DataStore.getActiveServers().map(s => {
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

        // 初始化客户端连接目标服务器
        const client = new SillyTavernClient({
            baseUrl: server.url,
            adminHandle: server.admin_username,
            adminPassword: server.admin_password
        });

        // 远程注册
        await client.registerUser({
            handle: user.handle,
            name: user.name,
            password: user.password // 使用之前暂存的密码
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
        
        // 如果启用了邀请码，跳转到邀请码验证页面（首次注册才会到这里）
        if (config.requireInviteCode) {
            // 将用户信息存入 session
            req.session.oauthPendingUser = {
                handle,
                displayName,
                provider,
            };
            
            // 清除 OAuth 状态
            delete req.session.oauthState;
            delete req.session.oauthProvider;
            delete req.session.oauthBaseUrl;
            
            // 跳转到邀请码验证页面
            return res.redirect('/oauth/invite');
        }
        
        // 创建新用户 (本地)
        const defaultPassword = oauthService.getDefaultPassword();
        
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        const newUser = DataStore.recordUser({
            handle: handle,
            name: displayName,
            password: defaultPassword,
            ip: clientIp,
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

// OAuth 邀请码验证 API
app.post('/oauth/invite', async (req, res) => {
    if (!req.session.oauthPendingUser) {
        return res.status(400).json({
            success: false,
            message: '会话已过期，请重新登录',
        });
    }
    
    const { inviteCode } = req.body;
    
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
    
    try {
        const { handle, displayName, provider } = req.session.oauthPendingUser;
        
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
        
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        const newUser = DataStore.recordUser({
            handle: handle,
            name: displayName,
            password: defaultPassword,
            ip: clientIp,
            inviteCode: inviteCode.trim().toUpperCase(),
            registrationMethod: `oauth:${provider}`,
            registrationStatus: 'pending_selection'
        });

        // 标记邀请码为已使用
        InviteCodeService.use(inviteCode.trim().toUpperCase(), newUser.handle);

        const timestamp = new Date().toISOString();
        console.info(`[OAuth注册审计] 时间 ${timestamp}，IP ${clientIp}，提供商 ${provider}，用户名 ${newUser.handle}，邀请码 ${inviteCode.trim().toUpperCase()}`);

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

        const newServer = DataStore.addServer({
            name,
            url,
            admin_username,
            admin_password, // 注意：生产环境应加密存储
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

// 更新服务器
app.put('/api/admin/servers/:id', requireAdminAuth(config), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, url, admin_username, admin_password, isActive } = req.body;
        
        // 如果更改了连接信息，验证连接
        if (url || admin_username || admin_password) {
            const server = DataStore.getServerById(id);
            const tempClient = new SillyTavernClient({
                baseUrl: url || server.url,
                adminHandle: admin_username || server.admin_username,
                adminPassword: admin_password || server.admin_password
            });
            const testResult = await tempClient.testConnection();
            if (!testResult.success) {
                return res.status(400).json({ success: false, message: `连接失败: ${testResult.message}` });
            }
        }

        const updatedServer = DataStore.updateServer(id, req.body);
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

    return {
        handle,
        name,
        password,
        inviteCode,
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
