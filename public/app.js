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
    const oauthProvidersElement = document.getElementById('oauth-providers');
    const oauthButtonsElement = document.getElementById('oauth-buttons');
    const form = formElement instanceof HTMLFormElement ? formElement : null;
    const loginLink = loginLinkElement instanceof HTMLAnchorElement ? loginLinkElement : null;

    // 加载 OAuth 提供商
    loadOAuthProviders();
    
    // 检查是否需要邀请码
    checkInviteCodeRequirement();
    
    // 添加用户名实时预览
    setupHandlePreview();

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

        const payload = {
            name: typeof nameValue === 'string' ? nameValue.trim() : '',
            handle: typeof handleValue === 'string' ? handleValue.trim() : '',
            password: typeof passwordValue === 'string' ? passwordValue.trim() : '',
            confirm: typeof confirmValue === 'string' ? confirmValue.trim() : '',
            inviteCode: typeof inviteCodeValue === 'string' ? inviteCodeValue.trim().toUpperCase() : '',
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

    // 加载 OAuth 提供商
    async function loadOAuthProviders() {
        try {
            const response = await fetch('/oauth/providers', {
                headers: { accept: 'application/json' },
            });
            
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const providers = data.providers || [];

            if (providers.length === 0) {
                return;
            }

            // 显示 OAuth 区域
            if (oauthProvidersElement) {
                oauthProvidersElement.style.display = 'block';
            }

            // 创建 OAuth 按钮
            if (oauthButtonsElement) {
                oauthButtonsElement.innerHTML = '';
                for (const provider of providers) {
                    const button = document.createElement('a');
                    button.className = `oauth-button ${provider.id}`;
                    button.href = `/oauth/auth/${provider.id}`;
                    button.textContent = `使用 ${provider.name} 注册`;
                    oauthButtonsElement.appendChild(button);
                }
            }
        } catch (error) {
            // 静默失败，不影响正常注册流程
            console.debug('无法加载 OAuth 提供商:', error);
        }
    }
    
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
                background: rgba(255, 193, 7, 0.2);
                border: 1px solid rgba(255, 193, 7, 0.5);
                border-radius: 8px;
                padding: 1rem;
                margin: 1rem 0;
                font-size: 0.95rem;
            `;
            passwordNotice.innerHTML = '<strong>⚠️ 重要提示：</strong><br>默认密码为 <strong style="font-family: monospace; color: #ffd700;">123456</strong><br>请登录后第一时间修改密码！';
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
            `;
            document.head.appendChild(style);
        }
    }

    // 检查是否需要邀请码
    async function checkInviteCodeRequirement() {
        try {
            const response = await fetch('/api/config', { headers: { accept: 'application/json' } });
            if (!response.ok) {
                console.error('获取配置失败:', response.status, response.statusText);
                return;
            }
            
            const data = await response.json();
            const inviteCodeField = document.getElementById('invite-code-field');
            const inviteCodeInput = inviteCodeField?.querySelector('input[name="inviteCode"]');
            
            if (!inviteCodeField || !inviteCodeInput) {
                console.error('邀请码字段未找到');
                return;
            }
            
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
        } catch (error) {
            console.error('检查邀请码要求失败:', error);
        }
    }
});
