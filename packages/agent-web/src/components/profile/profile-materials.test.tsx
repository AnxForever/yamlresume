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

import { ProfileMaterials } from '@/components/profile/profile-materials'
import type { ProfileMaterial } from '@/lib/api/types'

const TEXT_MATERIAL: ProfileMaterial = {
  id: 'm1',
  kind: 'text',
  title: '项目说明',
  value: '用 FastAPI 实现了检索服务。',
  createdAt: '2026-09-16T12:00:00.000Z',
}

function renderMaterials(materials: ProfileMaterial[] = [], maxMaterials = 50) {
  const onChange = vi.fn()
  render(
    <ProfileMaterials
      materials={materials}
      maxMaterials={maxMaterials}
      onChange={onChange}
    />
  )
  return { onChange }
}

describe('ProfileMaterials', () => {
  it('says what the empty state is for', () => {
    renderMaterials()

    expect(screen.getByText(/还没有常驻材料/)).toBeDefined()
  })

  it('adds a text material with what the user typed', () => {
    const { onChange } = renderMaterials()

    fireEvent.click(screen.getByRole('button', { name: '+ 添加文本' }))
    fireEvent.change(screen.getByLabelText('材料标题'), {
      target: { value: '检索服务' },
    })
    fireEvent.change(screen.getByLabelText('内容'), {
      target: { value: '用 FastAPI 实现了检索服务。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'text',
        title: '检索服务',
        value: '用 FastAPI 实现了检索服务。',
      }),
    ])
  })

  it('derives a title when the user leaves it blank', () => {
    // A missing title is display text only; deriving one beats an empty row.
    const { onChange } = renderMaterials()

    fireEvent.click(screen.getByRole('button', { name: '+ 添加链接' }))
    fireEvent.change(screen.getByLabelText('链接地址'), {
      target: { value: 'https://github.com/example' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'https://github.com/example' }),
    ])
  })

  it('refuses to save an empty material', () => {
    const { onChange } = renderMaterials()

    fireEvent.click(screen.getByRole('button', { name: '+ 添加文本' }))

    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty(
      'disabled',
      true
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces only the edited entry', () => {
    const other: ProfileMaterial = {
      ...TEXT_MATERIAL,
      id: 'm2',
      title: '另一条',
    }
    const { onChange } = renderMaterials([TEXT_MATERIAL, other])

    fireEvent.click(screen.getByRole('button', { name: '编辑 项目说明' }))
    fireEvent.change(screen.getByLabelText('内容'), {
      target: { value: '改过的内容' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'm1', value: '改过的内容' }),
      other,
    ])
  })

  it('deletes the entry the button belongs to', () => {
    const other: ProfileMaterial = {
      ...TEXT_MATERIAL,
      id: 'm2',
      title: '另一条',
    }
    const { onChange } = renderMaterials([TEXT_MATERIAL, other])

    fireEvent.click(screen.getByRole('button', { name: '删除 项目说明' }))

    expect(onChange).toHaveBeenCalledWith([other])
  })

  it('stops offering new entries at the server’s limit', () => {
    renderMaterials([TEXT_MATERIAL], 1)

    expect(screen.getByRole('button', { name: '+ 添加文本' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.getByText(/已达上限 1 条/)).toBeDefined()
  })

  it('is explicit that uploaded files are not kept', () => {
    // The backend genuinely does not store them, so the page must not imply a
    // file library exists.
    renderMaterials()

    expect(screen.getByText(/不保存在账户里/)).toBeDefined()
  })
})
