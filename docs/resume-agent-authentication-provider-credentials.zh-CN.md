# Resume Agent 身份认证与 Provider 凭证库 Feature Brief

> Feature ID：RA-016
> 状态：Implemented for development
> 基线：2026-09-16，`a57bc68`
> 范围：后端账户、会话、Run 所有权与 Provider API key 加密存储；不包含前端页面、OAuth、计费或 Provider adapter 路由。

## 1. 用户结果

RA-016 之前的 API 没有身份边界。任何能访问服务的人都能创建 Run、按 ID 读取完整简历产物或回答交互；
Provider key 只能作为进程级环境变量，无法安全地按用户配置。RA-016 的开发级结果是：

1. 用户可用邮箱和密码注册、登录、查询当前身份并注销；
2. 浏览器只持有 HttpOnly 不透明会话 token，服务端可独立撤销；
3. 开启认证后，简历同步执行、Run 创建、读取和回答都要求登录，Run 只对 owner 可见；
4. 用户可按稳定 `providerId` 保存、替换、列出状态和删除 API key，响应永不返回明文；
5. 凭证数据库泄露时，密码仍是有成本的单向 hash，Provider key 仍受独立环境主密钥保护；
6. 新 Provider 只需新增 adapter/catalog，不需要迁移凭证表。

状态只允许写成 `Implemented for development`。没有邮箱验证、找回密码、MFA、生产 KMS、跨实例
限流、审计告警和真实 Provider adapter 验收前，不得称为生产认证。

## 2. 研究证据与决策

| 问题 | 证据 | 决策 / 可证伪约束 | 验收 |
| --- | --- | --- | --- |
| 密码如何保存 | OWASP Password Storage 建议优先 Argon2id，不可用时 scrypt 至少 `N=2^17,r=8,p=1`；Node 22 原生 `crypto.scrypt` | 不增加依赖；采用带随机盐、版本和参数的 scrypt record。若基准显示单次超过 1 秒或形成可利用 DoS，重新测量并选择 OWASP 等价参数，而不是降为快速 hash | 唯一盐、错误密码、未知账号同路径、参数化 record、节流 tests |
| 会话如何承载 | OWASP Session Management 要求 CSPRNG、无语义 session ID、服务端过期/撤销；MDN 要求跨 origin fetch 显式 credentials 才接受 `Set-Cookie` | 32-byte token；DB 只存 SHA-256 digest；登录总是新 session；HttpOnly + SameSite=Lax + Path=/，生产使用 `__Host-` + Secure | register/login/me/logout、过期、重放、cookie 属性 tests |
| Provider key 如何保存 | OWASP Cryptographic Storage 建议 AES、优先 authenticated mode GCM/CCM、CSPRNG IV 与正式 key lifecycle | AES-256-GCM；每条随机 96-bit nonce；AAD 绑定 schema/user/provider/keyId；环境 keyring 与 active keyId 支持轮换；DB 不保存主密钥 | at-rest 无明文、tamper、wrong/missing keyId、重开和 key rotation tests |
| 如何隔离用户 | OWASP Broken Access Control；本地 `ResumeAgentRunService` 只按 run ID 读取，没有 owner | 独立 durable ownership table；创建后绑定 owner；读取/回答先授权；未知和越权统一 404，避免枚举 | 两用户 Run 隔离、answer 越权、重启 ownership tests |
| 如何避免浏览器伪造 | OWASP CSRF guidance、现有前端/API 分端口 | 认证模式要求精确 CORS origin、`Access-Control-Allow-Credentials`，有 Origin 的 mutation 必须匹配；无 Origin 的受信 CLI 仍可使用 cookie jar | preflight、可信/恶意 Origin tests |
| 如何接更多渠道 | 当前只有 OpenAI-compatible transport；任意用户 URL 会扩大 SSRF 面 | credential schema 使用有界 provider ID，不存用户自定义 base URL；未来 adapter 由服务端 catalog 拥有 endpoint、模型和协议。凭证交付不等于 adapter 已可用 | provider upsert/list/delete、用户隔离、未知 adapter 不被误报为 enabled |

