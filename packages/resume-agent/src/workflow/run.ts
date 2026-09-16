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
  AgentRunStatus,
  InteractionAnswer,
  InteractionRequest,
  ResumeAgentRun,
  ResumeTailoringCheckpoint,
  TailorResumeRequest,
  TailorResumeResult,
} from '@/contracts'
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
  | 'run_checkpoint_missing'

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

export interface RunStore {
  get(id: string): Promise<StoredResumeAgentRun | undefined>
  save(run: StoredResumeAgentRun): Promise<void>
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, StoredResumeAgentRun>()

  async get(id: string): Promise<StoredResumeAgentRun | undefined> {
    const run = this.runs.get(id)
    return run ? structuredClone(run) : undefined
  }

  async save(run: StoredResumeAgentRun): Promise<void> {
    this.runs.set(run.snapshot.id, structuredClone(run))
  }
}

type ScheduledTask = () => Promise<void>

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

export interface ResumeAgentRunServiceOptions {
  store?: RunStore
  idFactory?: () => string
  now?: () => Date
  schedule?: (task: ScheduledTask) => void
}

function defaultSchedule(task: ScheduledTask): void {
  queueMicrotask(() => {
    void task()
  })
}

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
  private readonly idFactory: () => string
  private readonly now: () => Date
  private readonly schedule: (task: ScheduledTask) => void

  constructor(
    private readonly agent: ResumeTailoringAgent,
    options: ResumeAgentRunServiceOptions = {}
  ) {
    this.store = options.store ?? new InMemoryRunStore()
    this.idFactory = options.idFactory ?? randomUUID
    this.now = options.now ?? (() => new Date())
    this.schedule = options.schedule ?? defaultSchedule
  }

  async start(request: TailorResumeRequest): Promise<ResumeAgentRun> {
    const now = this.now().toISOString()
    const run: ResumeAgentRun = {
      id: this.idFactory(),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    await this.store.save({ snapshot: run, request })
    this.schedule(() => this.execute(run.id))
    return run
  }

  async get(id: string): Promise<ResumeAgentRun | undefined> {
    return (await this.store.get(id))?.snapshot
  }

  private async execute(id: string): Promise<void> {
    try {
      const stored = await this.store.get(id)
      if (!stored?.request) return
      const checkpoint = await this.agent.prepare(stored.request, {
        onStatus: (status) => this.transition(id, status),
      })
      const interactions = createInteractionRequests(
        checkpoint.questions
      ).filter((interaction) => interaction.severity !== 'optional')
      if (interactions[0]) {
        await this.pause(id, checkpoint, interactions)
        return
      }
      await this.saveCheckpoint(id, checkpoint)
      const result = await this.agent.complete(checkpoint, {
        onStatus: (status) => this.transition(id, status),
      })
      await this.finish(id, result)
    } catch {
      await this.fail(id)
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
      await this.store.save({
        snapshot,
        checkpoint,
        pendingInteractions: remaining,
        answerReceipts,
      })
      return snapshot
    }

    const { interactions: _interactions, ...snapshotWithoutInteractions } =
      current.snapshot
    const snapshot: ResumeAgentRun = {
      ...snapshotWithoutInteractions,
      status: 'analyzing_jd',
      updatedAt: this.now().toISOString(),
    }
    await this.store.save({ snapshot, checkpoint, answerReceipts })
    this.schedule(() => this.executeCompletion(id))
    return snapshot
  }

  private async executeCompletion(id: string): Promise<void> {
    try {
      const stored = await this.store.get(id)
      if (!stored?.checkpoint) return
      const result = await this.agent.complete(stored.checkpoint, {
        onStatus: (status) => this.transition(id, status),
      })
      await this.finish(id, result)
    } catch {
      await this.fail(id)
    }
  }

  private async transition(id: string, status: AgentRunStatus): Promise<void> {
    const current = await this.store.get(id)
    if (!current) return
    if (current.snapshot.status === status) return
    if (!NEXT_STATUS[current.snapshot.status].includes(status)) {
      throw new Error(
        `Invalid run transition from ${current.snapshot.status} to ${status}`
      )
    }
    await this.store.save({
      ...current,
      snapshot: {
        ...current.snapshot,
        status,
        updatedAt: this.now().toISOString(),
      },
    })
  }

  private async saveCheckpoint(
    id: string,
    checkpoint: ResumeTailoringCheckpoint
  ): Promise<void> {
    const current = await this.store.get(id)
    if (!current) return
    await this.store.save({
      snapshot: current.snapshot,
      checkpoint,
    })
  }

  private async pause(
    id: string,
    checkpoint: ResumeTailoringCheckpoint,
    interactions: InteractionRequest[]
  ): Promise<void> {
    const current = await this.store.get(id)
    if (!current) return
    if (!NEXT_STATUS[current.snapshot.status].includes('needs_input')) {
      throw new Error(`Cannot pause run from ${current.snapshot.status}`)
    }
    await this.store.save({
      snapshot: {
        ...current.snapshot,
        status: 'needs_input',
        updatedAt: this.now().toISOString(),
        interactions: [interactions[0]],
      },
      checkpoint,
      pendingInteractions: interactions,
    })
  }

  private async fail(id: string): Promise<void> {
    const current = await this.store.get(id)
    if (!current || !NEXT_STATUS[current.snapshot.status].includes('failed')) {
      return
    }
    await this.store.save({
      ...current,
      snapshot: {
        ...current.snapshot,
        status: 'failed',
        updatedAt: this.now().toISOString(),
        interactions: undefined,
        error: {
          code: 'agent_run_failed',
          message: 'The resume tailoring run failed.',
        },
      },
    })
  }

  private async finish(id: string, result: TailorResumeResult): Promise<void> {
    const current = await this.store.get(id)
    if (!current) return
    if (!NEXT_STATUS[current.snapshot.status].includes('completed')) {
      throw new Error(`Cannot complete run from ${current.snapshot.status}`)
    }
    await this.store.save({
      ...current,
      snapshot: {
        ...current.snapshot,
        status: 'completed',
        updatedAt: this.now().toISOString(),
        interactions: undefined,
        result,
      },
    })
  }
}
