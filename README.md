# TavernRegister

简介
----
TavernRegister 是一个极简的独立注册门户，可在不修改 SillyTavern 核心代码的情况下批量创建用户账号。后端会以管理员身份调用 SillyTavern 的内部 API（`/api/users/create`），前端界面与提示为中文，内置基础的输入校验与日志输出，便于在多用户环境下快速开放注册入口。

工作原理
----
1. 读取 `.env` 中的管理员凭证与 SillyTavern 地址，提前建立管理会话。
2. 支持两种注册方式：
   - **手动注册**：填写表单信息完成注册
   - **OAuth 一键注册**：通过 GitHub、Discord 或 Linux.do 账号一键注册
3. 注册时将提交的显示名称、用户标识、密码发送到 SillyTavern。
4. 调用 `/api/users/create` 创建账号，并返回登录入口信息。
5. 使用默认密码（123456）注册的用户会收到提示，要求登录后第一时间修改密码。

快速开始（使用仓库内启动脚本）
----
本项目包含平台对应的启动脚本，优先使用仓库自带脚本来安装依赖并启动服务，脚本已包含常见检查并能简化部署流程。
### 命令行安装
```bash
git clone https://github.com/zhaiiker/Tavern-Register.git
cd Tavern-Register
npm install
npm start
```

### Windows 环境

**方式一：使用批处理文件（推荐）**
```cmd
双击 start.bat 文件
```
或
```cmd
start.bat
```



### Unix / Linux / macOS 环境

```bash
# 赋予执行权限（首次运行时）
chmod +x start.sh
./start.sh
```

启动后，默认监听 `PORT`（默认 3070），浏览器访问：

http://localhost:3070/

有关生产部署（systemd / pm2 / Nginx 反向代理）请参阅上文的“服务器部署”小节，其中包含 systemd 单元示例、pm2 启动方法以及 Nginx 配置片段。

`.env` 配置说明
----
### 必需配置
| 变量 | 说明 |
| --- | --- |
| `SILLYTAVERN_BASE_URL` | SillyTavern 服务完整地址，必须包含协议与端口，例如 `https://example.com:8000` |
| `SILLYTAVERN_ADMIN_HANDLE` | 具备创建用户权限的 SillyTavern 管理员账号 |
| `SILLYTAVERN_ADMIN_PASSWORD` | 上述管理员对应的密码 |
| `PORT` | TavernRegister 对外监听端口，默认 `3070` |

### 管理员面板配置（可选）
| 变量 | 说明 |
| --- | --- |
| `ADMIN_PANEL_PASSWORD` | 管理员面板登录密码，默认 `admin123`，生产环境请务必修改 |
| `REQUIRE_INVITE_CODE` | 是否要求注册时必须使用邀请码，设置为 `true` 启用，`false` 禁用（默认：`false`） |
| `ADMIN_LOGIN_PATH` | 管理员登录页面路径，默认 `/admin/login`，可自定义以避免被扫描（例如：`/my-secret-admin-login`） |
| `ADMIN_PANEL_PATH` | 管理员面板路径，默认 `/admin`，可自定义（例如：`/my-secret-admin`） |
| `MAX_LOGIN_ATTEMPTS` | 最大登录尝试次数，默认 `5` 次，超过后将锁定 |
| `LOGIN_LOCKOUT_TIME` | 登录锁定时间（分钟），默认 `15` 分钟 |

### OAuth 配置（可选）
如需启用 OAuth 一键注册功能，请配置以下环境变量：

| 变量 | 说明 |
| --- | --- |
| `ENABLE_GITHUB_OAUTH` | 是否启用 GitHub OAuth，设置为 `true` 启用，`false` 禁用（默认：`false`） |
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 的 Client Secret |
| `ENABLE_DISCORD_OAUTH` | 是否启用 Discord OAuth，设置为 `true` 启用，`false` 禁用（默认：`false`） |
| `DISCORD_CLIENT_ID` | Discord OAuth App 的 Client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth App 的 Client Secret |
| `ENABLE_LINUXDO_OAUTH` | 是否启用 Linux.do OAuth，设置为 `true` 启用，`false` 禁用（默认：`false`） |
| `LINUXDO_CLIENT_ID` | Linux.do OAuth App 的 Client ID |
| `LINUXDO_CLIENT_SECRET` | Linux.do OAuth App 的 Client Secret |
| `LINUXDO_AUTH_URL` | Linux.do OAuth 授权端点（可选），默认：`https://connect.linux.do/oauth2/authorize` |
| `LINUXDO_TOKEN_URL` | Linux.do OAuth 令牌端点（可选），默认：`https://connect.linux.do/oauth2/token` |
| `LINUXDO_USERINFO_URL` | Linux.do 用户信息端点（可选），默认：`https://connect.linux.do/api/user` |
| `REGISTER_BASE_URL` | 注册服务的完整地址（用于 OAuth 回调），例如 `http://127.0.0.1:3070`。如果不设置，将根据实际请求的 Host 自动生成 |
| `SESSION_SECRET` | 会话密钥（用于 OAuth state 验证），生产环境请务必修改 |`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**注意**：只有同时满足以下条件，对应的 OAuth 按钮才会在注册页面显示：
1. 对应的 `ENABLE_*_OAUTH` 设置为 `true`
2. 对应的 `CLIENT_ID` 和 `CLIENT_SECRET` 都已配置

### 示例 `.env`
```env
# 必需配置
SILLYTAVERN_BASE_URL=https://your-tavern-domain.com:5000
SILLYTAVERN_ADMIN_HANDLE=admin
SILLYTAVERN_ADMIN_PASSWORD=changeme
PORT=3070

