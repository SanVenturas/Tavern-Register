import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const INVITE_CODES_FILE = path.join(DATA_DIR, 'invite-codes.json');

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
        };
        users.push(record);
        writeJsonFile(USERS_FILE, users);
        return record;
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