研究来源（2026-09-16）：

- OWASP Password Storage Cheat Sheet：
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- OWASP Session Management Cheat Sheet：
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- OWASP Secrets Management / Cryptographic Storage Cheat Sheets：
  <https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
  <https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html>
- OWASP CSRF Prevention Cheat Sheet：
  <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- Node.js 22 `crypto`：<https://nodejs.org/docs/latest-v22.x/api/crypto.html>
- MDN `Set-Cookie`：<https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie>

## 3. 深模块与状态

调用方只依赖一个 `AuthService` interface：

```text
register/login/authenticate/logout
put/list/delete/readProviderCredential
claimRun/isRunOwner
close
```

密码 record、SQLite schema、节流、session digest、AES-GCM envelope 和 migration 都隐藏在模块内。
HTTP 层只负责 schema、cookie/CORS/Origin 与稳定错误映射，不自行操作密码或密钥。

```text
anonymous --register/login--> active session --logout/expiry--> anonymous
                                  |
                                  +-- create Run --> durable owner mapping
                                  +-- put key --> encrypted credential envelope
```

数据库使用独立 schema/version table，不复用 RunStore 的 `PRAGMA user_version`，以免两个 adapter
误用同一 SQLite 文件时互相覆盖 migration 版本。表均为 `STRICT`，SQL 全部参数化：

- `resume_agent_users`
- `resume_agent_sessions`
- `resume_agent_provider_credentials`
- `resume_agent_run_owners`
- `resume_agent_login_failures`
- `resume_agent_auth_schema`

## 4. HTTP 契约

| 方法 | 路径 | 身份 | 结果 |
| --- | --- | --- | --- |
| POST | `/v1/auth/register` | public | 创建用户、签发 session cookie |
| POST | `/v1/auth/login` | public | 固定 `invalid_credentials` 失败；成功轮换 session |
| GET | `/v1/auth/me` | session | 只返回 `id/email/createdAt` |
| POST | `/v1/auth/logout` | optional session | 撤销当前 token 并清 cookie，幂等 |
| GET | `/v1/provider-credentials` | session | 只返回 provider ID 与时间戳 |
| PUT | `/v1/provider-credentials/{providerId}` | session | 加密 upsert，不回显 key |
| DELETE | `/v1/provider-credentials/{providerId}` | session | 删除当前用户的 key |

认证模式下，`POST /v1/tailor-resume` 与全部 Run 路径要求 session。`GET /healthz`、
`GET /v1/capabilities` 保持公开，capabilities 明确报告认证是否启用。Provider key 读取接口只供
后端未来 adapter 使用，不暴露为 HTTP。

## 5. 安全与失败边界

- 邮箱 canonicalize 为 trim + lowercase；密码 12–128 字符，允许 Unicode，不施加脆弱的字符组合规则。
- 登录未知邮箱也执行同成本 dummy scrypt；错误统一 `invalid_credentials`。
- 连续失败持久化计数并临时限流；不会在内存 Map 中假装支持多进程。
- session 和 credential key 不写日志、错误、OpenAPI example 或测试快照。
- auth 启动配置无效时 fail closed；只有显式 `RESUME_AGENT_AUTH_MODE=disabled` 才保留匿名开发模式。
- Provider credential 主密钥必须是 32-byte base64；keyId 非空且必须存在于 keyring。
- GCM 认证失败、未知 keyId、损坏 DB record 只返回稳定内部错误，不回显密文或底层异常。
- 越权 Run 与不存在 Run 都返回 `run_not_found`。
- API key 的使用、连通性测试和 Provider 选择是后续独立生命周期；本切片不发任何真实 Provider 请求。

### 5.1 本地启动配置

认证默认开启并 fail closed。首次启动前生成一个 32-byte 随机主密钥，将其 base64 值放入只对当前
用户可读的环境配置；不要把真实值提交到仓库：

