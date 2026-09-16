# Resume Agent 单机私有部署 Feature Brief

> Feature ID：RA-009C
> 状态：Enabled for personal private beta；one-host Operational evidence
> 最后审阅：2026-09-16
> 目标环境：`chat.baxfor.fun` / Ubuntu 24.04 / Nginx / systemd / Node.js 24

## 用户结果

用户通过 HTTPS 访问 Career Agent Web，浏览器只连接同源 `/api`；API key 只存在服务器 root-only 环境文件中，Run 和待恢复任务写入本机 SQLite。进程或服务器重启后，systemd 自动拉起服务，API 在监听前有界恢复已提交任务。

## 现状证据

- DNS 指向用户明确授权的个人服务器；现有站点由 Nginx 转发至 `deeix-chat-app` 的 `127.0.0.1:8090`。
- 旧服务还包含 `deeix-memory-mcp.service`、两个 Docker volume 和约 28MB 数据；必须作为一个生命周期整体处理。
- 服务器已有有效 TLS 证书、Node.js 24、systemd 和 12GB 可用磁盘。
- DeepSeek 最小 OpenAI-compatible 调用成功；使用合成简历的完整同步 Agent 调用也已返回 `completed` 和 YAML artifact。一次旧进程环境优先级导致 401，清除继承变量并从专用环境文件启动后恢复。
- 当前 API 尚无完成验收的应用层认证，因此不能裸露公网。

## 部署决策

- 采用模块化单体的两个 systemd 进程，而不是在当前阶段引入 Kubernetes 或微服务平台。
- Web 监听 `127.0.0.1:3100`，API 监听 `127.0.0.1:8787`；只有 Nginx 暴露 80/443。
- Nginx 将 `/api/` 去前缀后转发给 API，其余请求转发 Web。部署构建把 Web 默认 API 地址设置为同源 `/api`，不把 Provider key 发给浏览器。
- 整站先使用 Nginx Basic Auth 作为部署防线；应用层用户、Run ownership 和凭证 vault 仍由 RA-016 负责。
- Provider 凭证存放在 `/etc/yamlresume-agent/api.env`，owner root、mode 0600；SQLite 位于 `/var/lib/yamlresume-agent`，仅服务账号可写。
- 旧服务先停机形成 SQLite 一致性备份，再删除容器、volume、镜像、memory MCP unit 和旧目录。备份保存在 root-only 目录，待新服务稳定后再按用户决定销毁。

## 回滚和切流

```text
构建新 artifact -> 独立端口启动 -> localhost health/smoke
  -> 停旧服务 -> root-only backup -> 切 Nginx -> HTTPS smoke
  -> 清理旧容器/volume/unit/image

失败：恢复旧 Nginx -> docker compose up -> 恢复 memory MCP unit
```

Nginx 配置必须在 reload 前通过 `nginx -t`。新服务至少验收：Basic Auth、Web HTML、`/api/healthz`、capabilities、DeepSeek 合成请求、SQLite 文件、systemd restart 和公网端口未直接开放。

## 证据台账

| Feature ID | 生命周期 / 用户结果 | Delivery | Evidence | Coverage | Historical gap | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- |
| RA-009C-A | artifact → systemd process | Enabled | 本地构建、远端 active/enabled、restart 与 journal | Partial | None | 自动发布与 rollback 命令尚未产品化 |
| RA-009C-B | HTTPS same-origin Web/API | Enabled | 公网 Web/API 200、真实 Chrome、TLS/Nginx smoke | Partial | None | CSP、外部监控与证书续期演练 |
| RA-009C-C | Provider secret boundary | Enabled | root-only env；浏览器 bundle 为同源 `/api`；真实 DeepSeek | Partial | Backfilled | 应用层 vault/KMS 仍为 RA-016 |
| RA-009C-D | public access protection | Enabled for one user | 未认证 401、Basic Auth Chrome/curl 验收 | Partial | Backfilled | 应用 auth、ownership、rate limit 未完成 |
| RA-009C-E | old service removal/rollback | Completed with recoverable backup | 一致性归档+hash；容器/volume/image/unit/path 清单复核为空 | Covered for removal action | None | 备份保留期和恢复演练未执行 |

## 不作出的声明

