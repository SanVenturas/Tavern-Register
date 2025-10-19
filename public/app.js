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

function clearQueryString() {
    if (!window.location.search) {
        return;
    }

    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url);
}

function deriveDefaultHandle(username, provider, providerId) {
    const normalized = normalizeHandle(username);
    if (normalized) {
        return normalized;
    }

    const fallback = normalizeHandle(`${provider}-${providerId}`);
    if (fallback) {
        return fallback;
    }

    return providerId?.toLowerCase().slice(0, 64) ?? '';
}

document.addEventListener('DOMContentLoaded', () => {
    const formElement = document.getElementById('register-form');
    const loginLinkElement = document.getElementById('login-link');
    const ticketInput = document.getElementById('ticket');
    const cancelButtonElement = document.getElementById('cancel-authorization');

    const form = formElement instanceof HTMLFormElement ? formElement : null;
    const loginLink = loginLinkElement instanceof HTMLAnchorElement ? loginLinkElement : null;
    const ticketField = ticketInput instanceof HTMLInputElement ? ticketInput : null;
    const cancelButton = cancelButtonElement instanceof HTMLButtonElement ? cancelButtonElement : null;

    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get('status');

    if (statusParam === 'bound') {
        const handle = params.get('handle');
        const handleText = handle ? `“${handle}”` : '某个已存在的账户';
        setStatus(`该第三方账号已绑定酒馆账号 ${handleText}，无法重复绑定。`, true);
        setTimeout(() => {
            window.location.replace('/');
        }, 4000);
        return;
    }

    const ticket = params.get('ticket')?.trim();
    if (!ticket) {
        window.location.replace('/?status=invalid-ticket');
        return;
    }

    if (ticketField) {
        ticketField.value = ticket;
    }

    let authorization = null;

    async function loadAuthorization() {
        try {
            const response = await fetch(`/oauth/authorization/${encodeURIComponent(ticket)}`, {
                headers: { accept: 'application/json' },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data?.success || !data.authorization) {
                throw new Error('无法获取授权信息，请重新授权');
            }

            authorization = {
                provider: data.authorization.provider,
                providerId: data.authorization.providerId,
                username: data.authorization.username ?? '',
            };

            clearQueryString();

            if (form) {
                const nameInput = form.querySelector('input[name="name"]');
                const handleInput = form.querySelector('input[name="handle"]');

                const defaultDisplayName = authorization.username || `${authorization.provider} 用户`;
                const defaultHandle = deriveDefaultHandle(
                    authorization.username,
                    authorization.provider,
                    authorization.providerId,
                );

                if (nameInput instanceof HTMLInputElement && !nameInput.value) {
                    nameInput.value = defaultDisplayName.slice(0, 64);
                }

                if (handleInput instanceof HTMLInputElement && !handleInput.value) {
                    handleInput.value = defaultHandle;
                }
            }
        } catch (error) {
            console.error('加载授权信息失败：', error);
            setStatus('授权信息已失效或不可用，请返回授权入口重新操作。', true);
            setTimeout(() => {
                window.location.replace('/?status=invalid-ticket');
            }, 4000);
        }
    }

    loadAuthorization();

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

    if (cancelButton) {
        cancelButton.addEventListener('click', async () => {
            const ticketValue = ticketField?.value || ticket;
            cancelButton.disabled = true;
            cancelButton.classList.add('is-pending');
            cancelButton.textContent = '正在取消授权…';
            setStatus('正在取消当前授权，请稍候…');

            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timeout = controller ? setTimeout(() => controller.abort(), 4000) : null;

            try {
                if (ticketValue) {
                    const fetchOptions = {
                        method: 'POST',
                        headers: {
                            accept: 'application/json',
                            'content-type': 'application/json',
                        },
                        credentials: 'same-origin',
                        body: '{}',
                    };

                    if (controller) {
                        fetchOptions.signal = controller.signal;
                    }

                    const response = await fetch(`/oauth/authorization/${encodeURIComponent(ticketValue)}/cancel`, fetchOptions);
                    if (!response.ok) {
                        console.warn('取消授权请求返回非成功状态：', response.status);
                    }
                }
            } catch (error) {
                console.error('取消授权失败：', error);
            } finally {
                if (timeout) {
                    clearTimeout(timeout);
                }
                window.location.replace('/?status=cancelled');
            }
        });
    }

    if (!form) {
        return;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setStatus('');

        if (!authorization || !ticketField?.value) {
            setStatus('授权信息缺失，请返回授权入口重新操作。', true);
            return;
        }

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
            ticket: ticketField.value,
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
                window.location.replace('/');
            }, 3500);
        } catch (error) {
            const message = error instanceof Error ? error.message : '发生未知错误，请稍后再试。';
            setStatus(message, true);
        }
    });
});
