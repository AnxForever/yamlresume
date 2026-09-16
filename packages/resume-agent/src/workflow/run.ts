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

import { randomUUID } from 'node:crypto'

import type {
  AgentRunStatus,
  ResumeAgentRun,
  TailorResumeRequest,
  TailorResumeResult,
} from '@/contracts'
import type { ResumeTailoringAgent } from '@/workflow/agent'

export interface RunStore {
  get(id: string): Promise<ResumeAgentRun | undefined>
  save(run: ResumeAgentRun): Promise<void>
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, ResumeAgentRun>()

  async get(id: string): Promise<ResumeAgentRun | undefined> {
    const run = this.runs.get(id)
    return run ? structuredClone(run) : undefined
  }

  async save(run: ResumeAgentRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run))
  }
}

type ScheduledTask = () => Promise<void>

const NEXT_STATUS: Record<AgentRunStatus, AgentRunStatus[]> = {
  queued: ['ingesting_inputs', 'failed'],
  ingesting_inputs: ['normalizing_candidate', 'failed'],
  normalizing_candidate: ['analyzing_jd', 'failed'],
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
    await this.store.save(run)
    this.schedule(() => this.execute(run.id, request))
    return run
  }

  async get(id: string): Promise<ResumeAgentRun | undefined> {
    return this.store.get(id)
  }

  private async execute(
    id: string,
    request: TailorResumeRequest
  ): Promise<void> {
    try {
      const result = await this.agent.run(request, {
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
    if (!NEXT_STATUS[current.status].includes(status)) {
      throw new Error(
        `Invalid run transition from ${current.status} to ${status}`
      )
    }
    await this.store.save({
      ...current,
      status,
      updatedAt: this.now().toISOString(),
    })
  }

  private async fail(id: string): Promise<void> {
    const current = await this.store.get(id)
    if (!current || !NEXT_STATUS[current.status].includes('failed')) return
    await this.store.save({
      ...current,
      status: 'failed',
      updatedAt: this.now().toISOString(),
      error: {
        code: 'agent_run_failed',
        message: 'The resume tailoring run failed.',
      },
    })
  }

  private async finish(id: string, result: TailorResumeResult): Promise<void> {
    const current = await this.store.get(id)
    if (!current) return
    if (!NEXT_STATUS[current.status].includes('completed')) {
      throw new Error(`Cannot complete run from ${current.status}`)
    }
    await this.store.save({
      ...current,
      status: 'completed',
      updatedAt: this.now().toISOString(),
      result,
    })
  }
}
