function setStatus(message = '', isError = false) {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;

    statusElement.textContent = message;
    const hasText = Boolean(message);
    statusElement.classList.toggle('status-error', hasText && isError);
    statusElement.classList.toggle('status-success', hasText && !isError);
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const oauthProvidersElement = document.getElementById('oauth-providers');
    const oauthButtonsElement = document.getElementById('oauth-buttons');

    // 加载 OAuth 提供商
    loadOAuthProviders();

    if (!form) return;

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
                    button.textContent = `使用 ${provider.name} 登录`;
                    oauthButtonsElement.appendChild(button);
                }
            }
        } catch (error) {
            console.debug('无法加载 OAuth 提供商:', error);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('');

        const formData = new FormData(form);
        const handle = formData.get('handle');
        const password = formData.get('password');

        if (!handle || !password) {
            setStatus('请输入用户标识和密码。', true);
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ handle, password }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                setStatus(data.message || '登录失败', true);
                return;
            }

            setStatus('登录成功，正在跳转...', false);
            setTimeout(() => {
                window.location.href = data.redirectUrl || '/select-server';
            }, 1000);

        } catch (error) {
            setStatus('发生系统错误，请稍后重试。', true);
            console.error('Login error:', error);
        }
    });
});
