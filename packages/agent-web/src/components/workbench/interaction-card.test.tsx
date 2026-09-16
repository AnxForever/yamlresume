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

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type AnswerPayload,
  InteractionCard,
} from '@/components/workbench/interaction-card'
import type { InteractionRequest } from '@/lib/api/types'

function request(
  overrides: Partial<InteractionRequest> = {}
): InteractionRequest {
  return {
    id: 'q1',
    field: 'content.basics.name',
    prompt: '你的姓名是什么？',
    reason: '简历缺少姓名',
    required: true,
    severity: 'blocking',
    privacy: 'standard',
    control: { type: 'text', minLength: 1, maxLength: 500 },
    ...overrides,
  }
}

function renderCard(
  req: InteractionRequest,
  onSubmit: ReturnType<typeof vi.fn<(payload: AnswerPayload) => void>> = vi.fn()
) {
  render(
    <InteractionCard
      request={req}
      submitting={false}
      answerError={null}
      onSubmit={onSubmit}
    />
  )
  return onSubmit
}

describe('InteractionCard', () => {
  it('shows the question, reason and target field', () => {
    renderCard(request())

    expect(screen.getByText('你的姓名是什么？')).toBeTruthy()
    expect(screen.getByText(/为什么问：简历缺少姓名/)).toBeTruthy()
    expect(screen.getByText('content.basics.name')).toBeTruthy()
  })

  it('submits a text answer with the interaction id', () => {
    const onSubmit = renderCard(request())

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ada Lovelace' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'q1',
      idempotencyKey: expect.any(String),
      value: 'Ada Lovelace',
    })
  })

  it('reuses the same idempotency key across retries of one question', () => {
    const onSubmit = renderCard(request())

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ada' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit).toHaveBeenCalledTimes(2)
    const first = onSubmit.mock.calls[0]?.[0]
    const second = onSubmit.mock.calls[1]?.[0]
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
  })

  it('keeps the submit disabled until the text meets minLength', () => {
    renderCard(request())

    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' ' } })
    expect(
      (screen.getByRole('button', { name: '提交' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it('submits a single choice immediately on click', () => {
    const onSubmit = renderCard(
      request({
        control: {
          type: 'single_choice',
          options: [
            { value: '2022-09', label: '2022-09 至今', recommended: true },
            { value: 'custom', label: '自己填写' },
          ],
          allowCustom: true,
        },
      })
    )

    fireEvent.click(screen.getByRole('button', { name: /2022-09 至今/ }))

    expect(onSubmit).toHaveBeenCalledWith({
      interactionId: 'q1',
      idempotencyKey: expect.any(String),
      value: '2022-09',
    })
  })

  it('submits the explicit confirm button with true', () => {
    const onSubmit = renderCard(
      request({
        prompt: '确认把这个时间写进简历？',
        control: { type: 'confirm', confirmLabel: '确认写入' },
      })
    )

    fireEvent.click(screen.getByRole('button', { name: '确认写入' }))

    expect(onSubmit.mock.calls[0]?.[0].value).toBe(true)
  })

  it('requires at least minSelections before a multi choice can finish', () => {
    const onSubmit = renderCard(
      request({
        control: {
          type: 'multi_choice',
          options: [
            { value: 'fastapi', label: 'FastAPI' },
            { value: 'postgres', label: 'PostgreSQL' },
          ],
          allowCustom: false,
          minSelections: 1,
          maxSelections: 2,
        },
      })
    )

    expect(
      (screen.getByRole('button', { name: '提交' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /FastAPI/ }))
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    expect(onSubmit.mock.calls[0]?.[0].value).toEqual(['fastapi'])
  })

  it('explains an unknown control type and offers a way out', () => {
    const req = request({
      control: { type: 'some_future_control' } as never,
    })
    const onStartNew = vi.fn()
    render(
      <InteractionCard
        request={req}
        submitting={false}
        answerError={null}
        onSubmit={vi.fn()}
        onStartNew={onStartNew}
      />
    )

    expect(screen.getByText(/some_future_control/)).toBeTruthy()
    // The run cannot resume without this answer, so the card must not be a
    // dead end — it has to offer an escape.
    fireEvent.click(
      screen.getByRole('button', { name: '带上材料重新发起一次' })
    )
    expect(onStartNew).toHaveBeenCalled()
  })

  it('explains a file control it cannot answer and offers a way out', () => {
    const req = request({
      control: {
        type: 'file',
        acceptedMediaTypes: ['application/pdf'],
        maxFiles: 1,
      },
    })
    const onStartNew = vi.fn()
    render(
      <InteractionCard
        request={req}
        submitting={false}
        answerError={null}
        onSubmit={vi.fn()}
        onStartNew={onStartNew}
      />
    )

    expect(screen.getByText(/需要上传文件/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: '带上材料重新发起一次' })
    )
    expect(onStartNew).toHaveBeenCalled()
  })

  it('says why submit is blocked for a minLength text control', () => {
    renderCard(
      request({ control: { type: 'text', minLength: 10, maxLength: 500 } })
    )

    // Nothing typed yet: the counter gives way to the actual requirement.
    expect(screen.getByText('至少 10 字')).toBeTruthy()

    // Still short of the minimum, so the requirement stays visible.
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '六个字不够' },
    })
    expect(screen.getByText('至少 10 字')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '这段文字的长度肯定超过十个字了' },
    })
    expect(screen.queryByText('至少 10 字')).toBeNull()
  })

  it('says the allowed range for a blocked number control', () => {
    renderCard(
      request({
        control: { type: 'number', min: 0, max: 40, integer: true },
      })
    )

    expect(screen.getByText('请输入 0–40 的整数')).toBeTruthy()
  })

  it('never treats an empty number field as a valid answer', () => {
    const onSubmit = renderCard(
      request({
        // min: 0 is the trap — `Number('')` is 0 and would look in range.
        control: { type: 'number', min: 0, max: 40, integer: true },
      })
    )

    const submit = screen.getByRole('button', {
      name: '提交',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } })
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    expect(onSubmit.mock.calls[0]?.[0].value).toBe(5)
  })

  it('says how many selections are still needed for a blocked multi choice', () => {
    renderCard(
      request({
        control: {
          type: 'multi_choice',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
          allowCustom: false,
          minSelections: 2,
          maxSelections: 2,
        },
      })
    )

    expect(screen.getByText(/至少选 2 项/)).toBeTruthy()
  })

  it('renders a privacy hint for sensitive fields', () => {
    renderCard(request({ privacy: 'sensitive' }))

    expect(screen.getByText(/不保存在浏览器/)).toBeTruthy()
  })

  it('names the input from the prompt for assistive tech', () => {
    renderCard(request())

    const textbox = screen.getByRole('textbox')
    const labelledBy = textbox.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      '你的姓名是什么？'
    )
  })

  it('groups the card under the prompt', () => {
    renderCard(request())

    const group = screen.getByRole('group')
    const labelledBy = group.getAttribute('aria-labelledby')
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      '你的姓名是什么？'
    )
  })
})
