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

'use client'

import { Button } from '@appica/ui-react/button'
import { Field, FieldLabel } from '@appica/ui-react/field'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import { FileText, Link2, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProfileMaterial } from '@/lib/api/types'

export interface ProfileMaterialsProps {
  materials: ProfileMaterial[]
  maxMaterials: number
  onChange: (materials: ProfileMaterial[]) => void
}

interface EditorState {
  /** `null` while adding, the material's id while editing. */
  id: string | null
  kind: ProfileMaterial['kind']
  title: string
  value: string
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `material-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function ProfileMaterials({
  materials,
  maxMaterials,
  onChange,
}: ProfileMaterialsProps) {
  const [editor, setEditor] = useState<EditorState | null>(null)
  const atLimit = materials.length >= maxMaterials

  function openEditor(
    kind: ProfileMaterial['kind'],
    material?: ProfileMaterial
  ) {
    setEditor(
      material
        ? {
            id: material.id,
            kind: material.kind,
            title: material.title,
            value: material.value,
          }
        : { id: null, kind, title: '', value: '' }
    )
  }

  function commit() {
    if (!editor || editor.value.trim().length === 0) {
      return
    }
    const title = editor.title.trim() || editor.value.trim().slice(0, 60)
    if (editor.id) {
      onChange(
        materials.map((material) =>
          material.id === editor.id
            ? { ...material, title, value: editor.value }
            : material
        )
      )
    } else {
      onChange([
        ...materials,
        {
          id: newId(),
          kind: editor.kind,
          title,
          value: editor.value,
          createdAt: new Date().toISOString(),
        },
      ])
    }
    setEditor(null)
  }

  return (
    <section id="profile-materials" aria-labelledby="profile-materials-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="profile-materials-title"
          className="text-foreground-strong text-[17px] font-semibold tracking-tight"
        >
          材料
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={atLimit}
            onClick={() => openEditor('text')}
          >
            + 添加文本
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={atLimit}
            onClick={() => openEditor('link')}
          >
            + 添加链接
          </Button>
        </div>
      </div>

      <p className="text-foreground-muted mt-1 text-xs leading-relaxed">
        常驻在这里的补充材料，每份新简历都会带上，不用每次重新粘贴。
      </p>

      {editor ? (
        <div className="bg-background shadow-md mt-3 rounded-md px-5 py-4">
          <Field>
            <FieldLabel>
              {editor.kind === 'link' ? '链接标题' : '材料标题'}
            </FieldLabel>
            <Input
              value={editor.title}
              maxLength={200}
              placeholder={
                editor.kind === 'link' ? 'GitHub 主页' : '某项目的补充说明'
              }
              onChange={(event) =>
                setEditor({ ...editor, title: event.target.value })
              }
            />
          </Field>
          <Field className="mt-4">
            <FieldLabel>
              {editor.kind === 'link' ? '链接地址' : '内容'}
            </FieldLabel>
            {editor.kind === 'link' ? (
              <Input
                value={editor.value}
                maxLength={500}
                placeholder="https://"
                onChange={(event) =>
                  setEditor({ ...editor, value: event.target.value })
                }
              />
            ) : (
              <Textarea
                value={editor.value}
                rows={6}
                maxLength={20000}
                placeholder="用 Markdown 写清楚背景、你做了什么、结果如何。"
                onChange={(event) =>
                  setEditor({ ...editor, value: event.target.value })
                }
              />
            )}
          </Field>
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={editor.value.trim().length === 0}
              onClick={commit}
            >
              保存
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {materials.length === 0 && !editor ? (
        <p className="text-foreground-subtle bg-background shadow-md mt-3 rounded-md px-5 py-6 text-sm leading-relaxed">
          还没有常驻材料。项目说明、作品集链接这类内容放在这里，就不必每次重新粘贴。
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {materials.map((material) => (
            <li
              key={material.id}
              className="bg-background shadow-md flex items-start gap-3 rounded-md px-5 py-3"
            >
              <span
                className="text-foreground-muted mt-0.5 shrink-0"
                aria-hidden="true"
              >
                {material.kind === 'link' ? (
                  <Link2 size={16} />
                ) : (
                  <FileText size={16} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground-strong block truncate text-sm font-medium">
                  {material.title}
                </span>
                <span className="text-foreground-muted break-anywhere mt-0.5 line-clamp-2 block text-xs leading-relaxed">
                  {material.value}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`编辑 ${material.title}`}
                  onClick={() => openEditor(material.kind, material)}
                  className="text-foreground-muted hover:text-foreground-strong hover:bg-[var(--overlay-hover)] flex size-8 items-center justify-center rounded-full transition-colors"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${material.title}`}
                  onClick={() =>
                    onChange(
                      materials.filter((entry) => entry.id !== material.id)
                    )
                  }
                  className="text-foreground-muted hover:text-error-emphasis hover:bg-[var(--overlay-hover)] flex size-8 items-center justify-center rounded-full transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-foreground-subtle mt-3 text-xs leading-relaxed">
        这里只保存文本和链接。简历、证书这类文件每次运行时单独上传，不保存在账户里——
        与其承诺保存却做不到，不如先说清楚。
        {atLimit ? ` 已达上限 ${maxMaterials} 条。` : ''}
      </p>
    </section>
  )
}
