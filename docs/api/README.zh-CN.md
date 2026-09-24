# Resume Agent API 文档

## 文档入口

- OpenAPI 3.1：`docs/api/resume-agent.openapi.yaml`
- 输入输出设计：`docs/resume-agent-input-output.zh-CN.md`
- 总体架构：`docs/resume-agent-backend.md`
- 实施计划：`docs/resume-agent-implementation-plan.md`

前端应以 OpenAPI 文件作为接口契约，可以据此生成 TypeScript Client 和请求类型。`GET /v1/capabilities` 用于在运行时获取后端实际支持的文件、限制、格式和样式，避免前端硬编码。

## 通用响应

成功：

```json
{
  "data": {},
  "meta": {
    "apiVersion": "v1",
    "requestId": "..."
  }
}
```

失败：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "...",
    "details": [
      {
        "path": "candidate.files.0",
        "message": "..."
      }
    ]
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "..."
  }
}
```

前端应展示用户可理解的 `message`，调试信息通过 `requestId` 关联，不应显示模型密钥或服务端堆栈。

模型调用成功但 JSON 不符合领域 Schema，且一次自动 Repair 仍失败时，接口返回
`502` 和 `structured_output_validation_failed`。该错误只包含 Schema 名、字段路径、
issue code 与调用计数等安全摘要，不返回 JD、候选人资料、图片 Data URL 或模型原始响应。

## 当前 API 清单

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/healthz` | 进程健康检查 |
| GET | `/v1/capabilities` | 获取文件、输出格式、样式和限制 |
| POST | `/v1/auth/register` | 注册并签发 HttpOnly session cookie |
| POST | `/v1/auth/login` | 登录并轮换 session cookie |
| GET | `/v1/auth/me` | 查询当前身份 |
| POST | `/v1/auth/logout` | 撤销当前 session，幂等清 cookie |
| GET | `/v1/provider-credentials` | 列出当前用户已配置的 Provider，不返回 key |
| PUT | `/v1/provider-credentials/{providerId}` | 加密保存或替换 API key |
| DELETE | `/v1/provider-credentials/{providerId}` | 删除 API key |
| POST | `/v1/tailor-resume` | 同步执行完整简历定制工作流 |
| POST | `/v1/runs` | 创建异步简历定制 Run，返回 `202` 和 `queued` 快照 |
| GET | `/v1/runs/{id}` | 查询 Run 的当前阶段、完成结果或安全失败 |
| POST | `/v1/runs/{id}/answers` | 回答当前结构化交互，并继续暂停或恢复 Run |

本地 runtime 默认使用 SQLite RunStore，通过单机自动 poller 恢复和执行已提交
任务；认证启用时，Run owner 也在独立 auth schema 中持久化。内置 adapter 的
durable Run 会在 close、失租或 retry deadline 时取消本地 Provider transport。
多主机 worker、同步 HTTP 断连取消、Provider exactly-once/idempotency 与保留
策略仍未实现，不能把当前协议当作通用生产级任务队列。

处于 `needs_input` 的公开 Run 快照一次只暴露一个 `interactions` 项。客户端应
提交该项的 `id`、稳定的客户端幂等键和控件值。相同幂等键与相同回答可安全
重试；过期问题、错误状态或同键不同回答返回 `409`。完成快照的 `result` 会
包含用户需要下载的定制简历与渲染产物；原始请求、内部 checkpoint、回答原文
和模型原始输出不会公开。

## JSON 与 multipart

JSON 适合服务间调用和已经转换为 Base64 的文件。浏览器上传应优先使用 `multipart/form-data`：

- `jobDescription`：普通文本字段；
- `candidate`：JSON 字符串，包含 `yaml` 或 `resume`；
- `preferences`：JSON 字符串；
- `jobFiles`：可重复的文件字段；
- `candidateFiles`：可重复的文件字段。

## 前端集成规则

1. 页面加载时先请求 `/v1/capabilities`，读取 `runtime.authentication`；
2. 使用后端返回的样式、格式和限制构建表单；
3. 为每次请求生成 `X-Request-Id`；
4. Run 为 `needs_input` 时按 `interactions[0].control` 渲染控件，并向回答端点
   提交值；不要解析自然语言问题来猜控件；
5. 一个格式失败时读取 `variants[].failures`，不要把整个运行直接视为失败；
6. Base64 二进制通过 `mediaType` 和 `filename` 下载；
7. 所有认证请求使用 `credentials: 'include'`；API Key 只提交到凭证接口，不在
   浏览器持久化，也不假定凭证已被当前 Provider adapter 消费；
8. 长任务使用异步 Run API 和合理的轮询退避，不要无限增加同步 HTTP 超时时间；
9. 只承诺同一台主机、同一 SQLite 数据文件内的开发级重启恢复，不声称多机可靠性。
10. `date` / `date_range` 当前只接受 `YYYY-MM-DD`；只知道年份或月份时应退化
    为文本输入，不能捏造日期精度。
11. `file` 控件当前只验证既有文件引用；二进制上传和回答后的重新归一化仍未
    实现，前端不得把它展示成已经可用的完整上传闭环。