# 管理员面板配置（可选）
ADMIN_PANEL_PASSWORD=admin123           # 后台登录密码
REQUIRE_INVITE_CODE=false               # 是否启用邀请码功能，设置为 true 启用，false 禁用

# OAuth 配置（可选）
# 启用 GitHub OAuth（设置为 true 启用）
ENABLE_GITHUB_OAUTH=false               # 设置为 true 启用，false 禁用
GITHUB_CLIENT_ID=your_github_client_id # GitHub OAuth App 的 Client ID
GITHUB_CLIENT_SECRET=your_github_client_secret # GitHub OAuth App 的 Client Secret

# 启用 Discord OAuth（设置为 true 启用）
ENABLE_DISCORD_OAUTH=false               # 设置为 true 启用，false 禁用
DISCORD_CLIENT_ID=your_discord_client_id # Discord OAuth App 的 Client ID
DISCORD_CLIENT_SECRET=your_discord_client_secret # Discord OAuth App 的 Client Secret

# 启用 Linux.do OAuth（设置为 true 启用）
ENABLE_LINUXDO_OAUTH=false               # 设置为 true 启用，false 禁用
LINUXDO_CLIENT_ID=your_linuxdo_client_id # Linux.do OAuth App 的 Client ID
LINUXDO_CLIENT_SECRET=your_linuxdo_client_secret # Linux.do OAuth App 的 Client Secret

# 生产环境配置
REGISTER_BASE_URL=https://register.example.com # 注册服务的完整地址（用于 OAuth 回调），例如 `http://127.0.0.1:3070`。如果不设置，将根据实际请求的 Host 自动生成
SESSION_SECRET=your-random-secret-key-change-this-in-production # 会话密钥（用于 OAuth state 验证），生产环境请务必修改
```

### OAuth 应用配置指南

#### GitHub OAuth App
1. 访问 https://github.com/settings/developers
2. 点击 "New OAuth App"
3. 填写应用信息：
   - **Application name**: TavernRegister
   - **Homepage URL**: 你的注册服务地址
   - **Authorization callback URL**: `https://your-register-domain.com/oauth/callback/github`
4. 创建后复制 Client ID 和 Client Secret

#### Discord OAuth App
1. 访问 https://discord.com/developers/applications
2. 点击 "New Application"
3. 在 "OAuth2" 页面：
   - 添加 Redirect URL: `https://your-register-domain.com/oauth/callback/discord`
   - 复制 Client ID 和 Client Secret

#### Linux.do OAuth App
1. 访问 Linux.do 开发者设置页面（https://connect.linux.do）
2. 创建新的 OAuth 应用
3. 设置回调 URL: `http://your-ip:3070/oauth/callback/linuxdo`（如 `http://198.181.56.231:3070/oauth/callback/linuxdo`）
4. 复制 Client ID 和 Client Secret
5. **注意**：Linux.do 使用 `connect.linux.do` 作为 OAuth 端点域名

管理员面板
----
访问管理员面板（默认路径 `/admin`，可在 `.env` 中自定义），功能包括：

- **用户管理**：查看所有注册用户信息，包括用户名、注册方式、IP 地址、注册时间等
- **邀请码管理**：
  - 创建邀请码（可设置数量、最大使用次数、过期时间）
  - 查看邀请码状态（可用/已禁用/已过期/已用完）
  - 启用/禁用邀请码
  - 删除邀请码
- **统计信息**：查看总用户数、邀请码统计等

### 启用邀请码功能

1. 在 `.env` 文件中设置 `REQUIRE_INVITE_CODE=true`
2. 访问管理员面板（默认路径 `/admin`，默认密码：`admin123`）
3. 在"邀请码管理"标签页创建邀请码
4. 将邀请码分发给需要注册的用户
5. 用户在注册时需要输入有效的邀请码才能完成注册

### 安全建议

**防止管理员入口被扫描和暴力破解：**

1. **自定义管理员路径**（推荐）：
   ```env
   ADMIN_LOGIN_PATH=/your-secret-admin-login-path
   ADMIN_PANEL_PATH=/your-secret-admin-panel-path
   ```
   使用不常见的路径可以避免被自动扫描工具发现。

2. **设置强密码**：
   ```env
   ADMIN_PANEL_PASSWORD=your-very-strong-password-here
   ```
   使用包含大小写字母、数字和特殊字符的强密码。

3. **调整登录限制**：
   ```env
   MAX_LOGIN_ATTEMPTS=3        # 减少最大尝试次数
   LOGIN_LOCKOUT_TIME=30       # 增加锁定时间（分钟）
   ```
   系统会自动限制登录尝试次数，超过限制后锁定 IP 地址。

4. **使用 HTTPS**：在生产环境中使用 HTTPS 加密传输，保护密码安全。

重要约束
----
- 密码可以为空，留空时将使用默认密码 `123456`。
- 使用默认密码注册的用户会收到提示，要求登录后第一时间修改密码。
- OAuth 一键注册的用户将自动使用默认密码 `123456`。
- 如果启用了邀请码功能（`REQUIRE_INVITE_CODE=true`），所有注册方式都需要有效的邀请码。
- 用户注册信息会保存在 `data/users.json` 文件中。
- 邀请码信息会保存在 `data/invite-codes.json` 文件中。
- SillyTavern 基础信息通过官方 API 操作，不直接改动酒馆的数据文件。

排错指引
----
- 所有关键错误会输出到启动终端，包括管理员登录失败等，方便定位。
- 常见问题：
   - **403 管理员验证失败**：确认管理员账号/密码无误，`SILLYTAVERN_BASE_URL` 正确且能获取完整的 session cookie（含签名）。
   - **请求 4xx/5xx**：检查 TavernRegister 与 SillyTavern 是否能够相互访问、网络代理是否放行。
