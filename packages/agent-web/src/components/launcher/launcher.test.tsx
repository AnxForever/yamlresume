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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  type LauncherSubmitPayload,
  LauncherView,
} from '@/components/launcher/launcher'
import type { AgentApiClient, ChatMessage } from '@/lib/api/client'

const CAPABILITIES = {
  kind: 'ready' as const,
  data: {
    output: {
      formats: ['yaml', 'html', 'pdf'],
      styles: [
        {
          id: 'ats-compact',
          label: 'ATS',
          description: '',
          template: 'jake',
        },
      ],
    },
  },
}

const RESUME = 'content:\n  basics:\n    name: 包安心\n'

function fakeClient(readyToGenerate = true): {
  client: AgentApiClient
  chat: ReturnType<typeof vi.fn>
} {
  const chat = vi.fn(
    async (_message: string, _history: ChatMessage[], _context?: string) => ({
      kind: 'ok' as const,
      data: { reply: '好，我来整理。', readyToGenerate },
    })
  )
  return { client: { chat } as unknown as AgentApiClient, chat }
}

/** Drive the two-step flow: talk to the agent, then generate. */
async function talkThenGenerate() {
  fireEvent.change(screen.getByLabelText('输入消息'), {
    target: { value: '帮我投这个岗位' },
  })
  fireEvent.click(screen.getByLabelText('发送消息'))
  await screen.findByText('好，我来整理。')
  fireEvent.click(screen.getByRole('button', { name: '根据对话生成简历' }))
}

function renderLauncher(
  overrides: {
    profileResume?: string
    profilePreferences?: Parameters<
      typeof LauncherView
    >[0]['profilePreferences']
    onSubmitRun?: (
      payload: LauncherSubmitPayload
    ) => Promise<{ kind: 'ok'; runId: string }>
  } = {}
) {
  const { client, chat } = fakeClient()
  const onSubmitRun = vi.fn(
    overrides.onSubmitRun ??
      (async () => ({ kind: 'ok' as const, runId: 'r1' }))
  )
  render(
    <LauncherView
      capabilities={CAPABILITIES}
      onSubmitRun={onSubmitRun}
      onSubmitted={vi.fn()}
      onRetryCapabilities={vi.fn()}
      onOpenSettings={vi.fn()}
      client={client}
      profileResume={overrides.profileResume ?? RESUME}
      profilePreferences={overrides.profilePreferences ?? null}
      onOpenProfile={vi.fn()}
    />
  )
  return { onSubmitRun, chat }
}

describe('LauncherView · profile as the run input', () => {
  it('sends the saved profile resume as the candidate', async () => {
    // Before this, the resume stored on the profile page reached the chat call
    // and nothing else, so every run started from the conversation alone and
    // the profile page was decoration.
    const { onSubmitRun } = renderLauncher()

    await talkThenGenerate()

    await waitFor(() => {
      expect(onSubmitRun).toHaveBeenCalledWith(
        expect.objectContaining({ candidateYaml: RESUME })
      )
    })
  })

  it('lets the user opt out for one run without touching the profile', async () => {
    const { onSubmitRun } = renderLauncher()

    fireEvent.click(screen.getByRole('button', { name: '这次不用' }))
    await talkThenGenerate()

    await waitFor(() => {
      expect(onSubmitRun).toHaveBeenCalledWith(
        expect.objectContaining({ candidateYaml: '' })
      )
    })
    // The choice is per-session; nothing here writes to the server.
    expect(screen.getByRole('button', { name: '改回使用' })).toBeDefined()
  })

  it('says so when the profile has no resume rather than silently sending none', () => {
    renderLauncher({ profileResume: '   ' })

    expect(screen.getByText(/档案里还没有基础简历/)).toBeDefined()
    expect(screen.getByRole('button', { name: '去个人主页添加' })).toBeDefined()
  })

  it('prefers the saved preferences over the preset defaults', async () => {
    const preferences = {
      styles: ['ats-compact' as const],
      formats: ['pdf' as const],
      targetTitle: 'Agent 开发',
    }
    const { onSubmitRun } = renderLauncher({ profilePreferences: preferences })

    await talkThenGenerate()

    await waitFor(() => {
      expect(onSubmitRun).toHaveBeenCalledWith(
        expect.objectContaining({ preferences })
      )
    })
  })

  it('falls back to the preset when the profile sets no preferences', async () => {
    const { onSubmitRun } = renderLauncher({ profilePreferences: null })

    await talkThenGenerate()

    await waitFor(() => {
      const payload = onSubmitRun.mock.calls[0]?.[0] as LauncherSubmitPayload
      expect(payload.preferences.styles.length).toBeGreaterThan(0)
      expect(payload.preferences.formats.length).toBeGreaterThan(0)
    })
  })
})
