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

import { ProfilePreferences } from '@/components/profile/profile-preferences'
import type { TailorPreferences } from '@/lib/api/types'

const STYLE_OPTIONS = [
  { id: 'ats-compact', label: 'ATS 紧凑', description: '' },
  { id: 'developer-two-column', label: '双栏技术', description: '' },
]
const FORMAT_OPTIONS = ['yaml', 'html', 'pdf']

const PREFERENCES: TailorPreferences = {
  styles: ['ats-compact'],
  formats: ['yaml', 'pdf'],
  targetTitle: 'Agent 开发',
  maxPages: 1,
}

function renderPreferences(preferences: TailorPreferences | null) {
  const onChange = vi.fn()
  render(
    <ProfilePreferences
      preferences={preferences}
      styleOptions={STYLE_OPTIONS}
      formatOptions={FORMAT_OPTIONS}
      onChange={onChange}
    />
  )
  return { onChange }
}

describe('ProfilePreferences', () => {
  it('explains what happens when no default is set', () => {
    renderPreferences(null)

    expect(screen.getByText(/还没有默认输出偏好/)).toBeDefined()
    expect(screen.getByText(/使用输入台选中的场景预设/)).toBeDefined()
  })

  it('seeds a default from the options the backend offers', () => {
    // Options come from `GET /v1/capabilities`; nothing here may be invented,
    // so the seed has to be drawn from that same list.
    const { onChange } = renderPreferences(null)

    fireEvent.click(screen.getByRole('button', { name: '设置默认偏好' }))

    expect(onChange).toHaveBeenCalledWith({
      styles: ['ats-compact'],
      formats: ['yaml', 'html', 'pdf'],
    })
  })

  it('shows the current values and lets them be cleared', () => {
    const { onChange } = renderPreferences(PREFERENCES)

    expect(screen.getByLabelText('目标岗位')).toHaveProperty(
      'value',
      'Agent 开发'
    )

    fireEvent.click(screen.getByRole('button', { name: '清除默认值' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('adds a style the backend supports', () => {
    const { onChange } = renderPreferences(PREFERENCES)

    fireEvent.click(screen.getByRole('button', { name: '双栏技术' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        styles: ['ats-compact', 'developer-two-column'],
      })
    )
  })

  it('refuses to unpick the last style or format', () => {
    // The backend schema requires at least one of each. Accepting the click
    // and failing validation later would be a worse answer than doing nothing.
    const { onChange } = renderPreferences({
      styles: ['ats-compact'],
      formats: ['yaml'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'ATS 紧凑' }))
    fireEvent.click(screen.getByRole('button', { name: 'yaml' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('allows unpicking one of several', () => {
    // Only the *last* one is protected; dropping one of two is an ordinary edit.
    const { onChange } = renderPreferences({
      styles: ['ats-compact'],
      formats: ['yaml', 'html', 'pdf'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'html' }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ formats: ['yaml', 'pdf'] })
    )
  })

  it('says the launcher can still override these', () => {
    renderPreferences(PREFERENCES)

    expect(screen.getByText(/输入台仍然可以当场改/)).toBeDefined()
  })
})
