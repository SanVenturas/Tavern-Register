import nodemailer from 'nodemailer';

// 验证码存储（内存存储，生产环境建议使用 Redis）
const verificationCodes = new Map();

// 验证码配置
const CODE_LENGTH = 6;
const CODE_EXPIRE_TIME = 10 * 60 * 1000; // 10分钟
const CODE_COOLDOWN = 60 * 1000; // 发送冷却时间 60秒

/**
 * 邮箱验证服务
 */
export class EmailService {
    constructor(config) {
        this.config = config;
        this.transporter = null;
        
        // 只有配置了邮箱服务才初始化
        if (this.isConfigured()) {
            this.initTransporter();
        }
    }
    
    /**
     * 检查邮箱服务是否已配置
     */
    isConfigured() {
        return !!(this.config.smtpHost && this.config.smtpUser && this.config.smtpPass);
    }
    
    /**
     * 初始化邮件传输器
     */
    initTransporter() {
        this.transporter = nodemailer.createTransport({
            host: this.config.smtpHost,
            port: this.config.smtpPort || 465,
            secure: this.config.smtpSecure !== false, // 默认使用 SSL
            auth: {
                user: this.config.smtpUser,
                pass: this.config.smtpPass,
            },
        });
    }
    
    /**
     * 生成验证码
     */
    generateCode() {
        let code = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += Math.floor(Math.random() * 10);
        }
        return code;
    }
    
    /**
     * 检查是否可以发送验证码（冷却时间检查）
     */
    canSendCode(email) {
        const normalizedEmail = email.toLowerCase().trim();
        const existing = verificationCodes.get(normalizedEmail);
        
        if (!existing) {
            return { allowed: true };
        }
        
        const now = Date.now();
        const elapsed = now - existing.sentAt;
        
        if (elapsed < CODE_COOLDOWN) {
            const remainingSeconds = Math.ceil((CODE_COOLDOWN - elapsed) / 1000);
            return { 
                allowed: false, 
                message: `请等待 ${remainingSeconds} 秒后再发送验证码`,
                remainingSeconds 
            };
        }
        
        return { allowed: true };
    }
    
    /**
     * 发送验证码邮件
     */
    async sendVerificationCode(email) {
        if (!this.isConfigured()) {
            throw new Error('邮箱服务未配置，请联系管理员');
        }
        
        const normalizedEmail = email.toLowerCase().trim();
        
        // 检查冷却时间
        const cooldownCheck = this.canSendCode(normalizedEmail);
        if (!cooldownCheck.allowed) {
            throw new Error(cooldownCheck.message);
        }
        
        // 生成验证码
        const code = this.generateCode();
        const now = Date.now();
        
        // 存储验证码
        verificationCodes.set(normalizedEmail, {
            code,
            sentAt: now,
            expiresAt: now + CODE_EXPIRE_TIME,
            attempts: 0,
        });
        
        // 发送邮件
        const mailOptions = {
            from: this.config.smtpFrom || this.config.smtpUser,
            to: normalizedEmail,
            subject: `【${this.config.siteName || 'TavernRegister'}】邮箱验证码`,
            html: this.getEmailTemplate(code),
            text: `您的验证码是：${code}，有效期10分钟。如非本人操作，请忽略此邮件。`,
        };
        
        try {
            await this.transporter.sendMail(mailOptions);
            console.info(`[邮件发送] 验证码已发送至 ${normalizedEmail}`);
            return { success: true, message: '验证码已发送，请查收邮箱' };
        } catch (error) {
            console.error(`[邮件发送失败] ${normalizedEmail}:`, error);
            // 发送失败时清除验证码记录
            verificationCodes.delete(normalizedEmail);
            throw new Error('验证码发送失败，请稍后重试');
        }
    }
    
    /**
     * 验证验证码
     */
    verifyCode(email, code) {
        try {
            const normalizedEmail = email.toLowerCase().trim();
            const stored = verificationCodes.get(normalizedEmail);
            
            if (!stored) {
                return { valid: false, message: '请先获取验证码' };
            }
            
            const now = Date.now();
            
            // 检查是否过期
            if (now > stored.expiresAt) {
                verificationCodes.delete(normalizedEmail);
                return { valid: false, message: '验证码已过期，请重新获取' };
            }
            
            // 检查尝试次数（防止暴力破解）
            if (stored.attempts >= 5) {
                verificationCodes.delete(normalizedEmail);
                return { valid: false, message: '验证码尝试次数过多，请重新获取' };
            }
            
            // 验证码比对
            if (stored.code !== code.trim()) {
                stored.attempts += 1;
                return { valid: false, message: `验证码错误，剩余尝试次数：${5 - stored.attempts}` };
            }
            
            // 验证成功，删除验证码
            verificationCodes.delete(normalizedEmail);
            return { valid: true };
        } catch (error) {
            console.error('Verify code error:', error);
            return { valid: false, message: '验证失败' };
        }
    }
    
    /**
     * 获取邮件 HTML 模板
     */
    getEmailTemplate(code) {
        const siteName = this.config.siteName || 'TavernRegister';
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <tr>
            <td style="padding: 40px 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">
                    ${siteName}
                </h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
                    邮箱验证码
                </p>
            </td>
        </tr>
        <tr>
            <td style="padding: 40px 30px;">
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    您好！
                </p>
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                    您正在进行账号注册操作，以下是您的验证码：
                </p>
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 30px; text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #ffffff; font-family: 'Courier New', monospace;">
                        ${code}
                    </span>
                </div>
                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
                    ⏰ 验证码有效期为 <strong>10 分钟</strong>
                </p>
                <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
                    🔒 如果这不是您的操作，请忽略此邮件
                </p>
            </td>
        </tr>
        <tr>
            <td style="padding: 20px 30px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; line-height: 1.6; margin: 0; text-align: center;">
                    此邮件由系统自动发送，请勿直接回复
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
        `;
    }
    
    /**
     * 定期清理过期验证码
     */
    static cleanup() {
        const now = Date.now();
        for (const [email, data] of verificationCodes.entries()) {
            if (now > data.expiresAt) {
                verificationCodes.delete(email);
            }
        }
    }
}

// 导出清理函数
export const cleanupVerificationCodes = EmailService.cleanup;
