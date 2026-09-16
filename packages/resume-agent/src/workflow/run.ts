/**
 * MIT License
 *
 * Copyright (c) 2023–Present PPResume (https://ppresume.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import { createHash, randomUUID } from 'node:crypto'

import type {
  AgentRunFailure,
  AgentRunStatus,
  InteractionAnswer,
  InteractionRequest,
  ResumeAgentRun,
  ResumeTailoringCheckpoint,
  TailorResumeRequest,
  TailorResumeResult,
} from '@/contracts'
import { ArtifactInputError } from '@/input/errors'
import { LlmConfigurationError } from '@/llm/openai-compatible'
import type { ResumeTailoringAgent } from '@/workflow/agent'
import {
  applyInteractionAnswer,
  createInteractionRequests,
  InteractionValidationError,
} from '@/workflow/interaction'

export type RunAnswerErrorCode =
  | 'run_not_found'
  | 'run_not_waiting_for_input'
  | 'stale_interaction'
  | 'invalid_answer'
  | 'idempotency_conflict'
  | 'answer_conflict'
  | 'run_checkpoint_missing'

function publicRunFailure(error: unknown): AgentRunFailure | undefined {
  if (error instanceof ArtifactInputError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof LlmConfigurationError) {
    return {
      code: 'llm_not_configured',
      message: 'LLM provider is not configured.',
    }
  }
  return undefined
}

export class RunAnswerError extends Error {
  constructor(
    readonly code: RunAnswerErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'RunAnswerError'
  }
}

export interface StoredResumeAgentRun {
  /** Internal store version; it is never copied into the public snapshot. */
  revision: number
  snapshot: ResumeAgentRun
  request?: TailorResumeRequest
  checkpoint?: ResumeTailoringCheckpoint
  pendingInteractions?: InteractionRequest[]
  answerReceipts?: InteractionAnswerReceipt[]
}

interface InteractionAnswerReceipt {
  interactionId: string
  idempotencyKey: string
  valueFingerprint: string
  answeredAt: string
}

export type RunTaskKind = 'prepare' | 'complete'

export interface RunTask {
  id: string
  runId: string
  kind: RunTaskKind
  createdAt: string
}

export interface ClaimedRunTask extends RunTask {
  attempt: number
  leaseOwner: string
  leaseExpiresAt: string
}

export interface RunTaskClaimIdentity {
  id: string
  runId: string
  attempt: number
  leaseOwner: string
}

export interface ClaimRunTaskOptions {
  workerId: string
  now: Date
  leaseDurationMs: number
}

export interface RenewRunTaskLeaseOptions extends RunTaskClaimIdentity {
  now: Date
  leaseDurationMs: number
}

export type TaskFencedRunUpdateResult =
  | 'updated'
  | 'revision_conflict'
  | 'lease_lost'

export interface RunStore {
  get(id: string): Promise<StoredResumeAgentRun | undefined>
  /** Atomically creates only an absent ID with revision 0. */
  create(run: StoredResumeAgentRun): Promise<boolean>
  /**
   * Atomically replaces an existing record only when its revision matches the
   * supplied revision. A successful write stores revision + 1.
   */
  compareAndSet(run: StoredResumeAgentRun): Promise<boolean>
}

export interface DurableRunStore extends RunStore {
  createWithTask(run: StoredResumeAgentRun, task: RunTask): Promise<boolean>
  compareAndSetWithTask(
    run: StoredResumeAgentRun,
    task: RunTask
  ): Promise<boolean>
  claimNextTask(
    options: ClaimRunTaskOptions
  ): Promise<ClaimedRunTask | undefined>
  /** Renews only the exact current generation while its lease is unexpired. */
  renewTaskLease(
    options: RenewRunTaskLeaseOptions
  ): Promise<ClaimedRunTask | undefined>
  /**
   * Atomically checks the Run revision and an unexpired task generation before
   * storing revision + 1.
   */
  compareAndSetForTask(
    run: StoredResumeAgentRun,
    claim: RunTaskClaimIdentity,
    now: Date
  ): Promise<TaskFencedRunUpdateResult>
  acknowledgeTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean>
  releaseTask(
    taskId: string,
    leaseOwner: string,
    attempt: number
  ): Promise<boolean>
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredResumeAgentRun>()

