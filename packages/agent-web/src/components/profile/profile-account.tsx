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

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@appica/ui-react/alert-dialog'
import { Button } from '@appica/ui-react/button'
import type { AuthUser } from '@/lib/api/client'

export interface ProfileAccountProps {
  user: AuthUser | null
  /** When the profile was first saved; the account may predate it. */
  createdAt?: string | undefined
  /** Absent on a server with accounts switched off. */
  onLogout?: (() => void) | undefined
  deleting: boolean
  onDelete: () => void
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return '—'
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
}

export function ProfileAccount({
  user,
  createdAt,
  onLogout,
  deleting,
  onDelete,
}: ProfileAccountProps) {
  return (
    <section id="profile-account" aria-labelledby="profile-account-title">
      <h2
        id="profile-account-title"
        className="text-foreground-strong text-[17px] font-semibold tracking-tight"
      >
        账户
      </h2>

      <dl className="bg-background shadow-md mt-3 rounded-md px-5 py-4">
        <div className="flex items-baseline gap-4 py-2">
          <dt className="text-foreground-muted w-20 shrink-0 text-sm">邮箱</dt>
          <dd className="text-foreground-strong min-w-0 flex-1 truncate text-sm">
            {user?.email ?? '未登录'}
          </dd>
        </div>
        <div className="flex items-baseline gap-4 py-2">
          <dt className="text-foreground-muted w-20 shrink-0 text-sm">
            档案建立
          </dt>
          <dd className="text-foreground-strong text-sm">
            {formatDate(createdAt)}
          </dd>
        </div>
        <div className="flex items-baseline gap-4 py-2">
          <dt className="text-foreground-muted w-20 shrink-0 text-sm">
            登录方式
          </dt>
          <dd className="text-foreground-strong text-sm">邮箱</dd>
        </div>
      </dl>

      <p className="text-foreground-muted mt-3 text-xs leading-relaxed">
        档案加密保存在服务器上，按账号隔离。退出登录不会删除它——删除是下面这个独立入口。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {onLogout ? (
          <Button variant="secondary" onClick={onLogout}>
            退出登录
          </Button>
        ) : null}

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" disabled={deleting}>
                {deleting ? '正在删除…' : '删除档案'}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除档案？</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              基础简历、求职偏好和常驻材料会一并删除，无法恢复。运行记录不受影响，
              账户也仍然保留——这是一次数据删除，不是注销账号。
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="secondary" />}>
                取消
              </AlertDialogClose>
              <Button variant="destructive" onClick={onDelete}>
                确认删除
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  )
}
