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

function setOAuthStatus(message = '', variant = 'neutral') {
    const statusElement = document.getElementById('oauth-status');
    if (!statusElement) {
        return;
    }

    statusElement.textContent = message;
    const hasText = Boolean(message);
    statusElement.classList.toggle('status-success', hasText && variant === 'success');
    statusElement.classList.toggle('status-error', hasText && variant === 'error');
}

function clearQueryString() {
    if (!window.location.search) {
        return;
    }

    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url);
}

document.addEventListener('DOMContentLoaded', () => {
    const oauthButtonsElement = document.getElementById('oauth-buttons');
    const oauthButtonsContainer = oauthButtonsElement instanceof HTMLElement ? oauthButtonsElement : null;
    const oauthBoxRaw = document.querySelector('.oauth-box');
    const oauthBoxElement = oauthBoxRaw instanceof HTMLElement ? oauthBoxRaw : null;

    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (status === 'bound') {
        const handle = params.get('handle');
        const handleText = handle ? `“${handle}”` : '某个已存在的账户';
        setStatus(`该第三方账号已绑定酒馆账号 ${handleText}，无法重复绑定。`, true);
        clearQueryString();
    }

    if (!oauthButtonsContainer || !oauthBoxElement) {
        return;
    }

    fetch('/oauth/providers', { headers: { accept: 'application/json' } })
        .then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then((data) => {
            const providers = Array.isArray(data?.providers) ? data.providers : [];

            if (providers.length === 0) {
                oauthBoxElement.style.display = 'none';
                setStatus('暂未启用任何第三方授权，请联系管理员。', true);
                return;
            }

            oauthButtonsContainer.textContent = '';
            providers.forEach((provider) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'oauth-button';
                button.textContent = `使用 ${provider.displayName} 授权`;
                button.addEventListener('click', () => {
                    setOAuthStatus(`正在跳转至 ${provider.displayName}，请稍候…`, 'neutral');
                    window.location.href = `/oauth/${provider.name}/start`;
                });
                oauthButtonsContainer.appendChild(button);
            });
        })
        .catch((error) => {
            console.error('加载 OAuth 提供方失败：', error);
            oauthBoxElement.style.display = 'none';
            setStatus('暂时无法加载第三方授权服务，请稍后再试。', true);
        });
});
