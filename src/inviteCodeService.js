import crypto from 'node:crypto';
import { DataStore } from './dataStore.js';

/**
 * 邀请码服务
 */
export class InviteCodeService {
    /**
     * 生成邀请码
     * @param {number} length - 邀请码长度
     * @returns {string}
     */
    static generateCode(length = 8) {
        // 使用数字和大写字母，排除容易混淆的字符（0, O, I, 1）
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < length; i++) {
            code += chars[crypto.randomInt(0, chars.length)];
        }
        return code;
    }

    /**
     * 创建邀请码
     * @param {Object} options
     * @param {number} options.count - 生成数量
     * @param {number} options.maxUses - 最大使用次数
     * @param {Date} options.expiresAt - 过期时间
     * @param {string} options.createdBy - 创建者
     * @returns {Array}
     */
    static createInviteCodes({ count = 1, maxUses = 1, expiresAt = null, createdBy = 'admin' }) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            let code;
            let attempts = 0;
            // 确保生成的代码唯一
            do {
                code = this.generateCode();
                attempts++;
                if (attempts > 100) {
                    throw new Error('无法生成唯一的邀请码');
                }
            } while (DataStore.getInviteCodes().some(c => c.code === code));

            const inviteCode = DataStore.addInviteCode(code, createdBy, maxUses, expiresAt);
            codes.push(inviteCode);
        }
        return codes;
    }

    /**
     * 验证邀请码
     * @param {string} code
     * @returns {{valid: boolean, message?: string}}
     */
    static validate(code) {
        return DataStore.validateInviteCode(code);
    }

    /**
     * 使用邀请码
     * @param {string} code
     * @param {string} usedBy
     * @returns {boolean}
     */
    static use(code, usedBy) {
        return DataStore.useInviteCode(code, usedBy);
    }
}

