# TavernRegister
简介
----
TavernRegister 是一个独立的注册门户，用于在不修改 SillyTavern 核心代码的前提下为其创建用户账号。该服务通过模拟管理员登录并调用 SillyTavern 的内部 API（/api/users/create）来完成注册流程。界面已本地化为中文，前后端进行了必要的输入校验与日志输出。

工作原理（简要）
----
1. 向 SillyTavern 获取 CSRF token（如果启用，~最好是关掉~）。
2. 使用 .env 中配置的管理员账号登录 SillyTavern，获取会话 cookie。
3. 验证管理员会话（/api/users/me）。
4. 使用管理员会话与 token 调用 /api/users/create 创建新用户。

快速开始
----
1. 进入项目目录：
   cd \TavernRegister
2. 安装依赖：
   npm install
3. 复制并编辑环境变量示例：
   cp .env.example .env
   编辑 .env 中的 SILLYTAVERN_BASE_URL、ADMIN_USER、ADMIN_PASS（示例见下）。
4. 启动服务：
   npm run start
   开发时可用自动重载：
   npm run dev
5. 在浏览器打开：
   http://localhost:3070/ （如 PORT 已修改则相应端口）

示例 .env（必须是完整 URL，含协议）
----
SILLYTAVERN_BASE_URL=https://your-tavern-domain.com:5000
ADMIN_USER=admin
ADMIN_PASS=changeme
PORT=3070

重要行为与约束
----
- 密码为必填项，前端/后端均强制校验非空且需确认密码一致。
- 不会直接修改 SillyTavern 代码或数据文件；所有操作通过官方 API 执行。
- 支持完整 URL（含协议与端口）作为 SILLYTAVERN_BASE_URL。

日志与排错
----
- 所有关键错误会输出到控制台，包含 HTTP 状态与堆栈信息，便于排查管理员登录、cookie/签名或 CSRF 问题。
- 常见问题：
  - 403 管理员验证失败：检查 ADMIN_USER/ADMIN_PASS 与 SILLYTAVERN_BASE_URL 是否正确，及 SillyTavern 是否能下发完整 session cookie（包含签名）。
  - CSRF 相关：若 SillyTavern 关闭 CSRF，系统仍会尝试使用会话 cookie；若 cookie 缺失则可能导致验证失败。
