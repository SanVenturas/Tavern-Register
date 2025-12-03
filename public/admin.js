function setStatus(message = '', isError = false) {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.classList.toggle('status-error', isError && message);
    statusElement.classList.toggle('status-success', !isError && message);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN');
}

function formatIP(ip) {
    return ip || '-';
}

function formatRegistrationMethod(method) {
    const methodMap = {
        'manual': { text: '手动注册', class: 'badge-manual' },
        'oauth:github': { text: 'GitHub注册', class: 'badge-github' },
        'oauth:linuxdo': { text: 'Linux.do注册', class: 'badge-linuxdo' },
        'oauth:discord': { text: 'Discord注册', class: 'badge-discord' },
    };
    
    // 如果没有提供方法，默认为手动注册
    if (!method) {
        return methodMap['manual'];
    }
    
    // 处理 oauth:provider 格式
    if (method.startsWith('oauth:')) {
        if (methodMap[method]) {
            return methodMap[method];
        }
        // 如果是不认识的provider，返回通用格式
        const provider = method.split(':')[1];
        return { text: `${provider}注册`, class: 'badge-oauth' };
    }
    
    // 返回匹配的映射或默认值
    return methodMap[method] || { text: method, class: 'badge-default' };
}

document.addEventListener('DOMContentLoaded', () => {
    // 标签页切换
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`${targetTab}-tab`).classList.add('active');
            
            if (targetTab === 'users') {
                loadUsers();
            } else if (targetTab === 'invites') {
                loadInviteCodes();
            } else if (targetTab === 'servers') {
                loadServers();
            }
        });
    });

    // 登出
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/admin/logout', {
                    method: 'POST',
                    headers: { accept: 'application/json' },
                });
                
                if (response.ok) {
                    window.location.href = '/admin/login';
                }
            } catch (error) {
                console.error('登出失败:', error);
            }
        });
    }

    // 创建邀请码表单
    const createInviteForm = document.getElementById('create-invite-form');
    if (createInviteForm) {
        createInviteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            setStatus('');

            const formData = new FormData(createInviteForm);
            const data = {
                count: parseInt(formData.get('count')),
                maxUses: parseInt(formData.get('maxUses')),
                expiresAt: formData.get('expiresAt') || null,
            };

            try {
                const response = await fetch('/api/admin/invite-codes', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json',
                    },
                    body: JSON.stringify(data),
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    setStatus(result.message || '创建失败', true);
                    return;
                }

                setStatus(`成功创建 ${result.codes.length} 个邀请码`, false);
                
                // 显示创建的邀请码和下载按钮
                const createdCodesDiv = document.getElementById('created-codes');
                if (createdCodesDiv && result.codes.length > 0) {
                    const codes = result.codes.map(c => c.code);
                    const codesHtml = codes.map(code => 
                        `<div class="code-display">${code}</div>`
                    ).join('');
                    // 将邀请码数组存储到 data 属性中，避免 XSS 问题
                    const codesJson = JSON.stringify(codes).replace(/"/g, '&quot;');
                    const downloadBtn = `<button class="primary" style="margin-top: 1rem;" data-codes='${codesJson}' onclick="downloadInviteCodesFromButton(this)">下载为 TXT 文件</button>`;
                    createdCodesDiv.innerHTML = '<strong>创建的邀请码：</strong>' + codesHtml + downloadBtn;
                }

                createInviteForm.reset();
                // 创建后回到第一页
                window.invitesPagination.page = 1;
                const limitSelect = document.getElementById('invites-limit');
                if (limitSelect) limitSelect.value = '20';
                window.invitesPagination.limit = 20;
                loadInviteCodes();
            } catch (error) {
                setStatus('创建失败，请稍后再试', true);
            }
        });
    }

    // 分页状态
    window.usersPagination = {
        page: 1,
        limit: 20,
    };
    window.invitesPagination = {
        page: 1,
        limit: 20,
    };

    // 优化日期时间输入框的点击体验
    const expiresAtInput = document.getElementById('expiresAt-input');
    if (expiresAtInput) {
        // 点击输入框任意位置都打开日期选择器
        expiresAtInput.addEventListener('click', function(e) {
            e.stopPropagation();
            // 使用 showPicker API（现代浏览器支持）
            if (this.showPicker && typeof this.showPicker === 'function') {
                try {
                    this.showPicker();
                } catch (err) {
                    // 如果不支持或失败，则聚焦输入框（聚焦通常会打开日期选择器）
                    this.focus();
                }
            } else {
                // 对于不支持 showPicker 的浏览器，聚焦输入框
                this.focus();
            }
        });
        
        // 聚焦时也尝试打开日期选择器
        expiresAtInput.addEventListener('focus', function() {
            // 使用 showPicker API（现代浏览器支持）
            if (this.showPicker && typeof this.showPicker === 'function') {
                try {
                    // 延迟一点，确保焦点已经设置
                    setTimeout(() => {
                        this.showPicker();
                    }, 10);
                } catch (err) {
                    // 忽略错误
                }
            }
        });
        
        // 确保输入框可以接收所有点击事件
        expiresAtInput.addEventListener('mousedown', function(e) {
            e.stopPropagation();
        });
    }

    // 添加服务器表单
    const addServerForm = document.getElementById('add-server-form');
    const testConnectionBtn = document.getElementById('test-connection-btn');

    if (addServerForm) {
        addServerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            setStatus('');

            const formData = new FormData(addServerForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/api/admin/servers', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json',
                    },
                    body: JSON.stringify(data),
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    setStatus(result.message || '添加失败', true);
                    return;
                }

                setStatus('服务器添加成功', false);
                addServerForm.reset();
                loadServers();
                loadStats();
            } catch (error) {
                setStatus('添加失败，请稍后再试', true);
            }
        });
    }

    if (testConnectionBtn && addServerForm) {
        testConnectionBtn.addEventListener('click', async () => {
            const formData = new FormData(addServerForm);
            const data = Object.fromEntries(formData.entries());
            
            if (!data.url || !data.admin_username || !data.admin_password) {
                setStatus('请填写完整的连接信息', true);
                return;
            }

            setStatus('正在测试连接...', false);
            try {
                const response = await fetch('/api/admin/servers/test', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json',
                    },
                    body: JSON.stringify(data),
                });
                
                const result = await response.json();
                if (result.success) {
                    setStatus('连接测试成功！', false);
                } else {
                    setStatus(`连接失败: ${result.message}`, true);
                }
            } catch (error) {
                setStatus(`连接测试出错: ${error.message}`, true);
            }
        });
    }

    // 加载数据
    loadStats();
    loadUsers();
    loadInviteCodes();

    // Initialization for edit features
    const editServerForm = document.getElementById('edit-server-form');
    if (editServerForm) {
        editServerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            setStatus('');

            const formData = new FormData(editServerForm);
            const data = Object.fromEntries(formData.entries());
            const id = data.id;

            // 如果密码为空，则从提交数据中移除，避免被置空
            if (!data.admin_password) {
                delete data.admin_password;
            }

            try {
                const response = await fetch(`/api/admin/servers/${id}`, {
                    method: 'PUT',
                    headers: {
                        'content-type': 'application/json',
                        accept: 'application/json',
                    },
                    body: JSON.stringify(data),
                });

                const result = await response.json();

                if (!response.ok || !result.success) {
                    setStatus(result.message || '更新失败', true);
                    return;
                }

                setStatus('服务器更新成功', false);
                closeEditModal();
                loadServers();
            } catch (error) {
                setStatus('更新失败，请稍后再试', true);
            }
        });
    }

    // 点击模态框外部关闭
    const editServerModal = document.getElementById('edit-server-modal');
    if (editServerModal) {
        editServerModal.addEventListener('click', (e) => {
            if (e.target === editServerModal) {
                closeEditModal();
            }
        });
    }
});

