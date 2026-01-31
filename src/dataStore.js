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
        const users = readJsonFile(USERS_FILE, []);
        const record = {
            ...userInfo,
            registeredAt: new Date().toISOString(),
            id: users.length + 1,
            registrationStatus: userInfo.registrationStatus || 'pending_selection', // pending_selection, active
            serverId: userInfo.serverId || null,
        };
        users.push(record);
        writeJsonFile(USERS_FILE, users);
        return record;
    }

    /**
     * 更新用户状态
     */
    static updateUser(handle, updates) {
        const users = readJsonFile(USERS_FILE, []);
        const userIndex = users.findIndex(u => u.handle === handle);
        if (userIndex === -1) return null;

        users[userIndex] = { ...users[userIndex], ...updates };
        writeJsonFile(USERS_FILE, users);
        return users[userIndex];
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
        const servers = readJsonFile(SERVERS_FILE, []);
        const newServer = {
            id: servers.length > 0 ? Math.max(...servers.map(s => s.id)) + 1 : 1,
            // 基础信息
            name: serverInfo.name,
            url: serverInfo.url,
            admin_username: serverInfo.admin_username,
            admin_password: serverInfo.admin_password,
            // 展示信息（可选）
            description: serverInfo.description || '',      // 服务器描述
            provider: serverInfo.provider || '',          // 服务器提供方
            maintainer: serverInfo.maintainer || '',      // 维护者
            contact: serverInfo.contact || '',            // 联系方式
            announcement: serverInfo.announcement || '',  // 公告
            createdAt: new Date().toISOString(),
            isActive: true,
            registrationPaused: false,                     // 是否暂停注册
        };
        servers.push(newServer);
        writeJsonFile(SERVERS_FILE, servers);
        return newServer;
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
        } : null;
    }

    /**
     * 更新服务器
     */
    static updateServer(id, updates) {
        const servers = readJsonFile(SERVERS_FILE, []);
        const targetId = Number(id);
        const index = servers.findIndex(s => Number(s.id) === targetId);
        if (index === -1) return null;

        servers[index] = { ...servers[index], ...updates };
        writeJsonFile(SERVERS_FILE, servers);
        return servers[index];
    }

    /**
     * 删除服务器
     */
    static deleteServer(id) {
        const servers = readJsonFile(SERVERS_FILE, []);
        const targetId = Number(id);
        const filtered = servers.filter(s => Number(s.id) !== targetId);
        writeJsonFile(SERVERS_FILE, filtered);
        return filtered.length < servers.length;
    }

    /**
     * 添加邀请码
     */
    static addInviteCode(code, createdBy = 'admin', maxUses = 1, expiresAt = null) {
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
    }

    /**
     * 验证邀请码
     */
    static validateInviteCode(code) {
        const codes = readJsonFile(INVITE_CODES_FILE, []);
        const inviteCode = codes.find(c => c.code === code && c.isActive);

        if (!inviteCode) {
            return { valid: false, message: '邀请码不存在或已失效' };
        }

        // 检查是否过期
        if (inviteCode.expiresAt) {
            const expiresAt = new Date(inviteCode.expiresAt);
            if (expiresAt < new Date()) {
                return { valid: false, message: '邀请码已过期' };
            }
        }

        // 检查使用次数
        if (inviteCode.usedCount >= inviteCode.maxUses) {
            return { valid: false, message: '邀请码使用次数已达上限' };
        }

        return { valid: true, inviteCode };
    }

    /**
     * 使用邀请码
     */
    static useInviteCode(code, usedBy) {
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

        // 如果达到最大使用次数，禁用邀请码
        if (inviteCode.usedCount >= inviteCode.maxUses) {
            inviteCode.isActive = false;
        }

        writeJsonFile(INVITE_CODES_FILE, codes);
        return true;
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
        const codes = readJsonFile(INVITE_CODES_FILE, []);
        const filtered = codes.filter(c => c.code !== code);
        writeJsonFile(INVITE_CODES_FILE, filtered);
        return filtered.length < codes.length;
    }

    /**
     * 禁用/启用邀请码
     */
    static toggleInviteCode(code, isActive) {
        const codes = readJsonFile(INVITE_CODES_FILE, []);
        const inviteCode = codes.find(c => c.code === code);
        if (inviteCode) {
            inviteCode.isActive = isActive;
            writeJsonFile(INVITE_CODES_FILE, codes);
            return true;
        }
        return false;
    }
}
