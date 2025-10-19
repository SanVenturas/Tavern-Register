# TavernRegister

简介
----
TavernRegister 是一个独立的注册门户，可在不修改 SillyTavern 核心代码的前提下创建用户账号。服务端会以管理员身份调用 SillyTavern 的内部 API（`/api/users/create`），前端界面与提示均已中文化，同时提供基本的输入校验与日志输出。

工作原理
----
1. 读取 `.env` 中的管理员凭证与 SillyTavern 地址，提前建立管理会话。
2. 注册时将提交的显示名称、用户标识、密码发送到 SillyTavern。
3. 调用 `/api/users/create` 创建账号，并返回登录入口信息。

快速开始
----
1. 进入目录：
   ```powershell
   cd e:\ruanjian\multy\SillyTavern\TavernRegister
   ```
2. 安装依赖：
   ```powershell
   npm install
   ```
3. 初始化环境变量：
   ```powershell
   copy .env.example .env
   ```
   按需填写 SillyTavern 配置（见下）。
4. 启动服务：
   ```powershell
   npm run start
   ```
   开发调试可使用热重载：
   ```powershell
   npm run dev
   ```
5. 浏览器访问：<http://localhost:3070/>（如 `.env` 修改了 `PORT`，请替换端口）。

`.env` 配置说明
----
| 变量 | 说明 |
| --- | --- |
| `SILLYTAVERN_BASE_URL` | SillyTavern 服务完整地址，必须包含协议与端口，例如 `https://example.com:8000` |
| `SILLYTAVERN_ADMIN_HANDLE` | 具备创建用户权限的 SillyTavern 管理员账号 |
| `SILLYTAVERN_ADMIN_PASSWORD` | 上述管理员对应的密码 |
| `PORT` | TavernRegister 对外监听端口，默认 `3070` |

示例 `.env`
----
```env
SILLYTAVERN_BASE_URL=https://your-tavern-domain.com:5000
SILLYTAVERN_ADMIN_HANDLE=admin
SILLYTAVERN_ADMIN_PASSWORD=changeme
PORT=3070

```

重要约束
----
- 密码为必填项，前后端均会验证两次输入一致且不得为空。
- SillyTavern 基础信息通过官方 API 操作，不直接改动酒馆的数据文件。

排错指引
----
- 所有关键错误会输出到启动终端，包括管理员登录失败等，方便定位。
- 常见问题：
   - **403 管理员验证失败**：确认管理员账号/密码无误，`SILLYTAVERN_BASE_URL` 正确且能获取完整的 session cookie（含签名）。
   - **请求 4xx/5xx**：检查 TavernRegister 与 SillyTavern 是否能够相互访问、网络代理是否放行。
- 引入速率限制、验证码或反向代理访问控制，提升注册入口安全性。
- 开发简单的管理界面，支持查看已创建的账号或执行封禁操作。
- 与现有的用户审计/日志系统整合，便于合规追踪。
