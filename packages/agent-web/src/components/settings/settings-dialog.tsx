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
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Field, FieldDescription, FieldLabel } from '@appica/ui-react/field'
import { Input } from '@appica/ui-react/input'
import { useEffect, useState } from 'react'

import { cx } from '@/lib/cx'
import {
  type AppSettings,
  clearLocalData,
  normalizeBaseUrl,
} from '@/lib/settings'

export interface SettingsDialogProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onSave: (settings: AppSettings) => void
}

export function SettingsDialog({
  open,
  settings,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    if (open) {
      setBaseUrl(settings.baseUrl)
      setCleared(false)
    }
  }, [open, settings.baseUrl])

  function handleSave() {
    onSave({ baseUrl: normalizeBaseUrl(baseUrl) })
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, _eventDetails) => {
        if (!next) {
          onClose()
        }
      }}
    >
      <DialogContent className="w-full max-w-[440px]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-5">
            <Field>
              <FieldLabel>后端地址</FieldLabel>
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="留空 = 与本站同源"
              />
              <FieldDescription>
                留空表示后端和本站由同一个地址提供（部署时的常见做法），此时无需配置。
                只有后端跑在别处时才需要填写，例如本地开发用的
                http://localhost:8787。API Key
                只在后端环境变量里配置，不会保存在浏览器。
              </FieldDescription>
            </Field>

            <div className="border-border border-t pt-5">
              <p className="text-foreground-strong text-sm font-medium">
                本地数据
              </p>
              <p className="text-foreground-muted mt-1 text-xs leading-relaxed">
                输入草稿和运行记录只保存在本机浏览器，不上云。清除后无法恢复。
              </p>
              <Button
                variant="soft"
                type="button"
                onClick={() => {
                  clearLocalData()
                  setCleared(true)
                }}
                className={cx('mt-3', cleared && 'text-success')}
              >
                {cleared ? '已清除本地数据' : '清除本地数据'}
              </Button>
              {/* The button's own label change is not announced on its own, and
                  success must not be conveyed by color alone. */}
              <output className="sr-only">
                {cleared ? '本地数据已清除' : ''}
              </output>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <DialogClose render={<Button variant="soft">取消</Button>} />
          <Button variant="primary" type="button" onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
