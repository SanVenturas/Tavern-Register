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
- 用户注册信息会保存在 `data/users.json` 文件中。
- 邀请码信息会保存在 `data/invite-codes.json` 文件中。
- SillyTavern 基础信息通过官方 API 操作，不直接改动酒馆的数据文件。

排错指引
----
- 所有关键错误会输出到启动终端，包括管理员登录失败等，方便定位。
- 常见问题：
   - **403 管理员验证失败**：确认管理员账号/密码无误，`SILLYTAVERN_BASE_URL` 正确且能获取完整的 session cookie（含签名）。
   - **请求 4xx/5xx**：检查 TavernRegister 与 SillyTavern 是否能够相互访问、网络代理是否放行。
