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
                    'accept': 'application/json',
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
        } catch (error) {
            setStatus(error?.message ?? '发生未知错误，请稍后再试。', true);
        }
    });
});