async function loadServers() {
    try {
        const response = await fetch('/api/admin/servers', {
            headers: { accept: 'application/json' },
        });

        if (!response.ok) return;

        const result = await response.json();
        if (!result.success) return;

        // 保存服务器列表到全局变量，供编辑功能使用
        window.currentServers = result.servers;

        const tbody = document.getElementById('servers-tbody');
        if (!tbody) return;

        if (result.servers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">暂无服务器</td></tr>';
            return;
        }

        tbody.innerHTML = result.servers.map(server => `
            <tr>
                <td>${server.id}</td>
                <td>${server.name}</td>
                <td>${server.url}</td>
                <td>${server.description || '-'}</td>
                <td>${server.provider || '-'}</td>
                <td>${server.maintainer || '-'}</td>
                <td>${typeof server.registeredUserCount === 'number' ? server.registeredUserCount : '-'}</td>
                <td>
                    <span class="badge ${server.isActive ? 'badge-success' : 'badge-error'}">
                        ${server.isActive ? '在线' : '禁用'}
                    </span>
                </td>
                <td>${formatDate(server.createdAt)}</td>
                <td>
                    <button class="action-btn btn-success" onclick="editServer(${server.id})" style="margin-right: 0.5rem; background: rgba(59, 130, 246, 0.2); color: #3b82f6; border-color: #3b82f6;">编辑</button>
                    ${server.isActive ? 
                        `<button class="action-btn btn-danger" onclick="toggleServer(${server.id}, false)">禁用</button>` :
                        `<button class="action-btn btn-success" onclick="toggleServer(${server.id}, true)">启用</button>`
                    }
                    <button class="action-btn btn-danger" onclick="deleteServer(${server.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载服务器列表失败:', error);
    }
}

async function toggleServer(id, isActive) {
    if (!confirm(`确定要${isActive ? '启用' : '禁用'}该服务器吗？`)) return;

    try {
        const response = await fetch(`/api/admin/servers/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        
        if (response.ok) {
            loadServers();
            loadStats();
        } else {
            const data = await response.json();
            setStatus(data.message || '操作失败', true);
        }
    } catch (error) {
        setStatus('操作失败', true);
    }
}

async function deleteServer(id) {
    if (!confirm('确定要删除该服务器吗？此操作不可恢复！')) return;

    try {
        const response = await fetch(`/api/admin/servers/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            loadServers();
            loadStats();
            setStatus('服务器已删除', false);
        } else {
            setStatus('删除失败', true);
        }
    } catch (error) {
        setStatus('删除失败', true);
    }
}


async function loadStats() {
    try {
        const response = await fetch('/api/admin/stats', {
            headers: { accept: 'application/json' },
        });

        if (!response.ok) return;

        const result = await response.json();
        if (!result.success) return;

        const stats = result.stats;
        const statsGrid = document.getElementById('stats-grid');
        if (!statsGrid) return;

        statsGrid.innerHTML = `
            <div class="stat-card">
                <h3>总用户数</h3>
                <div class="value">${stats.totalUsers}</div>
            </div>
            <div class="stat-card">
                <h3>服务器</h3>
                <div class="value">${stats.activeServers}/${stats.totalServers}</div>
            </div>
            <div class="stat-card">
                <h3>总邀请码</h3>
                <div class="value">${stats.totalInviteCodes}</div>
            </div>
            <div class="stat-card">
                <h3>可用邀请码</h3>
                <div class="value">${stats.activeInviteCodes}</div>
            </div>
            <div class="stat-card">
                <h3>已使用邀请码</h3>
                <div class="value">${stats.usedInviteCodes}</div>
            </div>
        `;
    } catch (error) {
        console.error('加载统计信息失败:', error);
    }
}

async function loadUsers() {
    try {
        const { page, limit } = window.usersPagination;
        const response = await fetch(`/api/admin/users?page=${page}&limit=${limit}`, {
            headers: { accept: 'application/json' },
        });

        if (!response.ok) return;

        const result = await response.json();
        if (!result.success) return;

        const tbody = document.getElementById('users-tbody');
        if (!tbody) return;

        if (result.users.length === 0) {
            // 如果当前页没有数据，且不是第一页，跳转到上一页
            if (result.pagination.page > 1 && result.pagination.total > 0) {
                window.usersPagination.page = result.pagination.page - 1;
                loadUsers();
                return;
            }
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">暂无用户</td></tr>';
            renderUsersPagination(result.pagination);
            return;
        }

        tbody.innerHTML = result.users.map(user => {
            const methodInfo = formatRegistrationMethod(user.registrationMethod);
            return `
            <tr>
                <td>${user.id || '-'}</td>
                <td>${user.handle}</td>
                <td>${user.name || '-'}</td>
                <td><span class="badge ${methodInfo.class}">${methodInfo.text}</span></td>
                <td>${user.inviteCode || '-'}</td>
                <td>${formatIP(user.ip)}</td>
                <td>${formatDate(user.registeredAt)}</td>
            </tr>
        `;
        }).join('');
        
        renderUsersPagination(result.pagination);
    } catch (error) {
        console.error('加载用户列表失败:', error);
    }
}

function renderUsersPagination(pagination) {
    const { page, limit, total, totalPages } = pagination;
    const paginationDiv = document.getElementById('users-pagination');
    const infoDiv = document.getElementById('users-pagination-info');
    
    if (!paginationDiv || !infoDiv) return;
    
    // 更新信息
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    infoDiv.textContent = `显示 ${start}-${end} 条，共 ${total} 条`;
    
    // 渲染分页按钮
    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // 上一页
    html += `<button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="changeUsersPage(${page - 1})">上一页</button>`;
    
    // 页码按钮
    const maxButtons = 7;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="pagination-btn" onclick="changeUsersPage(1)">1</button>`;
        if (startPage > 2) {
            html += `<span style="padding: 0 0.5rem;">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="changeUsersPage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span style="padding: 0 0.5rem;">...</span>`;
        }
        html += `<button class="pagination-btn" onclick="changeUsersPage(${totalPages})">${totalPages}</button>`;
    }
    
    // 下一页
    html += `<button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="changeUsersPage(${page + 1})">下一页</button>`;
    
    paginationDiv.innerHTML = html;
}

function changeUsersPage(newPage) {
    const limitSelect = document.getElementById('users-limit');
    const limit = limitSelect ? parseInt(limitSelect.value, 10) : 20;
    window.usersPagination = { page: newPage, limit };
    loadUsers();
}

async function loadInviteCodes() {
    try {
        // 确保分页状态已初始化
        if (!window.invitesPagination) {
            window.invitesPagination = { page: 1, limit: 20 };
        }
        
        const { page, limit } = window.invitesPagination;
        const response = await fetch(`/api/admin/invite-codes?page=${page}&limit=${limit}`, {
            headers: { accept: 'application/json' },
        });

        if (!response.ok) {
            console.error('加载邀请码失败:', response.status, response.statusText);
            return;
        }

        const result = await response.json();
        if (!result.success) {
            console.error('加载邀请码失败:', result.message);
            return;
        }

        // 检查分页信息是否存在
        if (!result.pagination) {
            console.error('分页信息缺失');
            return;
        }

        const tbody = document.getElementById('invites-tbody');
        if (!tbody) {
            console.error('找不到 invites-tbody 元素');
            return;
        }

        // 更新删除按钮的显示状态
        const deleteAllBtn = document.getElementById('delete-all-btn');
        const deleteUsedBtn = document.getElementById('delete-used-btn');
        if (deleteAllBtn) {
            deleteAllBtn.style.display = result.pagination.total > 0 ? 'inline-block' : 'none';
        }
        // 检查是否有已使用的邀请码
        const hasUsedCodes = result.codes.some(code => code.usedCount > 0);
        if (deleteUsedBtn) {
            deleteUsedBtn.style.display = hasUsedCodes ? 'inline-block' : 'none';
        }

        if (result.codes.length === 0) {
            // 如果当前页没有数据，且不是第一页，跳转到上一页
            if (result.pagination.page > 1 && result.pagination.total > 0) {
                window.invitesPagination.page = result.pagination.page - 1;
                loadInviteCodes();
                return;
            }
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">暂无邀请码</td></tr>';
            if (deleteAllBtn) deleteAllBtn.style.display = 'none';
            const deleteUsedBtn = document.getElementById('delete-used-btn');
            if (deleteUsedBtn) deleteUsedBtn.style.display = 'none';
            renderInvitesPagination(result.pagination);
            return;
        }

        // 转义 HTML 特殊字符
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };
        
        const tbodyHtml = result.codes.map(code => {
            const isExpired = code.expiresAt && new Date(code.expiresAt) < new Date();
            const isUsedUp = code.usedCount >= code.maxUses;
            const isPartiallyUsed = code.usedCount > 0 && code.usedCount < code.maxUses;
            
            let statusClass, statusText;
            if (!code.isActive) {
                statusClass = 'badge-error';
                statusText = '已禁用';
            } else if (isExpired) {
                statusClass = 'badge-warning';
                statusText = '已过期';
            } else if (isUsedUp) {
                statusClass = 'badge-warning';
                statusText = '已用完';
            } else if (isPartiallyUsed) {
                statusClass = 'badge-warning';
                statusText = '已使用';
            } else {
                statusClass = 'badge-success';
                statusText = '可用';
            }
            
            // 安全地转义邀请码
            const safeCode = escapeHtml(code.code);
            const safeCodeAttr = code.code.replace(/'/g, "&#39;").replace(/"/g, "&quot;");

            return `
                <tr>
                    <td>
                        <input type="checkbox" class="code-checkbox" value="${safeCodeAttr}" onchange="updateDeleteAllButton()">
                    </td>
                    <td><strong>${safeCode}</strong></td>
                    <td><span class="badge ${statusClass}">${statusText}</span></td>
                    <td>${code.usedCount || 0}</td>
                    <td>${code.maxUses || 1}</td>
                    <td>${formatDate(code.expiresAt)}</td>
                    <td>${formatDate(code.createdAt)}</td>
                    <td>
                        ${code.isActive ? 
                            `<button class="action-btn btn-danger" onclick="toggleInviteCode('${safeCodeAttr}', false)">禁用</button>` :
                            `<button class="action-btn btn-success" onclick="toggleInviteCode('${safeCodeAttr}', true)">启用</button>`
                        }
                        <button class="action-btn btn-danger" onclick="deleteInviteCode('${safeCodeAttr}')">删除</button>
                    </td>
                </tr>
            `;
        }).join('');
        tbody.innerHTML = tbodyHtml;
        
        // 初始化删除按钮状态
        updateDeleteAllButton();
        renderInvitesPagination(result.pagination);
        
        console.log(`已加载 ${result.codes.length} 个邀请码，当前页：${result.pagination.page}/${result.pagination.totalPages}`);
    } catch (error) {
        console.error('加载邀请码列表失败:', error);
    }
}

function renderInvitesPagination(pagination) {
    const { page, limit, total, totalPages } = pagination;
    const paginationDiv = document.getElementById('invites-pagination');
    const infoDiv = document.getElementById('invites-pagination-info');
    
    if (!paginationDiv || !infoDiv) return;
    
    // 更新信息
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    infoDiv.textContent = `显示 ${start}-${end} 条，共 ${total} 条`;
    
    // 渲染分页按钮
    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // 上一页
    html += `<button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="changeInvitesPage(${page - 1})">上一页</button>`;
    
    // 页码按钮
    const maxButtons = 7;
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="pagination-btn" onclick="changeInvitesPage(1)">1</button>`;
        if (startPage > 2) {
            html += `<span style="padding: 0 0.5rem;">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="changeInvitesPage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span style="padding: 0 0.5rem;">...</span>`;
        }
        html += `<button class="pagination-btn" onclick="changeInvitesPage(${totalPages})">${totalPages}</button>`;
    }
    
    // 下一页
    html += `<button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="changeInvitesPage(${page + 1})">下一页</button>`;
    
    paginationDiv.innerHTML = html;
}