```bash
openssl rand -base64 32

export RESUME_AGENT_CREDENTIAL_KEYS='{"local-v1":"<上一步输出>"}'
export RESUME_AGENT_CREDENTIAL_ACTIVE_KEY_ID='local-v1'
export RESUME_AGENT_ALLOWED_ORIGIN='http://localhost:5173'
export RESUME_AGENT_SECURE_COOKIES='false'
pnpm agent-api dev
```

| 变量 | 默认值 | 约束 |
| --- | --- | --- |
| `RESUME_AGENT_AUTH_MODE` | `enabled` | 只有显式 `disabled` 才使用旧匿名开发模式 |
| `RESUME_AGENT_AUTH_DB_PATH` | `.data/resume-agent/auth.sqlite` | 本地 SQLite 账户、会话、owner 与密文凭证库 |
| `RESUME_AGENT_CREDENTIAL_KEYS` | 无 | 必需的 JSON keyring；每个值必须是 32-byte 标准 base64 |
| `RESUME_AGENT_CREDENTIAL_ACTIVE_KEY_ID` | 无 | 必须命中 keyring；新写入使用该 key |
| `RESUME_AGENT_ALLOWED_ORIGIN` | `http://localhost:5173` | 必须是无 path 的精确 HTTP(S) origin，不允许 `*` |
| `RESUME_AGENT_SECURE_COOKIES` | 随 origin：HTTPS 为 `true`，HTTP 为 `false` | 必须与 origin scheme 一致；HTTPS 启用 `Secure` 与 `__Host-` cookie |

用户 Provider key 通过 `PUT /v1/provider-credentials/{providerId}` 写入。当前工作流仍只会读取进程级
`OPENAI_API_KEY`；凭证库到 Provider catalog/adapter 的选择与消费是后续切片，不能据此声称各渠道已接通。

## 6. TDD 与实现学习记录

1. RED→GREEN：register → login → authenticate 的持久 session。
2. RED→GREEN：重复邮箱、统一错误、dummy verification 与持久节流。
3. RED→GREEN：logout、绝对过期、token digest 和 reopen。
4. RED→GREEN：Provider key AES-GCM upsert/list/read/delete、tamper、key rotation。
5. RED→GREEN：run ownership claim/access 与两用户隔离。
6. RED→GREEN：HTTP cookie、认证门禁、Origin/CORS、稳定错误。
7. RED→GREEN：OpenAPI/capabilities/env startup 契约。
8. 完整 API/Agent tests、TypeScript、build、Biome、license、diff 和 staged audit。

实际纵向切片保留了以下可复现实验：

| 行为 | RED 证据 | GREEN 结果 / 设计知识 |
| --- | --- | --- |
| 持久登录节流 | 第 6 次未知账号登录仍为 `invalid_credentials` | canonical email 只以 SHA-256 key 进入 failure 表；5 次失败后封锁 15 分钟，重启后仍生效；未知账号执行 dummy scrypt |
| session 注销与重启 | `logout is not a function` | token 只以 SHA-256 digest 入库；SQLite reopen 可认证，logout 后重放稳定为 401，绝对过期不滑动 |
| Provider key CRUD | `putProviderCredential is not a function` | AES-256-GCM + 96-bit nonce + 128-bit tag；AAD 绑定 schema/user/provider/keyId；list/HTTP 永不返回明文 |
| Run owner | `claimRun is not a function` | durable owner 表在读取和回答前授权；跨用户与未知 Run 统一 404 |
| HTTP 登录闭环 | 注册路由返回 404 | HttpOnly cookie、`me/logout/login`、精确 credentialed CORS 与 Origin mutation gate |
| API 认证门禁 | 匿名创建 Run 仍返回 202 | 同步工作流及 Run create/get/answer 全部要求 session；创建成功后绑定 owner |
| 客户端错误 | 非法 JSON 被映射为 500 | 注册、登录与 Provider credential body 分别稳定映射为 400/401，不泄漏内部异常 |
| 启动失败边界 | 缺失 keyring 时旧 runtime 仍可启动 | 默认 enabled 且缺 key fail closed；显式 disabled 才兼容匿名开发；认证 DB 重启登录通过 |