  async get(id: string): Promise<StoredResumeAgentRun | undefined> {
    const run = this.runs.get(id)
    return run ? structuredClone(run) : undefined
  }

  async create(run: StoredResumeAgentRun): Promise<boolean> {
    if (run.revision !== 0 || this.runs.has(run.snapshot.id)) return false
    this.runs.set(run.snapshot.id, structuredClone(run))
    return true
  }

  async compareAndSet(run: StoredResumeAgentRun): Promise<boolean> {
    const current = this.runs.get(run.snapshot.id)
    if (!current || current.revision !== run.revision) return false
    this.runs.set(
      run.snapshot.id,
      structuredClone({ ...run, revision: run.revision + 1 })
    )
    return true
  }
}

type ScheduledTask = () => Promise<void>

const MAX_RUN_UPDATE_ATTEMPTS = 3
const DEFAULT_TASK_LEASE_MS = 60_000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const DEFAULT_MAX_TASK_ATTEMPTS = 3
const DEFAULT_RECOVERY_LIMIT = 100
const TASK_ATTEMPTS_EXHAUSTED: AgentRunFailure = {
  code: 'agent_task_attempts_exhausted',
  message: 'The resume tailoring task exceeded its retry limit.',
}

const NEXT_STATUS: Record<AgentRunStatus, AgentRunStatus[]> = {
  queued: ['ingesting_inputs', 'failed'],
  ingesting_inputs: ['normalizing_candidate', 'failed'],
  normalizing_candidate: ['needs_input', 'analyzing_jd', 'failed'],
  needs_input: ['analyzing_jd', 'failed'],
  analyzing_jd: ['matching_evidence', 'failed'],
  matching_evidence: ['drafting', 'failed'],
  drafting: ['validating', 'failed'],
  validating: ['rendering', 'failed'],
  rendering: ['completed', 'failed'],
  completed: [],
  failed: [],
}

const ACTIVE_STATUS_RANK: Partial<Record<AgentRunStatus, number>> = {
  queued: 0,
  ingesting_inputs: 1,
  normalizing_candidate: 2,
  analyzing_jd: 3,
  matching_evidence: 4,
  drafting: 5,
  validating: 6,
  rendering: 7,
}

export interface ResumeAgentRunServiceOptions {
  store?: RunStore
  idFactory?: () => string
  now?: () => Date
  schedule?: (task: ScheduledTask) => void
  workerId?: string
  taskLeaseMs?: number
  taskHeartbeatMs?: number
  maxTaskAttempts?: number
}

function isDurableRunStore(store: RunStore): store is DurableRunStore {
  const candidate = store as Partial<DurableRunStore>
  return (
    typeof candidate.createWithTask === 'function' &&
    typeof candidate.compareAndSetWithTask === 'function' &&
    typeof candidate.claimNextTask === 'function' &&
    typeof candidate.renewTaskLease === 'function' &&
    typeof candidate.compareAndSetForTask === 'function' &&
    typeof candidate.acknowledgeTask === 'function' &&
    typeof candidate.releaseTask === 'function'
  )
}

function createRunTask(
  runId: string,
  kind: RunTaskKind,
  targetRevision: number,
  createdAt: string
): RunTask {
  return {
    id: `${runId}:${kind}:${targetRevision}`,
    runId,
    kind,
    createdAt,
  }
}

function defaultSchedule(task: ScheduledTask): void {
  queueMicrotask(() => {
    void task()
  })
}

class RunTaskLeaseHeartbeat {
  private active = false
  private leaseLost = false
  private timer: ReturnType<typeof setInterval> | undefined
  private operations: Promise<void> = Promise.resolve()
  private renewalScheduled = false

  constructor(
    private readonly store: DurableRunStore,
    private readonly task: ClaimedRunTask,
    private readonly now: () => Date,
    private readonly leaseDurationMs: number,
    private readonly intervalMs: number
  ) {}

  async start(): Promise<boolean> {
    this.active = true
    await this.scheduleRenewal()
    if (this.leaseLost) return false
    this.timer = setInterval(() => {
      if (!this.active || this.renewalScheduled) return
      void this.scheduleRenewal()
    }, this.intervalMs)
    this.timer.unref()
    return true
  }