本切片不是多租户生产平台：没有完成应用层鉴权、按用户隔离 Run、速率限制、集中日志脱敏、托管数据库、备份轮换、多主机 worker 或 Provider exactly-once。Basic Auth 适合当前个人私有部署，不替代这些能力。

## 实际部署与验收记录

- current release：`/opt/yamlresume-agent/releases/20260916T094702Z`，`current` 使用原子 symlink 指向该版本；API/Web 均由独立 systemd unit 管理并设为开机启动。
- API/Web 只监听 `127.0.0.1:8787` 与 `127.0.0.1:3100`；公网只开放既有 Nginx 80/443。
- Provider 环境文件 mode 0600、owner root；SQLite 目录 mode 0700、数据库 mode 0600、owner 为隔离服务用户。
- Nginx 未认证访问返回 401；认证后的 Web、health、capabilities 均为 200，capabilities 报告 Provider configured + SQLite RunStore。
- 真实 HTTPS + DeepSeek 同步请求返回 200、`completed`、目标标题和 YAML artifact。
- 真实 Chrome 走通登录、后端在线、创建 Run、DeepSeek 生成、完成态、HTML 预览与 YAML 下载；下载 1244 bytes 且包含合成候选人姓名；page/console/request failure 均为空。
- systemd restart 后，浏览器产生的 Run 仍能通过公开 HTTP 读取为 `completed`，证明部署路径实际使用 durable Store。
- 首次 systemd 启动发现 `MemoryDenyWriteExecute` 与 V8 JIT 冲突并产生 SIGTRAP；根因确认后移除该项，其他隔离规则保留。Web 对 SIGTERM 返回 143，unit 用 `SuccessExitStatus=143` 明确为正常关闭；API SIGTERM 为 clean exit。
- 旧 Deeix 容器、两个 volume、两个镜像、memory MCP unit 与目录已删除；Nginx ACME webroot 已改名。删除前的一致性备份位于 `/root/backups/deeix-chat-20260916T090100Z`，归档 SHA-256 为 `8096a2eeee31b79891df68f6e78481cbdba8a79e687af5f769971c3eef478cb6`，仅 root 可访问。

### 2026-09-16 Chat/RTF API 更新

在完成回滚演练后，使用解析真实 release 路径的复制流程发布 API-only release
`/opt/yamlresume-agent/releases/20260916T094702Z`。生产环境显式设置
`RESUME_AGENT_AUTH_MODE=disabled`，保持当前个人部署的应用层匿名模式；公网边界仍由 Nginx Basic
Auth 保护，不把该配置描述成多用户应用认证。

公网验收：未认证 `/api/healthz` 返回 401，认证后 health 返回 200；capabilities 报告
`POST /v1/chat`、`application/rtf`、`providerConfigured=true`、SQLite RunStore；真实 HTTPS
`POST /api/v1/chat` 返回 200 和合法的 `{ reply, readyToGenerate }`。Web 未重启，API/Web 均为
`active`，SQLite 与 Provider env 未改动。

同一 release 的合成 RTF candidate 请求已通过公网输入类型校验并进入 Agent，但两次完整
`tailor-resume` 均以脱敏的 `422 agent_validation_failed` 结束；这证明 RTF 输入边界已接通，
不证明真实模型归一化质量或最终产物 E2E 已通过。原始 RTF、模型输出和错误正文未保存。

### 2026-09-16 API-only upgrade rehearsal

一次只替换 API/Agent dist 的升级演练未进入可用状态：新二进制在监听前以稳定错误
`Agent API runtime configuration is invalid` 退出，说明现有生产 env 与新认证/runtime 配置尚未完成
兼容性验收。回滚脚本将 `current` 恢复到 `20260916T085710Z`，从预留旧 artifact 恢复两个 dist，
重启后 `/healthz` 返回 200，API/Web 均重新 `active`；没有修改 SQLite、Provider env 或 Web。

演练还发现一个部署脚本陷阱：`cp -a /opt/yamlresume-agent/current new-release` 会复制 symlink
本身，而不是 release 内容，随后写入新路径可能实际覆盖旧 release。后续发布必须先解析并复制
`readlink -f current`（或使用明确的 `cp -aL`），并在切换前核对新目录不是 symlink；该失败路径保留
在学习记录中，作为 rollback 演练证据而非成功部署证据。