框架无关结论：密码 hash、session、授权关系与可逆 secrets 是四个不同生命周期；把它们都塞进 JWT
或一张 user 表会牺牲撤销、轮换和故障局部性。HTTP adapter 只接 cookie/CORS/schema；所有密钥和
owner 不变量集中在 `AuthService` seam，调用方无法绕过加密 envelope。

### 6.1 2026-09-16 验证记录

- `pnpm agent-api test`：4 个文件、42 个测试通过；包含真实 localhost HTTP、SQLite reopen、
  scrypt、cookie、AES-GCM tamper/key rotation、跨用户 Run 和 startup fail-closed；
- `pnpm agent test`：16 个文件、246 个测试通过并自然退出；
- `pnpm --filter @yamlresume/resume-agent exec tsc --noEmit` 与
  `pnpm --filter @yamlresume/resume-agent-api exec tsc --noEmit`：通过；
- `pnpm agent build` 与 `pnpm agent-api build`：通过；
- `pnpm exec biome check packages/resume-agent/src packages/resume-agent-api/src`：53 个文件通过；
- `git diff --check`：通过；新增 3 个 TypeScript 文件均有完整 MIT header；
- `pnpm license:check`：命令返回 0，但本机没有 `addlicense` binary，脚本明确报告 skip，因此不把它
  误写成有效的自动 license 扫描；
- 仓库级 `pnpm check:ci` 已运行，但被受保护前端的 2 条 Biome 问题拦住；独立 `pnpm check:tsc`
  还被 `packages/playground` 的 React 类型版本冲突拦住。本切片没有修改这些范围外文件。

## 7. Evidence ledger

| Field | Evidence |
| --- | --- |
| Feature ID | RA-016 |
| Parent / lifecycle | public API → account → session → authorization；user → Provider credential → future adapter |
| Feature | 用户登录、Run 隔离和 Provider API key 安全托管 |
| Delivery state | Implemented for development；默认启动已启用，显式环境配置后可运行 |
| Current state | `AuthService`、SQLite schema、HTTP/OpenAPI、Run 门禁、环境 fail-closed 已实现；前端登录与 Provider adapter 消费未实现 |
| Primary evidence | OWASP password/session/CSRF/secrets/crypto guidance；Node 22 crypto；cookie contract |
| Independent evidence | 本地 SQLite reopen、两用户隔离、密文篡改、key rotation、恶意 Origin、HTTP cookie 与 startup 对抗测试 |
| Decision | Adapt native scrypt + opaque session + AES-GCM keyring；decline JWT/localStorage key、明文 DB、任意 provider URL 和 fail-open startup |
| Edge cases | duplicate/unknown user、Unicode password、concurrent failures、expiry/logout/replay、duplicate cookie、tamper/wrong key、cross-user Run/key、untrusted Origin、restart |
| Acceptance | API 4 files / 42 tests、Agent 16 files / 246 tests 自然退出；Agent/API TypeScript、build、53-file Biome、OpenAPI、diff 与手工 license header audit 通过 |
| Coverage | Partial：后端开发级 lifecycle covered；生产身份生命周期、KMS、跨实例 abuse control 与真实 adapter 仍为 gap |
| Historical gap | Backfilled；RA-008/011/013 已明确记录无鉴权，但未有独立实现切片 |
| Gap origin | 匿名本地 Beta API 与进程级 Provider env |
| Remaining gap | OAuth/OIDC、verification/reset/MFA、KMS/HSM、rotation job、分布式限流、审计/告警、删除/导出、Provider adapter 使用与生产部署 |
| Last reviewed | 2026-09-16，Node 22.21.1，HEAD `a57bc68` |