  compareAndSet(run: StoredResumeAgentRun): Promise<TaskFencedRunUpdateResult> {
    return this.runExclusive(async () => {
      if (!this.active || this.leaseLost) return 'lease_lost'
      try {
        const result = await this.store.compareAndSetForTask(
          run,
          this.task,
          this.now()
        )
        if (result === 'lease_lost') this.markLeaseLost()
        return result
      } catch {
        this.markLeaseLost()
        return 'lease_lost'
      }
    })
  }

  async stop(): Promise<boolean> {
    this.active = false
    this.clearTimer()
    await this.operations
    return !this.leaseLost
  }

  async abandon(): Promise<void> {
    this.markLeaseLost()
    await this.operations
  }

  private scheduleRenewal(): Promise<void> {
    this.renewalScheduled = true
    return this.runExclusive(async () => {
      if (!this.active || this.leaseLost) return
      await this.renewOnce()
    }).finally(() => {
      this.renewalScheduled = false
    })
  }

  private async renewOnce(): Promise<void> {
    try {
      const renewed = await this.store.renewTaskLease({
        id: this.task.id,
        runId: this.task.runId,
        leaseOwner: this.task.leaseOwner,
        attempt: this.task.attempt,
        now: this.now(),
        leaseDurationMs: this.leaseDurationMs,
      })
      if (renewed) return
    } catch {
      // Storage uncertainty is treated as lease loss.
    }
    this.markLeaseLost()
  }

