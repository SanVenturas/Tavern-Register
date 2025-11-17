/**
 * 登录限制器 - 防止暴力破解
 */
class LoginLimiter {
    constructor(maxAttempts = 5, lockoutTime = 15 * 60 * 1000) {
        this.maxAttempts = maxAttempts;
        this.lockoutTime = lockoutTime;
        this.attempts = new Map(); // IP -> { count, lockUntil }
    }

    /**
     * 检查是否可以尝试登录
     * @param {string} ip - 客户端 IP
     * @returns {{allowed: boolean, remainingAttempts?: number, lockUntil?: Date}}
     */
    check(ip) {
        const record = this.attempts.get(ip);
        
        if (!record) {
            return { allowed: true, remainingAttempts: this.maxAttempts };
        }

        // 检查是否还在锁定期间
        if (record.lockUntil && record.lockUntil > Date.now()) {
            const lockMinutes = Math.ceil((record.lockUntil - Date.now()) / 60000);
            return {
                allowed: false,
                lockUntil: new Date(record.lockUntil),
                lockMinutes,
            };
        }

        // 锁定时间已过，重置
        if (record.lockUntil && record.lockUntil <= Date.now()) {
            this.attempts.delete(ip);
            return { allowed: true, remainingAttempts: this.maxAttempts };
        }

        // 检查尝试次数
        if (record.count >= this.maxAttempts) {
            // 达到最大尝试次数，锁定
            const lockUntil = Date.now() + this.lockoutTime;
            record.lockUntil = lockUntil;
            const lockMinutes = Math.ceil(this.lockoutTime / 60000);
            return {
                allowed: false,
                lockUntil: new Date(lockUntil),
                lockMinutes,
            };
        }

        return {
            allowed: true,
            remainingAttempts: this.maxAttempts - record.count,
        };
    }

    /**
     * 记录失败的登录尝试
     * @param {string} ip - 客户端 IP
     */
    recordFailure(ip) {
        const record = this.attempts.get(ip) || { count: 0 };
        record.count += 1;
        record.lastAttempt = Date.now();
        this.attempts.set(ip, record);
    }

    /**
     * 清除登录尝试记录（登录成功时调用）
     * @param {string} ip - 客户端 IP
     */
    clear(ip) {
        this.attempts.delete(ip);
    }

    /**
     * 清理过期的记录
     */
    cleanup() {
        const now = Date.now();
        for (const [ip, record] of this.attempts.entries()) {
            if (record.lockUntil && record.lockUntil <= now) {
                // 锁定时间已过，删除记录
                this.attempts.delete(ip);
            } else if (!record.lockUntil && record.lastAttempt && (now - record.lastAttempt) > this.lockoutTime * 2) {
                // 没有锁定但超过两倍锁定时间未尝试，删除记录
                this.attempts.delete(ip);
            }
        }
    }
}

export default LoginLimiter;

