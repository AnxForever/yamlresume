# Resume Agent 直接对话 Feature Brief

> Feature ID：RA-017
> 状态：Implemented for development；尚未完成前端接入和生产级会话治理
> 最后审阅：2026-09-16

## 用户结果

用户可以先用自然语言告诉 Agent 自己想做什么，而不必一开始就准备 YAML、简历文件或
复杂 JSON。Agent 返回一条回复和一个 `readyToGenerate` 提示；真正生成简历仍进入现有
`tailor-resume` / Run 工作流，不让聊天路径绕过事实校验、交互提问或产物渲染。

## 契约与状态

`POST /v1/chat` 接收：

- `message`：1–20,000 字符；
- `history`：最多 50 条 user/assistant 消息；
- `context`：可选，最多 100,000 字符。

返回 `{ reply, readyToGenerate }`。认证模式下需要 session；健康检查和 capabilities 不受
此路由影响。Provider 未配置和 Provider 请求失败分别映射到稳定的 `503` / `502` 错误。

```text
anonymous -> authenticated chat -> readyToGenerate hint
                                      |
                                      +-> existing tailor/run contract
```

## 设计边界

- Chat 只负责收集意图和缺失信息，不直接修改简历事实；
- history/context 有界并由 schema 校验，不能把任意对象或未限制文本传给模型；
- response 经过 `ChatResponseSchema` 校验；模型原文、Prompt、Provider message 和密钥不进入
  HTTP 错误或持久化 Run；
- 当前没有流式 token、长期会话存储、工具调用、联网检索、自动提交简历或多用户聊天历史；
- `readyToGenerate` 是提示，不是绕过用户确认或领域校验的授权。

## RED → GREEN 与验收

1. RED：Agent 只有完整 tailor workflow，无法在没有上传文件时对话；GREEN：新增
   `ResumeTailoringAgent.chat()`，没有 history 时也能安全运行。
2. RED：API 对 `/v1/chat` 返回 404；GREEN：公开契约、认证门禁、稳定 LLM 错误和 fake
   provider HTTP 测试覆盖。
3. RED：workspace API 测试读取旧 Agent dist，`ChatRequestSchema` 为 undefined；GREEN：
   明确 `Agent build -> API test` 顺序，并在提交门禁中记录该依赖。
4. 2026-09-16 验证：Agent 17 files / 251 tests、API 4 files / 43 tests，Agent/API
   TypeScript、build、目标 Biome 和 `git diff --check` 通过。

## Evidence ledger

| Field | Evidence |
| --- | --- |
| Feature | 先对话收集意图，再进入简历生成工作流 |
| Delivery | Implemented for development |
| Primary evidence | 本地 API/OpenAPI/schema 与现有 Run/事实校验边界 |
| Independent evidence | fake LLM 的 Agent chat 测试、真实 HTTP route 测试、认证错误映射 |
| Decision | Adapt 现有 OpenAI-compatible structured JSON seam；不引入聊天框架或流式协议 |
| Coverage | Partial：后端契约 covered，前端、真实模型质量和长期会话仍未验证 |
| Remaining gap | 前端输入与选择控件、重复真实 chat Eval、会话持久化/删除、流式输出、工具授权 |
| Historical gap | Backfilled；此前前端 brief 明确记录后端没有 message 语义 |
