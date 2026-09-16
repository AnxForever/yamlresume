# Resume Agent 异步 Run 协议 Feature Brief

> 功能 ID：RA-009 / Unit 7A
>
> 状态：Implemented（development-only，in-memory）
>
> 基线：2026-09-16，`f8b7468`

## 1. 用户问题与成功结果

当前 `POST /v1/tailor-resume` 会一直等待完整简历流程结束。随着文件解析、多个模型调用、PDF 编译和 Human-in-the-loop 加入，单个同步请求无法可靠表达排队、执行阶段、失败、恢复和取消。

本单元的成功结果是：客户端可以创建一个有稳定 ID 的异步运行，立即获得 `202`，随后查询当前阶段，并最终获得完成结果或安全的失败信息。

## 2. 范围

- 为每次异步任务创建稳定 `runId`；
- 定义显式运行状态和合法终态；
- 在 `@yamlresume/resume-agent` 中提供 `RunStore` seam；
- 提供开发和测试使用的 `InMemoryRunStore` adapter；
- 提供协调排队、执行、进度和错误归一化的 `ResumeAgentRunService`；
- 新增 `POST /v1/runs` 和 `GET /v1/runs/{id}`；
- 保留当前同步 `POST /v1/tailor-resume`；
- 公开快照不包含原始请求、API Key、原始模型 completion 或内部异常正文。

## 3. 非目标

- 跨进程或进程重启后的持久化；
- `needs_input`、问题控件、回答端点和 checkpoint 恢复；
- 取消、重新排队、优先级和分布式 worker；
- 生产数据库选型、鉴权、限流和租户隔离；
- 顶层 Career Agent 的能力路由。

这些内容分别属于 Unit 7B 或后续生产硬化，不能由内存实现冒充已经完成。

## 4. 架构决策

### 4.1 模块化单体和 ports/adapters

当前没有独立扩缩容或部署证据，因此继续使用模块化单体。领域包定义 `RunStore` interface，内存 adapter 和未来数据库 adapter 位于该 seam；HTTP 层只负责传输，不拥有运行状态机。

### 4.2 小而深的运行接口

调用方只需要：

```text
start(request) → queued run snapshot
get(runId) → latest public snapshot | undefined
```

排队、调用 Agent、接收阶段通知、保存终态和错误脱敏都隐藏在 `ResumeAgentRunService` 内部。

### 4.3 状态模型

```text
queued
  ↓
ingesting_inputs
  ↓
normalizing_candidate
  ↓
analyzing_jd
  ↓
matching_evidence
  ↓
drafting
  ↓
validating
  ↓
rendering
  ↓
completed

任意非终态 ──→ failed
```

`completed` 和 `failed` 是终态。本单元不允许终态再次进入运行态。Unit 7B 将单独增加 `needs_input` 及恢复转换。

### 4.4 公开数据与内部数据分离

公开 Run 快照包含：

- `id`、`status`、`createdAt`、`updatedAt`；
- 完成时的 `result`；
- 失败时的稳定错误 `code` 和安全 `message`。

原始请求只存在于当前进程的执行闭包，不放入公开快照。未来持久化 adapter 必须单独定义加密、保留和删除策略。

### 4.5 调度 seam

默认 adapter 使用当前进程的异步任务队列。测试使用手动 scheduler，先断言 `queued`，再显式执行任务，从而避免依赖计时器轮询证明核心状态机。

## 5. HTTP 契约

### `POST /v1/runs`

- 请求体：与 `POST /v1/tailor-resume` 相同；
- 成功：`202 Accepted`，返回 `queued` Run 快照；
- 输入错误：`400 invalid_request`；
- 支持 JSON 和现有 multipart 输入。

### `GET /v1/runs/{id}`

- 找到：`200`，返回最新 Run 快照；
- 未找到：`404 run_not_found`；
- 不返回原始输入和内部错误正文。

## 6. 失败模式

1. 输入在入队前无效：拒绝创建 Run；
2. 模型、文件、验证或渲染在后台失败：Run 进入 `failed`；
3. 内部错误包含候选人或 JD 内容：只保存稳定错误码和安全消息；
4. 查询不存在的 ID：返回确定性 404；
5. 内存进程重启：Run 丢失，这是本 adapter 的显式限制；
6. 多实例部署：各实例看不到彼此的 Run，本单元不得用于这种部署；
7. 进程在任务中途退出：没有恢复能力，留给持久化 checkpoint 单元；
8. 客户端高频轮询：生产限流和退避策略尚未实现。

## 7. 验收测试

- `start` 先返回 `queued`，手动调度后得到 `completed` 和结果；
- Agent 报错后得到 `failed`，且快照不泄露私密错误文本；
- 每个 Agent 阶段通知都能更新 Run 状态；
- 查询未知 Run 返回 `undefined`，HTTP 映射为 `404 run_not_found`；
- API 创建运行返回 `202`，随后能查询到终态；
- 原同步端点的现有测试继续通过；
- 全仓库测试、构建、类型检查和格式检查通过。

## 8. 退出门槛与剩余缺口

上述测试已在实现提交前通过，RA-009 可以标记为“Implemented，开发级”。由于仍是内存 adapter，证据覆盖最多为 `Partial`，不能称为 durable 或 operational。

下一单元 RA-011 / Unit 7B 将在这个 Run 协议上增加结构化交互请求、`needs_input`、回答验证、checkpoint 和恢复语义。
