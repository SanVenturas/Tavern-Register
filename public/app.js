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

    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

document.addEventListener('DOMContentLoaded', () => {
    const formElement = document.getElementById('register-form');
    const loginLinkElement = document.getElementById('login-link');
    const form = formElement instanceof HTMLFormElement ? formElement : null;
    const loginLink = loginLinkElement instanceof HTMLAnchorElement ? loginLinkElement : null;

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

        const payload = {
            name: typeof nameValue === 'string' ? nameValue.trim() : '',
            handle: typeof handleValue === 'string' ? handleValue.trim() : '',
            password: typeof passwordValue === 'string' ? passwordValue.trim() : '',
            confirm: typeof confirmValue === 'string' ? confirmValue.trim() : '',
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
        if (normalizedHandle !== payload.handle) {
            payload.handle = normalizedHandle;
            const handleInput = form.querySelector('input[name="handle"]');
            if (handleInput instanceof HTMLInputElement) {
                handleInput.value = normalizedHandle;
            }
        }

        if (!payload.password) {
            setStatus('密码不能为空。', true);
            return;
        }

        if (!payload.confirm) {
            setStatus('请再次输入密码以确认。', true);
            return;
        }

        if (payload.password !== payload.confirm) {
            setStatus('两次输入的密码不一致。', true);
            return;
        }

        const requestBody = {
            name: payload.name,
            handle: payload.handle,
            password: payload.password,
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
            setStatus(`账号“${data.handle}”创建成功！`, false);
            if (loginLink && data.loginUrl) {
                loginLink.href = data.loginUrl;
            }

            setTimeout(() => {
                const originalHref = loginLink?.getAttribute('href');
                if (loginLink && originalHref && originalHref !== '#') {
                    window.location.replace(loginLink.href);
                }
            }, 3500);
        } catch (error) {
            const message = error instanceof Error ? error.message : '发生未知错误，请稍后再试。';
            setStatus(message, true);
        }
    });
});
