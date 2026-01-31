# TavernRegister

简介
----
TavernRegister 是一个极简的独立注册门户，可在不修改 SillyTavern 核心代码的情况下批量创建用户账号。后端会以管理员身份调用 SillyTavern 的内部 API（`/api/users/create`），前端界面与提示为中文，内置基础的输入校验与日志输出，便于在多用户环境下快速开放注册入口。

工作原理
----
1. 读取后台设置中的管理员账号与 SillyTavern 地址，提前建立管理会话，然后通过官方API在远程的SillyTavern中创建用户。
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
cp .env.example .env
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

配置说明
----

项目所有的可配置项均在 `.env` 文件中。首次使用请将根目录下的 `.env.example` 文件复制并重命名为 `.env`，然后根据需要修改配置。

### 基础服务配置

```env
# 服务监听端口
PORT=3070

# 注册页面的外部访问 URL
# 用于 OAuth 回调生成。若不填则默认使用 IP+端口。
# 生产环境强烈建议填写实际域名，例如：https://register.example.com
REGISTER_BASE_URL=https://register.example.com

# Session 加密密钥
# 建议修改为随机的长字符串以提高安全性
SESSION_SECRET=1c3561585f573c24596d81af7dbc1c2a6e085378b9eb4a3fb4bdbd096dacf7b6
```

### 管理员与安全配置（可选）

```env
# 管理员面板登录密码
ADMIN_PANEL_PASSWORD=admin123

# 是否开启邀请码验证 (true/false)
# 开启后用户注册必须提供有效邀请码
REQUIRE_INVITE_CODE=false

# 是否启用邮箱验证 (true/false)
# 开启后用户注册必须验证邮箱，且每个邮箱只能注册一次
REQUIRE_EMAIL_VERIFICATION=false

# 是否启用 IP 注册限制 (true/false)
# 开启后每个 IP 地址只能注册一次，防止批量刷号
ENABLE_IP_LIMIT=false

# 管理员登录页面路径
# 建议修改此路径以防止暴力破解扫描，例如：/my-secret-login
ADMIN_LOGIN_PATH=/admin/login

# 管理员面板路径
ADMIN_PANEL_PATH=/admin

# 管理员登录最大重试次数
MAX_LOGIN_ATTEMPTS=5

# 登录失败后的锁定时间（分钟）
LOGIN_LOCKOUT_TIME=15
```

### 邮箱验证配置（可选）

如需启用邮箱验证功能，需配置 SMTP 邮件服务：

```env
# 启用邮箱验证
REQUIRE_EMAIL_VERIFICATION=true

# SMTP 服务器配置
SMTP_HOST=smtp.example.com      # SMTP 服务器地址
SMTP_PORT=465                   # SMTP 端口（SSL 通常为 465，TLS 为 587）
SMTP_SECURE=true                # 是否使用 SSL（465 端口设为 true，587 端口设为 false）
SMTP_USER=your-email@example.com    # SMTP 登录用户名
SMTP_PASS=your-email-password       # SMTP 登录密码或应用密码
SMTP_FROM=TavernRegister <noreply@example.com>  # 发件人显示名称和地址（可选）

# 网站名称（用于邮件标题和内容）
SITE_NAME=TavernRegister
```

#### 常见邮件服务商配置示例

**QQ 邮箱：**
```env
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-qq@qq.com
SMTP_PASS=your-authorization-code  # 使用授权码，非 QQ 密码
```

**163 邮箱：**
```env
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@163.com
SMTP_PASS=your-authorization-code  # 使用授权码
```

**Gmail：**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # 使用应用专用密码
```

第三方 OAuth 登录配置
----

本项目支持通过 **GitHub / Discord / Linux.do** 进行一键注册，所有第三方登录均基于 OAuth2 标准协议实现。  
如果你不需要第三方登录，可以完全忽略本节内容。

### 1. 基础概念与回调地址

- **REGISTER_BASE_URL**：
  - 该地址用于生成 OAuth 回调地址（`redirect_uri`）。
  - 未配置时，默认值为：`http://localhost:3070`
  - 线上部署时，**强烈建议**设置为你的实际访问域名，例如：
    - `https://register.example.com`
    - `https://your-domain.com/tavern-register`

回调地址的规则如下（请在第三方平台的“回调 URL / Redirect URI”中填写）：

- **GitHub**：`{REGISTER_BASE_URL}/oauth/callback/github`
- **Discord**：`{REGISTER_BASE_URL}/oauth/callback/discord`
- **Linux.do**：`{REGISTER_BASE_URL}/oauth/callback/linuxdo`

例如：如果 `REGISTER_BASE_URL=https://register.example.com`，则：

- GitHub 回调：`https://register.example.com/oauth/callback/github`
- Discord 回调：`https://register.example.com/oauth/callback/discord`
- Linux.do 回调：`https://register.example.com/oauth/callback/linuxdo`

### 2. GitHub OAuth 配置

1. 访问 GitHub 的开发者设置页面，新建 OAuth App：
   - Homepage URL：填写你的 `REGISTER_BASE_URL`
   - Authorization callback URL：填写 `REGISTER_BASE_URL` 对应的 GitHub 回调地址
