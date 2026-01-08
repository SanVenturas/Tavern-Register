function setStatus(message = '', isError = false) {
    const statusElement = document.getElementById('status');
    if (!statusElement) {
        return;
    }

    statusElement.textContent = message;
    const hasText = Boolean(message);
    statusElement.classList.toggle('status-error', hasText && isError);
    statusElement.classList.toggle('status-success', hasText && !isError);
}

function normalizeHandle(value) {
    if (typeof value !== 'string') {
        return '';
    }

    // 模拟 lodash.kebabcase 的行为：在字母和数字之间添加短横线
    return value
        .trim()
        .toLowerCase()
        // 在字母和数字之间添加短横线
        .replace(/([a-z])([0-9])/g, '$1-$2')
        // 在数字和字母之间添加短横线
        .replace(/([0-9])([a-z])/g, '$1-$2')
        // 将非字母数字字符替换为短横线
        .replace(/[^a-z0-9]+/g, '-')
        // 移除开头和结尾的短横线
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

document.addEventListener('DOMContentLoaded', () => {
    const formElement = document.getElementById('register-form');
    const loginLinkElement = document.getElementById('login-link');
    const form = formElement instanceof HTMLFormElement ? formElement : null;
    const loginLink = loginLinkElement instanceof HTMLAnchorElement ? loginLinkElement : null;
    
    // 检查注册配置（邀请码、邮箱验证等）
    checkRegistrationConfig();
    
    // 添加用户名实时预览
    setupHandlePreview();
    
    // 设置邮箱验证码发送功能
    setupEmailVerification();

    if (loginLink) {
        fetch('/health', { headers: { accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                if (!data?.sillyTavern) {
                    return;
                }
                loginLink.href = `${data.sillyTavern.replace(/\/$/, '')}/login`;
            })
            .catch(() => {
                /* 忽略健康检查失败，页面仍可手动填写登录地址 */
            });
    }

    if (!form) {
        return;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('');

        const formData = new FormData(form);
        const nameValue = formData.get('name');
        const handleValue = formData.get('handle');
        const passwordValue = formData.get('password');
        const confirmValue = formData.get('confirm');
        const inviteCodeValue = formData.get('inviteCode');
        const emailValue = formData.get('email');
        const emailCodeValue = formData.get('emailCode');

        const payload = {
            name: typeof nameValue === 'string' ? nameValue.trim() : '',
            handle: typeof handleValue === 'string' ? handleValue.trim() : '',
            password: typeof passwordValue === 'string' ? passwordValue.trim() : '',
            confirm: typeof confirmValue === 'string' ? confirmValue.trim() : '',
            inviteCode: typeof inviteCodeValue === 'string' ? inviteCodeValue.trim().toUpperCase() : '',
            email: typeof emailValue === 'string' ? emailValue.trim() : '',
            emailCode: typeof emailCodeValue === 'string' ? emailCodeValue.trim() : '',
        };

        if (!payload.name || !payload.handle) {
            setStatus('显示名称和用户标识均为必填项。', true);
            return;
        }

        const normalizedHandle = normalizeHandle(payload.handle);
        if (!normalizedHandle) {
            setStatus('请输入有效的用户标识，仅支持字母、数字与短横线。', true);
            return;
        }
        // 始终使用标准化后的用户名，并更新输入框显示
        payload.handle = normalizedHandle;
        const handleInput = form.querySelector('input[name="handle"]');
        if (handleInput instanceof HTMLInputElement && handleInput.value !== normalizedHandle) {
            handleInput.value = normalizedHandle;
            // 提示用户用户名已被标准化
            if (payload.handle !== (typeof handleValue === 'string' ? handleValue.trim().toLowerCase() : '')) {
                setStatus(`提示：用户名已自动转换为 "${normalizedHandle}"`, false);
                // 延迟一下再清除提示，让用户看到
                setTimeout(() => {
                    const currentStatus = document.getElementById('status');
                    if (currentStatus && currentStatus.textContent.includes('提示：用户名已自动转换为')) {
                        setStatus('', false);
                    }
                }, 2000);
            }
        }

        // 如果提供了密码，需要确认密码
        if (payload.password) {
            if (!payload.confirm) {
                setStatus('请再次输入密码以确认。', true);
                return;
            }
            if (payload.password !== payload.confirm) {
                setStatus('两次输入的密码不一致。', true);
                return;
            }
        }
        // 如果密码为空，将使用默认密码，不需要确认密码

        // 检查是否需要邮箱验证
        const emailField = document.getElementById('email-field');
        const emailCodeField = document.getElementById('email-code-field');
        const emailInput = emailField?.querySelector('input[name="email"]');
        const emailCodeInput = emailCodeField?.querySelector('input[name="emailCode"]');
        const requireEmail = emailField && emailField.style.display !== 'none' && emailInput?.hasAttribute('required');
        
        if (requireEmail) {
            if (!payload.email) {
                setStatus('邮箱地址不能为空。', true);
                if (emailInput) {
                    emailInput.focus();
                }
                return;
            }
            
            // 验证邮箱格式
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(payload.email)) {
                setStatus('邮箱格式不正确。', true);
                if (emailInput) {
                    emailInput.focus();
                }
                return;
            }
            
            if (!payload.emailCode) {
                setStatus('邮箱验证码不能为空，请先获取验证码。', true);
                if (emailCodeInput) {
                    emailCodeInput.focus();
                }
                return;
            }
        }
        
        // 检查是否需要邀请码
        const inviteCodeField = document.getElementById('invite-code-field');
        const inviteCodeInput = inviteCodeField?.querySelector('input[name="inviteCode"]');
        const requireInviteCode = inviteCodeField && inviteCodeField.style.display !== 'none' && inviteCodeInput?.hasAttribute('required');
        
        if (requireInviteCode && !payload.inviteCode) {
            setStatus('邀请码不能为空，请输入有效的邀请码。', true);
            if (inviteCodeInput) {
                inviteCodeInput.focus();
            }
            return;
        }

        const requestBody = {
            name: payload.name,
            handle: payload.handle,
            password: payload.password,
            inviteCode: payload.inviteCode,
            email: payload.email,
            emailCode: payload.emailCode,
        };

        try {
            const response = await fetch('/register', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                const message = data?.message ? String(data.message) : `注册失败（HTTP ${response.status}）`;
                setStatus(message, true);
                return;
            }

            form.reset();

            if (data.redirectUrl) {
                window.location.href = data.redirectUrl;
                return;
            }

            // 获取实际注册的用户名
            const actualHandle = data.handle || requestBody.handle;
            
            // 创建醒目的用户名提示弹窗
            showUsernameModal(actualHandle, data.defaultPassword, data.loginUrl);
            
            // 延长跳转时间，让用户有足够时间看到用户名
            if (loginLink && data.loginUrl) {
                loginLink.href = data.loginUrl;
            }

            setTimeout(() => {
                const originalHref = loginLink?.getAttribute('href');
                if (loginLink && originalHref && originalHref !== '#') {
                    window.location.replace(loginLink.href);
                }
            }, data.defaultPassword ? 10000 : 8000); // 延长到8-10秒
        } catch (error) {
            const message = error instanceof Error ? error.message : '发生未知错误，请稍后再试。';
            setStatus(message, true);
        }
    });

    // 设置用户名实时预览
    function setupHandlePreview() {
        const handleInput = form?.querySelector('input[name="handle"]');
        if (!handleInput) return;
        
        // 查找或创建预览提示元素
        let previewElement = document.getElementById('handle-preview');
        if (!previewElement) {
            previewElement = document.createElement('small');
            previewElement.id = 'handle-preview';
            previewElement.className = 'hint';
            previewElement.style.color = 'rgba(99, 102, 241, 0.8)';
            previewElement.style.fontSize = '0.85rem';
            previewElement.style.marginTop = '0.25rem';
            const handleField = handleInput.closest('.field');
            if (handleField) {
                handleField.appendChild(previewElement);
            }
        }
        
        const updatePreview = () => {
            const value = handleInput.value;
            if (!value || value.trim() === '') {
                previewElement.textContent = '';
                return;
            }
            
            const normalized = normalizeHandle(value);
            if (normalized !== value.trim().toLowerCase()) {
                previewElement.textContent = `实际用户名将显示为: ${normalized}`;
                previewElement.style.display = 'block';
            } else {
                previewElement.textContent = '';
            }
        };
        
        handleInput.addEventListener('input', updatePreview);
        handleInput.addEventListener('blur', updatePreview);
    }
    
    // 显示用户名弹窗
    function showUsernameModal(username, isDefaultPassword, loginUrl) {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.id = 'username-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.3s ease-in-out;
        `;
        
        // 创建弹窗
        const modal = document.createElement('div');
        modal.id = 'username-modal';
        modal.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px;
            padding: 2.5rem;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            text-align: center;
            color: white;
            animation: slideUp 0.4s ease-out;
        `;
        
        // 成功图标
        const icon = document.createElement('div');
        icon.style.cssText = `
            font-size: 4rem;
            margin-bottom: 1rem;
            animation: bounce 0.6s ease-in-out;
        `;
        icon.textContent = '✅';
        
        // 标题
        const title = document.createElement('h2');
        title.style.cssText = `
            font-size: 1.75rem;
            font-weight: 700;
            margin: 0 0 1rem 0;
            color: white;
        `;
        title.textContent = '注册成功！';
        
        // 用户名显示框
        const usernameBox = document.createElement('div');
        usernameBox.style.cssText = `
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 12px;
            padding: 1.5rem;
            margin: 1.5rem 0;
        `;
        
        const usernameLabel = document.createElement('div');
        usernameLabel.style.cssText = `
            font-size: 0.9rem;
            opacity: 0.9;
            margin-bottom: 0.5rem;
        `;
        usernameLabel.textContent = '您的用户名：';
        
        const usernameValue = document.createElement('div');
        usernameValue.style.cssText = `
            font-size: 2rem;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            letter-spacing: 0.05em;
            color: #ffd700;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            word-break: break-all;
        `;
        usernameValue.textContent = username;
        
        usernameBox.appendChild(usernameLabel);
        usernameBox.appendChild(usernameValue);
        
        // 密码提示
        let passwordNotice = null;
        if (isDefaultPassword) {
            passwordNotice = document.createElement('div');
            passwordNotice.style.cssText = `
                background: linear-gradient(135deg, rgba(255, 59, 48, 0.95) 0%, rgba(255, 149, 0, 0.95) 100%);
                border: 3px solid rgba(255, 255, 255, 0.8);
                border-radius: 12px;
                padding: 1.5rem;
                margin: 1.5rem 0;
                box-shadow: 0 8px 24px rgba(255, 59, 48, 0.3);
                animation: pulse 2s ease-in-out infinite;
            `;
            
            const warningIcon = document.createElement('div');
            warningIcon.style.cssText = `
                font-size: 2.5rem;
                margin-bottom: 0.75rem;
            `;
            warningIcon.textContent = '⚠️';
            
            const warningTitle = document.createElement('div');
            warningTitle.style.cssText = `
                font-size: 1.2rem;
                font-weight: 700;
                margin-bottom: 1rem;
                color: white;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            `;
            warningTitle.textContent = '🔐 重要安全提示';
            
            const passwordBox = document.createElement('div');
            passwordBox.style.cssText = `
                background: rgba(255, 255, 255, 0.25);
                border: 2px dashed rgba(255, 255, 255, 0.6);
                border-radius: 10px;
                padding: 1.25rem;
                margin: 1rem 0;
            `;
            
            const passwordLabel = document.createElement('div');
            passwordLabel.style.cssText = `
                font-size: 0.95rem;
                color: white;
                margin-bottom: 0.5rem;
                font-weight: 600;
            `;
            passwordLabel.textContent = '您的默认密码为：';
            
            const passwordValue = document.createElement('div');
            passwordValue.style.cssText = `
                font-size: 2.5rem;
                font-weight: 900;
                font-family: 'Courier New', monospace;
                color: #FFEB3B;
                text-shadow: 0 3px 6px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 235, 59, 0.5);
                letter-spacing: 0.15em;
                margin: 0.5rem 0;
            `;
            passwordValue.textContent = '123456';
            
            passwordBox.appendChild(passwordLabel);
            passwordBox.appendChild(passwordValue);
            
            const urgentNote = document.createElement('div');
            urgentNote.style.cssText = `
                font-size: 1.05rem;
                font-weight: 700;
                color: white;
                margin-top: 1rem;
                line-height: 1.6;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            `;
            urgentNote.innerHTML = '⚡ 登录后第一件事：<br>请立即前往设置修改密码！';
            
            passwordNotice.appendChild(warningIcon);
            passwordNotice.appendChild(warningTitle);
            passwordNotice.appendChild(passwordBox);
            passwordNotice.appendChild(urgentNote);
        }
        
        // 提示文字
        const tip = document.createElement('div');
        tip.style.cssText = `
            font-size: 0.9rem;
            opacity: 0.9;
            margin-top: 1.5rem;
            line-height: 1.6;
        `;
        tip.textContent = '请牢记您的用户名，页面将在几秒后自动跳转到登录页面...';
        
        // 组装弹窗
        modal.appendChild(icon);
        modal.appendChild(title);
        modal.appendChild(usernameBox);
        if (passwordNotice) {
            modal.appendChild(passwordNotice);
        }
        modal.appendChild(tip);
        overlay.appendChild(modal);
        
        // 添加到页面
        document.body.appendChild(overlay);
        
        // 添加CSS动画
        if (!document.getElementById('username-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'username-modal-styles';
            style.textContent = `
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from {
                        transform: translateY(30px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                @keyframes bounce {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                @keyframes pulse {
                    0%, 100% { 
                        transform: scale(1);
                        box-shadow: 0 8px 24px rgba(255, 59, 48, 0.3);
                    }
                    50% { 
                        transform: scale(1.02);
                        box-shadow: 0 12px 32px rgba(255, 59, 48, 0.5);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // 检查注册配置（邀请码、邮箱验证等）
    async function checkRegistrationConfig() {
        try {
            const response = await fetch('/api/config', { headers: { accept: 'application/json' } });
            if (!response.ok) {
                console.error('获取配置失败:', response.status, response.statusText);
                return;
            }
            
            const data = await response.json();
            
            // 邀请码配置
            const inviteCodeField = document.getElementById('invite-code-field');
            const inviteCodeInput = inviteCodeField?.querySelector('input[name="inviteCode"]');
            
            if (inviteCodeField && inviteCodeInput) {
                if (data.requireInviteCode) {
                    inviteCodeField.style.display = 'grid';
                    inviteCodeInput.required = true;
                    inviteCodeInput.setAttribute('required', 'required');
                    console.log('邀请码功能已启用');
                } else {
                    inviteCodeField.style.display = 'none';
                    inviteCodeInput.required = false;
                    inviteCodeInput.removeAttribute('required');
                }
            }
            
            // 邮箱验证配置
            const emailField = document.getElementById('email-field');
            const emailCodeField = document.getElementById('email-code-field');
            const emailInput = emailField?.querySelector('input[name="email"]');
            const emailCodeInput = emailCodeField?.querySelector('input[name="emailCode"]');
            
            if (emailField && emailCodeField && emailInput && emailCodeInput) {
                if (data.requireEmailVerification) {
                    emailField.style.display = 'grid';
                    emailCodeField.style.display = 'grid';
                    emailInput.required = true;
                    emailCodeInput.required = true;
                    emailInput.setAttribute('required', 'required');
                    emailCodeInput.setAttribute('required', 'required');
                    console.log('邮箱验证功能已启用');
                } else {
                    emailField.style.display = 'none';
                    emailCodeField.style.display = 'none';
                    emailInput.required = false;
                    emailCodeInput.required = false;
                    emailInput.removeAttribute('required');
                    emailCodeInput.removeAttribute('required');
                }
            }
        } catch (error) {
            console.error('检查注册配置失败:', error);
        }
    }
    
    // 设置邮箱验证码发送功能
    function setupEmailVerification() {
        const sendCodeBtn = document.getElementById('send-code-btn');
        const emailInput = document.querySelector('input[name="email"]');
        const captchaModal = document.getElementById('captcha-modal');
        const captchaQuestion = document.getElementById('captcha-question');
        const captchaAnswer = document.getElementById('captcha-answer');
        const captchaError = document.getElementById('captcha-error');
        const captchaRefresh = document.getElementById('captcha-refresh');
        const captchaSubmit = document.getElementById('captcha-submit');
        
        if (!sendCodeBtn || !emailInput) {
            return;
        }
        
        let countdown = 0;
        let countdownTimer = null;
        let currentCaptcha = null;
        
        function updateButtonState() {
            if (countdown > 0) {
                sendCodeBtn.textContent = `${countdown}秒后重试`;
                sendCodeBtn.disabled = true;
                sendCodeBtn.style.opacity = '0.6';
                sendCodeBtn.style.cursor = 'not-allowed';
            } else {
                sendCodeBtn.textContent = '发送验证码';
                sendCodeBtn.disabled = false;
                sendCodeBtn.style.opacity = '1';
                sendCodeBtn.style.cursor = 'pointer';
            }
        }
        
        function startCountdown(seconds) {
            countdown = seconds;
            updateButtonState();
            
            if (countdownTimer) {
                clearInterval(countdownTimer);
            }
            
            countdownTimer = setInterval(() => {
                countdown--;
                updateButtonState();
                
                if (countdown <= 0) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                }
            }, 1000);
        }
        
        // 生成简单的数学验证题
        function generateCaptcha() {
            const operators = ['+', '-', '×'];
            const operator = operators[Math.floor(Math.random() * operators.length)];
            let num1, num2, answer;
            
            switch (operator) {
                case '+':
                    num1 = Math.floor(Math.random() * 50) + 1;
                    num2 = Math.floor(Math.random() * 50) + 1;
                    answer = num1 + num2;
                    break;
                case '-':
                    num1 = Math.floor(Math.random() * 50) + 20;
                    num2 = Math.floor(Math.random() * 20) + 1;
                    answer = num1 - num2;
                    break;
                case '×':
                    num1 = Math.floor(Math.random() * 9) + 2;
                    num2 = Math.floor(Math.random() * 9) + 2;
                    answer = num1 * num2;
                    break;
            }
            
            return {
                question: `${num1} ${operator} ${num2} = ?`,
                answer: answer
            };
        }
        
        // 显示验证码弹窗
        function showCaptchaModal() {
            if (!captchaModal || !captchaQuestion || !captchaAnswer) return;
            
            currentCaptcha = generateCaptcha();
            captchaQuestion.textContent = currentCaptcha.question;
            captchaAnswer.value = '';
            captchaError.textContent = '';
            captchaModal.style.display = 'flex';
            
            setTimeout(() => captchaAnswer.focus(), 100);
        }
        
        // 隐藏验证码弹窗
        function hideCaptchaModal() {
            if (captchaModal) {
                captchaModal.style.display = 'none';
            }
            currentCaptcha = null;
        }
        
        // 验证答案并发送邮件验证码
        async function verifyCaptchaAndSendCode() {
            if (!currentCaptcha) return;
            
            const userAnswer = parseInt(captchaAnswer.value.trim(), 10);
            
            if (isNaN(userAnswer)) {
                captchaError.textContent = '请输入数字答案';
                captchaAnswer.focus();
                return;
            }
            
            if (userAnswer !== currentCaptcha.answer) {
                captchaError.textContent = '答案错误，请重试';
                captchaAnswer.value = '';
                captchaAnswer.focus();
                // 换一道题
                currentCaptcha = generateCaptcha();
                captchaQuestion.textContent = currentCaptcha.question;
                return;
            }
            
            // 答案正确，隐藏弹窗并发送验证码
            hideCaptchaModal();
            
            const email = emailInput.value.trim();
            
            // 禁用按钮，显示发送中
            sendCodeBtn.textContent = '发送中...';
            sendCodeBtn.disabled = true;
            
            try {
                const response = await fetch('/api/email/send-code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                });
                
                const data = await response.json();
                
                if (response.ok && data.success) {
                    setStatus('验证码已发送，请查收邮箱', false);
                    startCountdown(60);
                    
                    // 自动聚焦到验证码输入框
                    const emailCodeInput = document.querySelector('input[name="emailCode"]');
                    if (emailCodeInput) {
                        emailCodeInput.focus();
                    }
                } else {
                    setStatus(data.message || '发送验证码失败', true);
                    updateButtonState();
                }
            } catch (error) {
                console.error('发送验证码失败:', error);
                setStatus('发送验证码失败，请稍后重试', true);
                updateButtonState();
            }
        }
        
        // 绑定事件
        sendCodeBtn.addEventListener('click', () => {
            const email = emailInput.value.trim();
            
            if (!email) {
                setStatus('请先输入邮箱地址', true);
                emailInput.focus();
                return;
            }
            
            // 简单的邮箱格式验证
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                setStatus('邮箱格式不正确', true);
                emailInput.focus();
                return;
            }
            
            // 显示人机验证弹窗
            showCaptchaModal();
        });
        
        // 刷新验证题
        if (captchaRefresh) {
            captchaRefresh.addEventListener('click', () => {
                currentCaptcha = generateCaptcha();
                captchaQuestion.textContent = currentCaptcha.question;
                captchaAnswer.value = '';
                captchaError.textContent = '';
                captchaAnswer.focus();
            });
        }
        
        // 提交验证
        if (captchaSubmit) {
            captchaSubmit.addEventListener('click', verifyCaptchaAndSendCode);
        }
        
        // 回车提交
        if (captchaAnswer) {
            captchaAnswer.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    verifyCaptchaAndSendCode();
                }
            });
        }
        
        // 点击遮罩关闭
        if (captchaModal) {
            const overlay = captchaModal.querySelector('.captcha-overlay');
            if (overlay) {
                overlay.addEventListener('click', hideCaptchaModal);
            }
        }
    }
});
