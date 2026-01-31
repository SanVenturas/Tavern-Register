/**
 * 管理员认证中间件
 */
export function requireAdminAuth(config) {
    return (req, res, next) => {
        if (req.session && req.session.isAdmin) {
            return next();
        }

        // 如果是 API 请求，返回 JSON
        if (req.path.startsWith('/api/admin')) {
            return res.status(401).json({
                success: false,
                message: '需要管理员权限',
            });
        }

        // 否则重定向到登录页（使用配置的路径）
        const loginPath = config?.adminLoginPath || '/admin/login';
        res.redirect(loginPath);
    };
}

/**
 * 管理员登录验证
 */
export function verifyAdminPassword(password, correctPassword) {
    return password === correctPassword;
}

