import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const INVITE_CODES_FILE = path.join(DATA_DIR, 'invite-codes.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 进程内文件写锁，防止并发读-改-写导致数据丢失
 */
const _fileLocks = new Map();

function _withFileLock(filePath, fn) {
    const execute = () => {
        const result = fn();
        return result;
    };

    const prev = _fileLocks.get(filePath) || Promise.resolve();
    const next = prev.then(execute, execute);
    _fileLocks.set(filePath, next.then(() => {}, () => {}));
    return next;
}

/**
 * 在文件锁保护下执行读-改-写操作（同步版本，用于现有同步 API）
 */
function withFileLockSync(filePath, fn) {
    // 对于同步调用，使用简单的标记锁（Node.js 单线程保证同步代码不会交错）
    return fn();
}

/**
 * 读取 JSON 文件
 */
function readJsonFile(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`读取文件失败 ${filePath}:`, error);
        return defaultValue;
    }
}

/**
 * 写入 JSON 文件
 */
function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error(`写入文件失败 ${filePath}:`, error);
        return false;
    }
}

export class DataStore {
    /**
     * 记录注册用户
     */
    static recordUser(userInfo) {
        return _withFileLock(USERS_FILE, () => {
            const users = readJsonFile(USERS_FILE, []);
            const record = {
                ...userInfo,
                registeredAt: new Date().toISOString(),
                id: users.length + 1,
                registrationStatus: userInfo.registrationStatus || 'pending_selection',
                serverId: userInfo.serverId || null,
            };
            users.push(record);
            writeJsonFile(USERS_FILE, users);
            return record;
        });
    }

    /**
     * 更新用户状态
     */
    static updateUser(handle, updates) {
        return _withFileLock(USERS_FILE, () => {
            const users = readJsonFile(USERS_FILE, []);
            const userIndex = users.findIndex(u => u.handle === handle);
            if (userIndex === -1) return null;

            users[userIndex] = { ...users[userIndex], ...updates };
            writeJsonFile(USERS_FILE, users);
            return users[userIndex];
        });
    }

    /**
     * 删除用户
     */
    static deleteUser(handle) {
        return _withFileLock(USERS_FILE, () => {
            const users = readJsonFile(USERS_FILE, []);
            const filtered = users.filter(u => u.handle !== handle);
            writeJsonFile(USERS_FILE, filtered);
            return filtered.length < users.length;
        });
    }

    /**
     * 获取所有注册用户
     */
    static getUsers() {
        return readJsonFile(USERS_FILE, []);
    }

    /**
     * 根据用户名获取用户
     */
    static getUserByHandle(handle) {
        const users = readJsonFile(USERS_FILE, []);
        return users.find(u => u.handle === handle);
    }

    /**
     * 根据邮箱获取用户
     */
    static getUserByEmail(email) {
        if (!email) return null;
        const normalizedEmail = email.toLowerCase().trim();
        const users = readJsonFile(USERS_FILE, []);
        return users.find(u => u.email && u.email.toLowerCase().trim() === normalizedEmail);
    }

    /**
     * 根据 IP 获取用户列表（用于检查 IP 是否已注册）
     */
    static getUsersByIp(ip) {
        if (!ip) return [];
        const users = readJsonFile(USERS_FILE, []);
        return users.filter(u => u.ip === ip);
    }

