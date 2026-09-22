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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import { Toggle } from '@appica/ui-react/toggle'
import { ToggleGroup } from '@appica/ui-react/toggle-group'
import type {
  OutputFormat,
  StylePresetID,
  TailorPreferences,
} from '@/lib/api/types'

export interface ProfilePreferencesProps {
  /** `null` means "follow the launcher's scenario preset". */
  preferences: TailorPreferences | null
  /** Styles this backend renders, straight from `GET /v1/capabilities`. */
  styleOptions: Array<{ id: string; label: string; description: string }>
  /** Formats this backend renders, straight from `GET /v1/capabilities`. */
  formatOptions: string[]
  onChange: (preferences: TailorPreferences | null) => void
}

function ChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: Array<{ id: string; label: string }>
  selected: string[]
  onToggle: (next: string[]) => void
}) {
  return (
    <ToggleGroup
      multiple
      value={selected}
      onValueChange={(next) => {
        // The backend schema requires at least one of each. Ignoring the
        // attempt to unpick the last one is clearer than accepting it and
        // failing validation two screens later.
        if (next.length > 0) {
          onToggle([...next])
        }
      }}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => (
        <Toggle
          key={option.id}
          value={option.id}
          className="border-border text-foreground data-pressed:bg-secondary-subtle data-pressed:text-secondary-emphasis data-pressed:border-secondary-emphasis rounded-full border px-3 py-1.5 text-xs transition-colors"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export function ProfilePreferences({
  preferences,
  styleOptions,
  formatOptions,
  onChange,
}: ProfilePreferencesProps) {
  const styleLabels = new Map(
    styleOptions.map((style) => [style.id, style.label])
  )

  if (!preferences) {
    return (
      <section id="profile-preferences" aria-labelledby="profile-title">
        <h2
          id="profile-title"
          className="text-foreground-strong text-[17px] font-semibold tracking-tight"
        >
          偏好
        </h2>
        <div className="bg-background shadow-md mt-3 rounded-md px-5 py-5">
          <p className="text-foreground-muted text-sm leading-relaxed">
            还没有默认输出偏好。新 Run 会使用输入台选中的场景预设。
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={styleOptions.length === 0 || formatOptions.length === 0}
            onClick={() =>
              onChange({
                styles: [styleOptions[0]?.id as StylePresetID],
                formats: formatOptions.slice(0, 3) as OutputFormat[],
              })
            }
          >
            设置默认偏好
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section id="profile-preferences" aria-labelledby="profile-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="profile-title"
          className="text-foreground-strong text-[17px] font-semibold tracking-tight"
        >
          偏好
        </h2>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          清除默认值
        </Button>
      </div>
      <p className="text-foreground-muted mt-1 text-xs leading-relaxed">
        新 Run 的默认值。输入台仍然可以当场改，这里只是省掉每次重选。
      </p>

      <div className="bg-background shadow-md mt-3 flex flex-col gap-5 rounded-md px-5 py-5">
        <Field>
          <FieldLabel>目标岗位</FieldLabel>
          <Input
            value={preferences.targetTitle ?? ''}
            maxLength={200}
            placeholder="例如 Agent 应用开发"
            onChange={(event) =>
              onChange({ ...preferences, targetTitle: event.target.value })
            }
          />
        </Field>

        <div className="flex flex-col gap-5 sm:flex-row">
          <Field className="flex-1">
            <FieldLabel>简历语言</FieldLabel>
            <Select
              value={preferences.language ?? 'zh'}
              onValueChange={(value) =>
                onChange({
                  ...preferences,
                  language: value === 'zh' ? undefined : String(value),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field className="flex-1">
            <FieldLabel>页数上限</FieldLabel>
            <Select
              value={String(preferences.maxPages ?? 0)}
              onValueChange={(value) =>
                onChange({
                  ...preferences,
                  maxPages:
                    value === '0' ? undefined : (Number(value) as 1 | 2),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">不限制</SelectItem>
                <SelectItem value="1">1 页</SelectItem>
                <SelectItem value="2">2 页</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel>默认样式</FieldLabel>
          <ChipGroup
            options={styleOptions}
            selected={preferences.styles}
            onToggle={(styles) =>
              onChange({ ...preferences, styles: styles as StylePresetID[] })
            }
          />
          <p className="text-foreground-subtle mt-2 text-xs leading-relaxed">
            {preferences.styles
              .map((style) => styleLabels.get(style) ?? style)
              .join('、')}
          </p>
        </Field>

        <Field>
          <FieldLabel>默认格式</FieldLabel>
          <ChipGroup
            options={formatOptions.map((format) => ({
              id: format,
              label: format,
            }))}
            selected={preferences.formats}
            onToggle={(formats) =>
              onChange({ ...preferences, formats: formats as OutputFormat[] })
            }
          />
        </Field>
      </div>
    </section>
  )
}