function changeInvitesPage(newPage) {
    const limitSelect = document.getElementById('invites-limit');
    const limit = limitSelect ? parseInt(limitSelect.value, 10) : 20;
    window.invitesPagination = { page: newPage, limit };
    loadInviteCodes();
}

async function toggleInviteCode(code, isActive) {
    if (!confirm(`确定要${isActive ? '启用' : '禁用'}邀请码 ${code} 吗？`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/invite-codes/${code}`, {
            method: 'PATCH',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify({ isActive }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setStatus(result.message || '操作失败', true);
            return;
        }

        setStatus(`邀请码已${isActive ? '启用' : '禁用'}`, false);
        loadInviteCodes();
        loadStats();
    } catch (error) {
        setStatus('操作失败，请稍后再试', true);
    }
}

async function deleteInviteCode(code) {
    if (!confirm(`确定要删除邀请码 ${code} 吗？此操作不可恢复！`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/invite-codes/${encodeURIComponent(code)}`, {
            method: 'DELETE',
            headers: { accept: 'application/json' },
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            setStatus(result.message || '删除失败', true);
            return;
        }

        setStatus('邀请码已删除', false);
        loadInviteCodes();
        loadStats();
    } catch (error) {
        setStatus('删除失败，请稍后再试', true);
    }
}

// 从按钮的 data 属性获取邀请码并下载
function downloadInviteCodesFromButton(button) {
    const codesJson = button.getAttribute('data-codes');
    if (!codesJson) {
        setStatus('无法获取邀请码', true);
        return;
    }
    try {
        const codes = JSON.parse(codesJson.replace(/&quot;/g, '"'));
        downloadInviteCodes(codes);
    } catch (error) {
        setStatus('解析邀请码失败', true);
    }
}

// 下载邀请码为 TXT 文件
function downloadInviteCodes(codes) {
    if (!codes || codes.length === 0) {
        setStatus('没有可下载的邀请码', true);
        return;
    }

    const content = codes.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `invite-codes-${dateStr}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setStatus(`已下载 ${codes.length} 个邀请码`, false);
}

// 全选/取消全选邀请码
function toggleSelectAllCodes() {
    const selectAll = document.getElementById('select-all-codes') || document.getElementById('select-all-header');
    const checkboxes = document.querySelectorAll('.code-checkbox');
    const checked = selectAll ? selectAll.checked : false;
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = checked;
    });
    
    // 同步两个全选复选框
    const selectAllHeader = document.getElementById('select-all-header');
    const selectAllCodes = document.getElementById('select-all-codes');
    if (selectAllHeader) selectAllHeader.checked = checked;
    if (selectAllCodes) selectAllCodes.checked = checked;
    
    updateDeleteAllButton();
}

// 更新删除所有按钮的显示
function updateDeleteAllButton() {
    const checkboxes = document.querySelectorAll('.code-checkbox:checked');
    const deleteAllBtn = document.getElementById('delete-all-btn');
    if (deleteAllBtn) {
        if (checkboxes.length > 0) {
            deleteAllBtn.textContent = `删除选中的 ${checkboxes.length} 个邀请码`;
            deleteAllBtn.style.display = 'inline-block';
        } else {
            deleteAllBtn.textContent = '一键删除所有邀请码';
            deleteAllBtn.style.display = 'inline-block';
        }
    }
}

// 删除所有邀请码或选中的邀请码
async function deleteAllInviteCodes() {
    const checkboxes = document.querySelectorAll('.code-checkbox:checked');
    let codesToDelete = Array.from(checkboxes).map(cb => cb.value);
    
    if (codesToDelete.length === 0) {
        // 如果没有选中的，删除所有
        if (!confirm('确定要删除所有邀请码吗？此操作不可恢复！')) {
            return;
        }
        
        try {
            const response = await fetch('/api/admin/invite-codes?page=1&limit=9999', {
                headers: { accept: 'application/json' },
            });
            const result = await response.json();
            if (result.success && result.codes) {
                codesToDelete = result.codes.map(c => c.code);
            }
        } catch (error) {
            setStatus('获取邀请码列表失败', true);
            return;
        }
    } else {
        if (!confirm(`确定要删除选中的 ${codesToDelete.length} 个邀请码吗？此操作不可恢复！`)) {
            return;
        }
    }
    
    if (codesToDelete.length === 0) {
        setStatus('没有可删除的邀请码', true);
        return;
    }
    
    await deleteCodesWithProgress(codesToDelete);
}

// 删除所有已使用的邀请码
async function deleteUsedInviteCodes() {
    if (!confirm('确定要删除所有已使用的邀请码吗？此操作不可恢复！')) {
        return;
    }
    
    try {
        const response = await fetch('/api/admin/invite-codes?page=1&limit=9999', {
            headers: { accept: 'application/json' },
        });
        const result = await response.json();
        if (!result.success || !result.codes) {
            setStatus('获取邀请码列表失败', true);
            return;
        }
        
        const usedCodes = result.codes.filter(c => c.usedCount > 0).map(c => c.code);
        
        if (usedCodes.length === 0) {
            setStatus('没有已使用的邀请码', true);
            return;
        }
        
        await deleteCodesWithProgress(usedCodes);
    } catch (error) {
        setStatus('获取邀请码列表失败', true);
    }
}

// 批量删除邀请码并显示进度
async function deleteCodesWithProgress(codesToDelete) {
    setStatus(`正在删除 ${codesToDelete.length} 个邀请码...`, false);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const code of codesToDelete) {
        try {
            const response = await fetch(`/api/admin/invite-codes/${encodeURIComponent(code)}`, {
                method: 'DELETE',
                headers: { accept: 'application/json' },
            });
            const result = await response.json();
            if (response.ok && result.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
        }
    }
    
    if (failCount === 0) {
        setStatus(`成功删除 ${successCount} 个邀请码`, false);
    } else {
        setStatus(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`, true);
    }
    
    // 取消全选
    const selectAll = document.getElementById('select-all-codes');
    const selectAllHeader = document.getElementById('select-all-header');
    if (selectAll) selectAll.checked = false;
    if (selectAllHeader) selectAllHeader.checked = false;
    
    // 重新加载数据，如果当前页没有数据了，会自动调整到合适的页码
    loadInviteCodes();
    loadStats();
}

// 编辑服务器
function editServer(id) {
    // 兼容后端可能返回字符串或数字类型的 id
    const server = window.currentServers && window.currentServers.find(s => Number(s.id) === Number(id));
    if (!server) return;

    const form = document.getElementById('edit-server-form');
    if (!form) return;

    // 填充表单
    form.elements['id'].value = server.id;
    form.elements['name'].value = server.name;
    form.elements['url'].value = server.url;
    form.elements['admin_username'].value = server.admin_username;
    form.elements['admin_password'].value = ''; // 不显示密码，只有在修改时才填写
    form.elements['description'].value = server.description || '';
    form.elements['provider'].value = server.provider || '';
    form.elements['maintainer'].value = server.maintainer || '';
    form.elements['contact'].value = server.contact || '';
    form.elements['announcement'].value = server.announcement || '';

    // 显示模态框
    const modal = document.getElementById('edit-server-modal');
    if (modal) modal.classList.add('active');
}

function closeEditModal() {
    const modal = document.getElementById('edit-server-modal');
    if (modal) modal.classList.remove('active');
}