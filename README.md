# TavernRegister

简介
----
TavernRegister 是一个独立的注册门户，可在不修改 SillyTavern 核心代码的前提下创建用户账号。服务端会以管理员身份调用 SillyTavern 的内部 API（`/api/users/create`），前端界面与提示均已中文化，同时提供基本的输入校验与日志输出。若配置了 OAuth（目前支持 GitHub），用户可先通过第三方授权获取唯一身份，再完成 SillyTavern 账号绑定。

工作原理
----
1. 读取 `.env` 中的管理员凭证与 SillyTavern 地址，提前建立管理会话。
2. 若配置了 OAuth，提供 `/oauth/{provider}/start` 与 `/callback` 路由，完成授权码交换并获取第三方用户 ID。
3. 注册时将提交的显示名称、用户标识、密码以及可选的 OAuth provider/id 发送到 SillyTavern。
4. 调用 `/api/users/create` 创建账号，成功后将第三方 ID 与 SillyTavern handle 写入本地 SQLite `data/tavernregister.db`，防止同一第三方账号重复注册。

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
   按需填写 SillyTavern 与 OAuth 配置（见下）。
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
| `GITHUB_CLIENT_ID/SECRET/CALLBACK_URL` | （可选）GitHub OAuth 配置，全部填写后页面会显示“使用 GitHub 授权”按钮 |

示例 `.env`
----
```env
SILLYTAVERN_BASE_URL=https://your-tavern-domain.com:5000
SILLYTAVERN_ADMIN_HANDLE=admin
SILLYTAVERN_ADMIN_PASSWORD=changeme
PORT=3070

# Optional GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3070/oauth/github/callback
```

重要约束
----
- 密码为必填项，前后端均会验证两次输入一致且不得为空。
- SillyTavern 基础信息通过官方 API 操作，不直接改动酒馆的数据文件。
- OAuth 配置是“可选”功能；未填写对应字段时注册页面不会出现相关按钮。
- SQLite 数据库存放于 `data/tavernregister.db`，如需重置绑定可删除该文件（请谨慎操作并注意备份）。

排错指引
----
- 所有关键错误会输出到启动终端，包括管理员登录失败、OAuth 交换异常等，方便定位。
- 常见问题：
  - **403 管理员验证失败**：确认管理员账号/密码无误，`SILLYTAVERN_BASE_URL` 正确且能获取完整的 session cookie（含签名）。
  - **OAuth 回调 502**：检查 GitHub OAuth 应用后台登记的回调地址是否与 `.env` 中一致。
  - **“已绑定其他账号”提示**：代表该 GitHub ID 已在 SQLite 中关联，需管理员介入或删除数据库记录后再试。

后续拓展建议
----
- 接入更多 OAuth 提供方（Google、Discord 等），或接入企业内部 SSO。
- 引入速率限制、验证码或反向代理访问控制，提升注册入口安全性。
- 开发管理界面，支持查看/解绑已有的第三方绑定关系。
- 将 SQLite 替换为集中式数据库，以便横向扩展或跨实例部署。