    /**
     * 检查 IP 是否已注册过（排除 pending 状态）
     */
    static hasIpRegistered(ip) {
        if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
            // 本地环境不限制
            return false;
        }
        const users = this.getUsersByIp(ip);
        // 只检查已激活的用户
        return users.some(u => u.registrationStatus === 'active');
    }

    /**
     * 检查邮箱是否已被使用
     */
    static isEmailUsed(email) {
        const user = this.getUserByEmail(email);
        return !!user;
    }

    /**
     * 添加服务器
     */
    static addServer(serverInfo) {
        return _withFileLock(SERVERS_FILE, () => {
            const servers = readJsonFile(SERVERS_FILE, []);
            const newServer = {
                id: servers.length > 0 ? Math.max(...servers.map(s => s.id)) + 1 : 1,
                name: serverInfo.name,
                url: serverInfo.url,
                admin_username: serverInfo.admin_username,
                admin_password: serverInfo.admin_password,
                localDataRoot: serverInfo.localDataRoot || '',
                storageLimitValue: serverInfo.storageLimitValue ?? null,
                storageLimitUnit: serverInfo.storageLimitUnit || 'mb',
                storageLimitBytes: serverInfo.storageLimitBytes ?? null,
                storageCheckIntervalMinutes: serverInfo.storageCheckIntervalMinutes ?? 5,
                description: serverInfo.description || '',
                provider: serverInfo.provider || '',
                maintainer: serverInfo.maintainer || '',
                contact: serverInfo.contact || '',
                announcement: serverInfo.announcement || '',
                createdAt: new Date().toISOString(),
                isActive: true,
                registrationPaused: false,
            };
            servers.push(newServer);
            writeJsonFile(SERVERS_FILE, servers);
            return newServer;
        });
    }

    /**
     * 获取所有服务器
     */
    static getServers() {
        const servers = readJsonFile(SERVERS_FILE, []);
        // 兼容旧数据：为没有 registrationPaused 字段的服务器设置默认值
        return servers.map(s => ({
            ...s,
            registrationPaused: s.registrationPaused === true,
            localDataRoot: s.localDataRoot || '',
            storageLimitValue: s.storageLimitValue ?? null,
            storageLimitUnit: s.storageLimitUnit || 'mb',
            storageLimitBytes: s.storageLimitBytes ?? null,
            storageCheckIntervalMinutes: s.storageCheckIntervalMinutes ?? 5,
        }));
    }

    /**
     * 获取可用服务器
     */
    static getActiveServers() {
        const servers = readJsonFile(SERVERS_FILE, []);
        // 兼容旧数据：为没有 registrationPaused 字段的服务器设置默认值
        return servers.filter(s => s.isActive).map(s => ({
            ...s,
            registrationPaused: s.registrationPaused === true,
        }));
    }

    /**
     * 根据 ID 获取服务器
     */
    static getServerById(id) {
        const servers = readJsonFile(SERVERS_FILE, []);
        const targetId = Number(id);
        const server = servers.find(s => Number(s.id) === targetId);
        // 兼容旧数据：为没有 registrationPaused 字段的服务器设置默认值
        return server ? {
            ...server,
            registrationPaused: server.registrationPaused === true,
            localDataRoot: server.localDataRoot || '',
            storageLimitValue: server.storageLimitValue ?? null,
            storageLimitUnit: server.storageLimitUnit || 'mb',
            storageLimitBytes: server.storageLimitBytes ?? null,
            storageCheckIntervalMinutes: server.storageCheckIntervalMinutes ?? 5,
        } : null;
    }

    /**
     * 更新服务器
     */
    static updateServer(id, updates) {
        return _withFileLock(SERVERS_FILE, () => {
            const servers = readJsonFile(SERVERS_FILE, []);
            const targetId = Number(id);
            const index = servers.findIndex(s => Number(s.id) === targetId);
            if (index === -1) return null;

            servers[index] = { ...servers[index], ...updates };
            writeJsonFile(SERVERS_FILE, servers);
            return servers[index];
        });
    }

    /**
     * 删除服务器
     */
    static deleteServer(id) {
        return _withFileLock(SERVERS_FILE, () => {
            const servers = readJsonFile(SERVERS_FILE, []);
            const targetId = Number(id);
            const filtered = servers.filter(s => Number(s.id) !== targetId);
            writeJsonFile(SERVERS_FILE, filtered);
            return filtered.length < servers.length;
        });
    }

    /**
     * 添加邀请码
     */
    static addInviteCode(code, createdBy = 'admin', maxUses = 1, expiresAt = null) {
        return _withFileLock(INVITE_CODES_FILE, () => {
            const codes = readJsonFile(INVITE_CODES_FILE, []);
            const inviteCode = {
                code,
                createdBy,
                createdAt: new Date().toISOString(),
                maxUses,
                usedCount: 0,
                expiresAt,
                isActive: true,
            };
            codes.push(inviteCode);
            writeJsonFile(INVITE_CODES_FILE, codes);
            return inviteCode;
        });
    }

    /**
     * 验证邀请码（仅查询，不修改）
     */
    static validateInviteCode(code) {
        const codes = readJsonFile(INVITE_CODES_FILE, []);
        const inviteCode = codes.find(c => c.code === code && c.isActive);

        if (!inviteCode) {
            return { valid: false, message: '邀请码不存在或已失效' };
        }

        if (inviteCode.expiresAt) {
            const expiresAt = new Date(inviteCode.expiresAt);
            if (expiresAt < new Date()) {
                return { valid: false, message: '邀请码已过期' };
            }
        }

        if (inviteCode.usedCount >= inviteCode.maxUses) {
            return { valid: false, message: '邀请码使用次数已达上限' };
        }

        return { valid: true, inviteCode };
    }

    /**
     * 原子地验证并消耗邀请码，防止并发请求重复使用同一邀请码
     */
    static validateAndUseInviteCode(code, usedBy) {
        return _withFileLock(INVITE_CODES_FILE, () => {
            const codes = readJsonFile(INVITE_CODES_FILE, []);
            const inviteCode = codes.find(c => c.code === code && c.isActive);

            if (!inviteCode) {
                return { valid: false, message: '邀请码不存在或已失效' };
            }

            if (inviteCode.expiresAt) {
                const expiresAt = new Date(inviteCode.expiresAt);
                if (expiresAt < new Date()) {
                    return { valid: false, message: '邀请码已过期' };
                }
            }

            if (inviteCode.usedCount >= inviteCode.maxUses) {
                return { valid: false, message: '邀请码使用次数已达上限' };
            }

            // 验证通过，原子地消耗
            inviteCode.usedCount += 1;
            if (!inviteCode.usedBy) {
                inviteCode.usedBy = [];
            }
            inviteCode.usedBy.push({
                handle: usedBy,
                usedAt: new Date().toISOString(),
            });

            if (inviteCode.usedCount >= inviteCode.maxUses) {
                inviteCode.isActive = false;
            }

            writeJsonFile(INVITE_CODES_FILE, codes);
            return { valid: true, inviteCode };
        });
    }

    /**
     * 使用邀请码（保留供向后兼容，推荐使用 validateAndUseInviteCode）
     */
    static useInviteCode(code, usedBy) {
        return _withFileLock(INVITE_CODES_FILE, () => {
            const codes = readJsonFile(INVITE_CODES_FILE, []);
            const inviteCode = codes.find(c => c.code === code && c.isActive);

            if (!inviteCode) {
                return false;
            }

            inviteCode.usedCount += 1;
            if (!inviteCode.usedBy) {
                inviteCode.usedBy = [];
            }
            inviteCode.usedBy.push({
                handle: usedBy,
                usedAt: new Date().toISOString(),
            });

            if (inviteCode.usedCount >= inviteCode.maxUses) {
                inviteCode.isActive = false;
            }

            writeJsonFile(INVITE_CODES_FILE, codes);
            return true;
        });
    }

    /**
     * 获取所有邀请码
     */
    static getInviteCodes() {
        return readJsonFile(INVITE_CODES_FILE, []);
    }

    /**
     * 删除邀请码
     */
    static deleteInviteCode(code) {
        return _withFileLock(INVITE_CODES_FILE, () => {
            const codes = readJsonFile(INVITE_CODES_FILE, []);
            const filtered = codes.filter(c => c.code !== code);
            writeJsonFile(INVITE_CODES_FILE, filtered);
            return filtered.length < codes.length;
        });
    }

    /**
     * 禁用/启用邀请码
     */
    static toggleInviteCode(code, isActive) {
        return _withFileLock(INVITE_CODES_FILE, () => {
            const codes = readJsonFile(INVITE_CODES_FILE, []);
            const inviteCode = codes.find(c => c.code === code);
            if (inviteCode) {
                inviteCode.isActive = isActive;
                writeJsonFile(INVITE_CODES_FILE, codes);
                return true;
            }
            return false;
        });
    }
}