  private markLeaseLost(): void {
    this.leaseLost = true
    this.active = false
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

class RunTaskLeaseLostError extends Error {}

function answerFingerprint(answer: InteractionAnswer): string {
  return createHash('sha256')
    .update(JSON.stringify([answer.interactionId, answer.value]))
    .digest('hex')
}

function removeAnsweredQuestion(
  checkpoint: ResumeTailoringCheckpoint,
  interaction: InteractionRequest
): ResumeTailoringCheckpoint['questions'] {
  let removed = false
  return checkpoint.questions.filter((question) => {
    if (
      !removed &&
      question.field === interaction.field &&
      question.question === interaction.prompt &&
      question.reason === interaction.reason &&
      question.severity === interaction.severity
    ) {
      removed = true
      return false
    }
    return true
  })
}

export class ResumeAgentRunService {
  private readonly store: RunStore
  private readonly durableStore: DurableRunStore | undefined
  private readonly idFactory: () => string
  private readonly now: () => Date
  private readonly schedule: (task: ScheduledTask) => void
  private readonly workerId: string
  private readonly taskLeaseMs: number
  private readonly taskHeartbeatMs: number
  private readonly maxTaskAttempts: number
  private readonly activeHeartbeats = new Set<RunTaskLeaseHeartbeat>()
  private closed = false

  constructor(
    private readonly agent: ResumeTailoringAgent,
    options: ResumeAgentRunServiceOptions = {}
  ) {
    this.store = options.store ?? new InMemoryRunStore()
    this.durableStore = isDurableRunStore(this.store) ? this.store : undefined
    this.idFactory = options.idFactory ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.schedule = options.schedule ?? defaultSchedule
    this.workerId = options.workerId ?? randomUUID()
    this.taskLeaseMs = options.taskLeaseMs ?? DEFAULT_TASK_LEASE_MS
    this.taskHeartbeatMs =
      options.taskHeartbeatMs ?? Math.max(1, Math.floor(this.taskLeaseMs / 3))
    this.maxTaskAttempts = options.maxTaskAttempts ?? DEFAULT_MAX_TASK_ATTEMPTS
    if (
      !this.workerId.trim() ||
      !Number.isSafeInteger(this.taskLeaseMs) ||
      this.taskLeaseMs < 2 ||
      this.taskLeaseMs > MAX_TIMER_DELAY_MS ||
      !Number.isSafeInteger(this.taskHeartbeatMs) ||
      this.taskHeartbeatMs < 1 ||
      this.taskHeartbeatMs >= this.taskLeaseMs ||
      !Number.isSafeInteger(this.maxTaskAttempts) ||
      this.maxTaskAttempts <= 0 ||
      this.maxTaskAttempts > 1_000
    ) {
      throw new Error('Run task worker configuration is invalid')
    }
  }

  async start(request: TailorResumeRequest): Promise<ResumeAgentRun> {
    const now = this.now().toISOString()
    const run: ResumeAgentRun = {
      id: this.idFactory(),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    const storedRun = {
      revision: 0,
      snapshot: run,
      request,
    }
    const created = this.durableStore
      ? await this.durableStore.createWithTask(
          storedRun,
          createRunTask(run.id, 'prepare', 0, now)
        )
      : await this.store.create(storedRun)
    if (!created) throw new Error('Run already exists')
    if (this.durableStore) {
      this.schedule(() => this.claimAndExecuteNextTask())
    } else {
      this.schedule(() => this.execute(run.id))
    }
    return run
  }

  async get(id: string): Promise<ResumeAgentRun | undefined> {
    return (await this.store.get(id))?.snapshot
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.all(
      [...this.activeHeartbeats].map((heartbeat) => heartbeat.abandon())
    )
  }

  async recoverPendingTasks(
    limit: number = DEFAULT_RECOVERY_LIMIT
  ): Promise<number> {
    if (!this.durableStore || this.closed) return 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Run task recovery limit is invalid')
    }
    let recovered = 0
    while (recovered < limit) {
      const task = await this.durableStore.claimNextTask({
        workerId: this.workerId,
        now: this.now(),
        leaseDurationMs: this.taskLeaseMs,
      })
      if (!task) break
      recovered += 1
      this.schedule(() => this.executeClaimedTask(task))
    }
    return recovered
  }

  private async claimAndExecuteNextTask(): Promise<void> {
    if (!this.durableStore || this.closed) return
    try {
      const task = await this.durableStore.claimNextTask({
        workerId: this.workerId,
        now: this.now(),
        leaseDurationMs: this.taskLeaseMs,
      })
      if (task) await this.executeClaimedTask(task)
    } catch {
      // The committed task remains available or leased for later recovery.
    }
  }

  private async executeClaimedTask(task: ClaimedRunTask): Promise<void> {
    if (!this.durableStore || this.closed) return
    const heartbeat = new RunTaskLeaseHeartbeat(
      this.durableStore,
      task,
      this.now,
      this.taskLeaseMs,
      this.taskHeartbeatMs
    )
    this.activeHeartbeats.add(heartbeat)
    try {
      if (!(await heartbeat.start())) return
      if (task.attempt > this.maxTaskAttempts) {
        const stored = await this.store.get(task.runId)
        if (
          stored &&
          stored.snapshot.status !== 'needs_input' &&
          stored.snapshot.status !== 'completed' &&
          stored.snapshot.status !== 'failed'
        ) {
          await this.fail(task.runId, TASK_ATTEMPTS_EXHAUSTED, heartbeat)
        }
      } else if (task.kind === 'prepare') {
        await this.execute(task.runId, heartbeat)
      } else {
        await this.executeCompletion(task.runId, heartbeat)
      }
      if (await heartbeat.stop()) {
        await this.durableStore.acknowledgeTask(
          task.id,
          task.leaseOwner,
          task.attempt
        )
      }
    } catch {
      if (await heartbeat.stop()) {
        try {
          await this.durableStore.releaseTask(
            task.id,
            task.leaseOwner,
            task.attempt
          )
        } catch {
          // A later lease expiry can make the task recoverable again.
        }
      }
    } finally {
      this.activeHeartbeats.delete(heartbeat)
      await heartbeat.stop()
    }
  }

  private async execute(
    id: string,
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    try {
      const stored = await this.store.get(id)
      if (!stored?.request) return
      if (
        stored.snapshot.status === 'completed' ||
        stored.snapshot.status === 'failed' ||
        stored.snapshot.status === 'needs_input'
      ) {
        return
      }
      let checkpoint = stored.checkpoint
      if (!checkpoint) {
        checkpoint = await this.agent.prepare(stored.request, {
          onStatus: (status) => this.transition(id, status, heartbeat),
        })
        const interactions = createInteractionRequests(
          checkpoint.questions
        ).filter((interaction) => interaction.severity !== 'optional')
        if (interactions[0]) {
          await this.pause(id, checkpoint, interactions, heartbeat)
          return
        }
        await this.saveCheckpoint(id, checkpoint, heartbeat)
      }
      const result = await this.agent.complete(checkpoint, {
        onStatus: (status) => this.transition(id, status, heartbeat),
      })
      await this.finish(id, result, heartbeat)
    } catch (error) {
      if (error instanceof RunTaskLeaseLostError) throw error
      await this.fail(id, publicRunFailure(error), heartbeat)
    }
  }

  async answer(id: string, answer: InteractionAnswer): Promise<ResumeAgentRun> {
    const current = await this.store.get(id)
    if (!current) {
      throw new RunAnswerError('run_not_found', 'Run not found')
    }
    const valueFingerprint = answerFingerprint(answer)
    const existingReceipt = current.answerReceipts?.find(
      (receipt) => receipt.idempotencyKey === answer.idempotencyKey
    )
    if (existingReceipt) {
      if (
        existingReceipt.interactionId === answer.interactionId &&
        existingReceipt.valueFingerprint === valueFingerprint
      ) {
        return current.snapshot
      }
      throw new RunAnswerError(
        'idempotency_conflict',
        'Idempotency key was already used for a different answer'
      )
    }
    if (current.snapshot.status !== 'needs_input') {
      throw new RunAnswerError(
        'run_not_waiting_for_input',
        'Run is not waiting for input'
      )
    }
    const interaction = current.pendingInteractions?.[0]
    if (!interaction || interaction.id !== answer.interactionId) {
      throw new RunAnswerError(
        'stale_interaction',
        'Interaction is no longer active'
      )
    }
    if (!current.checkpoint) {
      throw new RunAnswerError(
        'run_checkpoint_missing',
        'Run checkpoint is unavailable'
      )
    }

    let candidate: ResumeTailoringCheckpoint['candidate']
    try {
      candidate = applyInteractionAnswer(
        current.checkpoint.candidate,
        interaction,
        answer.value
      )
    } catch (error) {
      if (error instanceof InteractionValidationError) {
        throw new RunAnswerError('invalid_answer', error.message)
      }
      throw error
    }
    const checkpoint: ResumeTailoringCheckpoint = {
      ...current.checkpoint,
      candidate,
      questions: removeAnsweredQuestion(current.checkpoint, interaction),
    }
    const remaining = current.pendingInteractions?.slice(1) ?? []
    const answerReceipts = [
      ...(current.answerReceipts ?? []),
      {
        interactionId: answer.interactionId,
        idempotencyKey: answer.idempotencyKey,
        valueFingerprint,
        answeredAt: this.now().toISOString(),
      },
    ]
    if (remaining[0]) {
      const snapshot: ResumeAgentRun = {
        ...current.snapshot,
        updatedAt: this.now().toISOString(),
        interactions: [remaining[0]],
      }
      const updated = await this.store.compareAndSet({
        ...current,
        snapshot,
        checkpoint,
        pendingInteractions: remaining,
        answerReceipts,
      })
      if (!updated) {
        return this.resolveAnswerConflict(id, answer, valueFingerprint)
      }
      return snapshot
    }

    const { interactions: _interactions, ...snapshotWithoutInteractions } =
      current.snapshot
    const snapshot: ResumeAgentRun = {
      ...snapshotWithoutInteractions,
      status: 'analyzing_jd',
      updatedAt: this.now().toISOString(),
    }
    const nextStoredRun: StoredResumeAgentRun = {
      ...current,
      snapshot,
      checkpoint,
      pendingInteractions: undefined,
      answerReceipts,
    }
    const updated = this.durableStore
      ? await this.durableStore.compareAndSetWithTask(
          nextStoredRun,
          createRunTask(
            id,
            'complete',
            current.revision + 1,
            snapshot.updatedAt
          )
        )
      : await this.store.compareAndSet(nextStoredRun)
    if (!updated) {
      return this.resolveAnswerConflict(id, answer, valueFingerprint)
    }
    if (this.durableStore) {
      this.schedule(() => this.claimAndExecuteNextTask())
    } else {
      this.schedule(() => this.executeCompletion(id))
    }
    return snapshot
  }

  private async resolveAnswerConflict(
    id: string,
    answer: InteractionAnswer,
    valueFingerprint: string
  ): Promise<ResumeAgentRun> {
    const winner = await this.store.get(id)
    const receipt = winner?.answerReceipts?.find(
      (candidate) => candidate.idempotencyKey === answer.idempotencyKey
    )
    if (
      winner &&
      receipt?.interactionId === answer.interactionId &&
      receipt.valueFingerprint === valueFingerprint
    ) {
      return winner.snapshot
    }
    if (receipt) {
      throw new RunAnswerError(
        'idempotency_conflict',
        'Idempotency key was already used for a different answer'
      )
    }
    throw new RunAnswerError(
      'answer_conflict',
      'Another answer was accepted before this answer'
    )
  }

  private async executeCompletion(
    id: string,
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    try {
      const stored = await this.store.get(id)
      if (
        !stored?.checkpoint ||
        stored.snapshot.status === 'completed' ||
        stored.snapshot.status === 'failed'
      ) {
        return
      }
      const result = await this.agent.complete(stored.checkpoint, {
        onStatus: (status) => this.transition(id, status, heartbeat),
      })
      await this.finish(id, result, heartbeat)
    } catch (error) {
      if (error instanceof RunTaskLeaseLostError) throw error
      await this.fail(id, publicRunFailure(error), heartbeat)
    }
  }

  private async updateStoredRun(
    id: string,
    derive: (current: StoredResumeAgentRun) => StoredResumeAgentRun | undefined,
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_RUN_UPDATE_ATTEMPTS; attempt += 1) {
      const current = await this.store.get(id)
      if (!current) return
      const next = derive(current)
      if (!next) return
      if (!heartbeat) {
        if (await this.store.compareAndSet(next)) return
        continue
      }
      const result = await heartbeat.compareAndSet(next)
      if (result === 'updated') return
      if (result === 'lease_lost') throw new RunTaskLeaseLostError()
    }
    throw new Error('Run update conflict')
  }

  private async transition(
    id: string,
    status: AgentRunStatus,
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    await this.updateStoredRun(
      id,
      (current) => {
        if (current.snapshot.status === status) return undefined
        const currentRank = ACTIVE_STATUS_RANK[current.snapshot.status]
        const nextRank = ACTIVE_STATUS_RANK[status]
        if (
          currentRank !== undefined &&
          nextRank !== undefined &&
          nextRank < currentRank
        ) {
          return undefined
        }
        if (!NEXT_STATUS[current.snapshot.status].includes(status)) {
          throw new Error(
            `Invalid run transition from ${current.snapshot.status} to ${status}`
          )
        }
        return {
          ...current,
          snapshot: {
            ...current.snapshot,
            status,
            updatedAt: this.now().toISOString(),
          },
        }
      },
      heartbeat
    )
  }

  private async saveCheckpoint(
    id: string,
    checkpoint: ResumeTailoringCheckpoint,
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    await this.updateStoredRun(
      id,
      (current) => ({
        ...current,
        checkpoint,
      }),
      heartbeat
    )
  }

  private async pause(
    id: string,
    checkpoint: ResumeTailoringCheckpoint,
    interactions: InteractionRequest[],
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    await this.updateStoredRun(
      id,
      (current) => {
        if (!NEXT_STATUS[current.snapshot.status].includes('needs_input')) {
          throw new Error(`Cannot pause run from ${current.snapshot.status}`)
        }
        return {
          ...current,
          snapshot: {
            ...current.snapshot,
            status: 'needs_input',
            updatedAt: this.now().toISOString(),
            interactions: [interactions[0]],
          },
          checkpoint,
          pendingInteractions: interactions,
        }
      },
      heartbeat
    )
  }

  private async fail(
    id: string,
    error: AgentRunFailure = {
      code: 'agent_run_failed',
      message: 'The resume tailoring run failed.',
    },
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    await this.updateStoredRun(
      id,
      (current) => {
        if (!NEXT_STATUS[current.snapshot.status].includes('failed')) {
          return undefined
        }
        return {
          ...current,
          snapshot: {
            ...current.snapshot,
            status: 'failed',
            updatedAt: this.now().toISOString(),
            interactions: undefined,
            error,
          },
        }
      },
      heartbeat
    )
  }

  private async finish(
    id: string,
    result: TailorResumeResult,
    heartbeat?: RunTaskLeaseHeartbeat
  ): Promise<void> {
    await this.updateStoredRun(
      id,
      (current) => {
        if (!NEXT_STATUS[current.snapshot.status].includes('completed')) {
          throw new Error(`Cannot complete run from ${current.snapshot.status}`)
        }
        return {
          ...current,
          snapshot: {
            ...current.snapshot,
            status: 'completed',
            updatedAt: this.now().toISOString(),
            interactions: undefined,
            result,
          },
        }
      },
      heartbeat
    )
  }
}
