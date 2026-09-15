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
| POST | `/v1/tailor-resume` | 同步执行完整简历定制工作流 |

## JSON 与 multipart

JSON 适合服务间调用和已经转换为 Base64 的文件。浏览器上传应优先使用 `multipart/form-data`：

- `jobDescription`：普通文本字段；
- `candidate`：JSON 字符串，包含 `yaml` 或 `resume`；
- `preferences`：JSON 字符串；
- `jobFiles`：可重复的文件字段；
- `candidateFiles`：可重复的文件字段。

## 前端集成规则

1. 页面加载时先请求 `/v1/capabilities`；
2. 使用后端返回的样式、格式和限制构建表单；
3. 为每次请求生成 `X-Request-Id`；
4. 将 `questions` 渲染为后续结构化交互控件；
5. 一个格式失败时读取 `variants[].failures`，不要把整个运行直接视为失败；
6. Base64 二进制通过 `mediaType` 和 `filename` 下载；
7. 不在浏览器持久化 API Key；
8. 后续异步运行 API 上线后，长任务应迁移到 Run 状态机，而不是无限增加 HTTP 超时时间。