2. 创建完成后，记录下生成的 `Client ID` 与 `Client Secret`。
3. 在 `.env` 中添加：
   ```env
   # 启用 GitHub OAuth
   ENABLE_GITHUB_OAUTH=true

   # GitHub OAuth 凭据
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret

   # 用于生成回调地址的基础 URL（强烈建议在生产环境手动设置为外网可访问的地址）
   REGISTER_BASE_URL=https://your-register-domain.example.com
   ```
4. 重启 TavernRegister 服务后，前端将显示“GitHub 一键注册”按钮。

### 3. Discord OAuth 配置

1. 前往 Discord Developer Portal，新建应用并添加 OAuth2：
   - 在 “Redirects / 回调 URL” 中添加：`{REGISTER_BASE_URL}/oauth/callback/discord`
   - 在 “Scopes” 中至少勾选：`identify`
2. 获取应用的 `Client ID` 和 `Client Secret`。
3. 在 `.env` 中添加：
   ```env
   # 启用 Discord OAuth
   ENABLE_DISCORD_OAUTH=true

   # Discord OAuth 凭据
   DISCORD_CLIENT_ID=your_discord_client_id
   DISCORD_CLIENT_SECRET=your_discord_client_secret

   # 基础 URL，同上
   REGISTER_BASE_URL=https://your-register-domain.example.com
   ```
4. 重启服务后，前端将显示“Discord 一键注册”按钮。

### 4. Linux.do OAuth 配置

Linux.do 默认使用 `https://connect.linux.do` 作为 OAuth 端点，本项目已内置该地址；也支持手动覆盖为自建或未来可能变更的端点。

1. 在 Linux.do（或对应的 OAuth 提供站点）申请 OAuth 客户端，获取：
   - Client ID
   - Client Secret
2. 在 `.env` 中添加：
   ```env
   # 启用 Linux.do OAuth
   ENABLE_LINUXDO_OAUTH=true

   # Linux.do OAuth 凭据
   LINUXDO_CLIENT_ID=your_linuxdo_client_id
   LINUXDO_CLIENT_SECRET=your_linuxdo_client_secret

   # 默认端点，如果官方有变更或你使用自建网关，可手动覆盖
   # LINUXDO_AUTH_URL=https://connect.linux.do/oauth2/authorize
   # LINUXDO_TOKEN_URL=https://connect.linux.do/oauth2/token
   # LINUXDO_USERINFO_URL=https://connect.linux.do/api/user

   # 基础 URL，同上
   REGISTER_BASE_URL=https://your-register-domain.example.com
   ```
3. 配置完成并重启服务后，前端将显示“Linux.do 一键注册”按钮。

### 5. 常见问题（第三方登录）

- **Q: 前端看不到第三方登录按钮？**  
  - 请确认 `.env` 中已设置对应的 `ENABLE_xxx_OAUTH=true`，并且已重启服务。

- **Q: 点击登录后跳转报错，显示“redirect_uri 不合法 / 未配置”？**  
  - 检查第三方平台中配置的回调地址是否与 `{REGISTER_BASE_URL}/oauth/callback/{provider}` 完全一致（含协议、端口、路径）。

- **Q: 登录成功但创建 Tavern 用户失败？**  
  - 检查后台 SillyTavern 管理员账号配置是否正确（`SILLYTAVERN_ADMIN_HANDLE` / `SILLYTAVERN_ADMIN_PASSWORD` / `SILLYTAVERN_BASE_URL`），并确认接口 `/api/users/create` 可由服务端正常访问。


管理员面板
----
访问管理员面板（默认路径 `/admin`，可在 `.env` 中自定义），功能包括：

- **用户管理**：查看所有注册用户信息，包括用户名、注册方式、IP 地址、注册时间等
- **服务器管理**：查看所有服务器信息，包括服务器名称、服务器地址、服务器状态等
  - 添加服务器
  - 编辑服务器
  - 删除服务器
 
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
- 如果启用了邮箱验证功能（`REQUIRE_EMAIL_VERIFICATION=true`）：
  - 用户注册时需要验证邮箱
  - 每个邮箱只能注册一个账号
  - 邮箱地址会同步上传到 SillyTavern 服务器
  - 验证码有效期为 10 分钟，发送间隔为 60 秒
- 如果启用了 IP 限制功能（`ENABLE_IP_LIMIT=true`）：
  - 每个 IP 地址只能注册一个账号
  - 本地地址（127.0.0.1、::1）不受此限制
- 用户注册信息会保存在 `data/users.json` 文件中。
- 邀请码信息会保存在 `data/invite-codes.json` 文件中。
- SillyTavern 基础信息通过官方 API 操作，不直接改动酒馆的数据文件。

排错指引
----
- 所有关键错误会输出到启动终端，包括管理员登录失败等，方便定位。
- 常见问题：
   - **403 管理员验证失败**：确认管理员账号/密码无误，`SILLYTAVERN_BASE_URL` 正确且能获取完整的 session cookie（含签名）。
   - **请求 4xx/5xx**：检查 TavernRegister 与 SillyTavern 是否能够相互访问、网络代理是否放行。
