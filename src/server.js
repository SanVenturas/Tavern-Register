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
const client = new SillyTavernClient(config);
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
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 会话配置（用于存储 OAuth state）
app.use(session({
    secret: process.env.SESSION_SECRET || 'tavern-register-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 15 * 60 * 1000, // 15 分钟
    },
}));
const publicDir = path.join(__dirname, '../public');
const indexHtmlPath = path.join(publicDir, 'index.html');
const registerHtmlPath = path.join(publicDir, 'register.html');

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        sillyTavern: config.baseUrl,
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

app.get('/', (_req, res) => {
    sendRegisterPage(res);
});

app.get('/register', (_req, res) => {
    sendRegisterPage(res);
});

app.post('/register', async (req, res) => {
    try {
        const { handle, name, password, inviteCode } = sanitizeInput(req.body ?? {});
        
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
        const result = await client.registerUser({ handle, name, password: finalPassword });

        // 记录用户信息
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        DataStore.recordUser({
            handle: result.handle,
            name: name.trim(),
            ip: clientIp,
            inviteCode: inviteCode ? inviteCode.trim().toUpperCase() : null,
            registrationMethod: 'manual',
        });

        // 如果使用了邀请码，标记为已使用
        if (config.requireInviteCode && inviteCode) {
            InviteCodeService.use(inviteCode.trim().toUpperCase(), result.handle);
        }

        const timestamp = new Date().toISOString();
        console.info(`[注册审计] 时间 ${timestamp}，IP ${clientIp}，用户名 ${result.handle}，邀请码 ${inviteCode || '无'}`);

        res.status(201).json({
            success: true,
            handle: result.handle,
            loginUrl: `${config.baseUrl}/login`,
            defaultPassword: finalPassword === oauthService.getDefaultPassword(),
            message: finalPassword === oauthService.getDefaultPassword() 
                ? '注册成功！默认密码为 123456，请登录后第一时间修改密码。'
                : '注册成功！',
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
        const handle = oauthService.normalizeHandle(userInfo.username || userInfo.id);
        const displayName = userInfo.displayName || userInfo.username || `用户_${userInfo.id.slice(0, 8)}`;
        
        // 如果启用了邀请码，跳转到邀请码验证页面
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
        
        // 如果不需要邀请码，直接创建用户
        const defaultPassword = oauthService.getDefaultPassword();
        const result = await client.registerUser({
            handle: handle,
            name: displayName,
            password: defaultPassword,
        });

        // 记录用户信息
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        DataStore.recordUser({
            handle: result.handle,
            name: displayName,
            ip: clientIp,
            inviteCode: null,
            registrationMethod: `oauth:${provider}`,
        });

        const timestamp = new Date().toISOString();
        console.info(`[OAuth注册审计] 时间 ${timestamp}，IP ${clientIp}，提供商 ${provider}，用户名 ${result.handle}`);

        // 清除会话中的 OAuth 数据
        delete req.session.oauthState;
        delete req.session.oauthProvider;
        delete req.session.oauthBaseUrl;

        // 返回成功页面
        res.send(`
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>注册成功</title>
                <style>
                    body {
                        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        background: radial-gradient(circle at top, rgba(108, 92, 231, 0.2), transparent 60%),
                            radial-gradient(circle at bottom, rgba(85, 239, 196, 0.15), transparent 55%),
                            #10121a;
                        color: #f0f4ff;
                    }
                    .card {
                        background: rgba(27, 31, 44, 0.8);
                        backdrop-filter: blur(16px);
                        border-radius: 16px;
                        padding: 32px;
                        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
                        max-width: 500px;
                    }
                    h1 { color: #55efc4; }
                    .warning {
                        background: rgba(255, 118, 117, 0.2);
                        border-left: 4px solid #ff7675;
                        padding: 16px;
                        margin: 20px 0;
                        border-radius: 8px;
                    }
                    .info {
                        background: rgba(85, 239, 196, 0.1);
                        border-left: 4px solid #55efc4;
                        padding: 16px;
                        margin: 20px 0;
                        border-radius: 8px;
                    }
                    a {
                        color: #55efc4;
                        text-decoration: none;
                        font-weight: 600;
                    }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>注册成功！</h1>
                    <div class="info">
                        <p><strong>用户名：</strong>${result.handle}</p>
                        <p><strong>显示名称：</strong>${displayName}</p>
                    </div>
                    <div class="warning">
                        <p><strong>⚠️ 重要提示：</strong></p>
                        <p>您的默认密码为 <strong>123456</strong></p>
                        <p>请登录后<strong>第一时间修改密码</strong>以确保账户安全！</p>
                    </div>
                    <p><a href="${config.baseUrl}/login" target="_blank">前往登录页面</a></p>
                    <script>
                        setTimeout(() => {
                            window.location.href = '${config.baseUrl}/login';
                        }, 5000);
                    </script>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(`OAuth 回调处理失败 (${provider}):`, error);
        
        // 清除会话
        delete req.session.oauthState;
        delete req.session.oauthProvider;
        delete req.session.oauthBaseUrl;

        const errorMessage = error.message || '注册失败，请稍后再试';
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="utf-8">
                <title>注册失败</title>
                <style>
                    body {
                        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        background: #10121a;
                        color: #f0f4ff;
                    }
                    .card {
                        background: rgba(27, 31, 44, 0.8);
                        padding: 32px;
                        border-radius: 16px;
                        max-width: 500px;
                    }
                    .error {
                        color: #ff7675;
                    }
                    a {
                        color: #55efc4;
                        text-decoration: none;
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1 class="error">注册失败</h1>
                    <p>${errorMessage}</p>
                    <p><a href="/">返回注册页面</a></p>
                </div>
            </body>
            </html>
        `);
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
        
        // 使用默认密码注册
        const defaultPassword = oauthService.getDefaultPassword();
        const result = await client.registerUser({
            handle: handle,
            name: displayName,
            password: defaultPassword,
        });

        // 记录用户信息
        const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
        const clientIp = forwardedFor.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        
        DataStore.recordUser({
            handle: result.handle,
            name: displayName,
            ip: clientIp,
            inviteCode: inviteCode.trim().toUpperCase(),
            registrationMethod: `oauth:${provider}`,
        });

        // 标记邀请码为已使用
        InviteCodeService.use(inviteCode.trim().toUpperCase(), result.handle);

        const timestamp = new Date().toISOString();
        console.info(`[OAuth注册审计] 时间 ${timestamp}，IP ${clientIp}，提供商 ${provider}，用户名 ${result.handle}，邀请码 ${inviteCode.trim().toUpperCase()}`);

        // 清除会话中的待注册用户信息
        delete req.session.oauthPendingUser;
        
        res.json({
            success: true,
            handle: result.handle,
            displayName: displayName,
            loginUrl: `${config.baseUrl}/login`,
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
        const users = allUsers.slice(startIndex, endIndex);
        
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
        
        const stats = {
            totalUsers: users.length,
            totalInviteCodes: codes.length,
            activeInviteCodes: codes.filter(c => c.isActive).length,
            usedInviteCodes: codes.filter(c => c.usedCount > 0).length,
            recentUsers: users.slice(-10).reverse(),
        };
        
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || '获取统计信息失败',
        });
    }
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
