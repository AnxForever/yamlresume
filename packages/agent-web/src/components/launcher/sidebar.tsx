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
  FileText,
  History,
  LayoutGrid,
  LogOut,
  Search,
  Settings,
  SquarePen,
  UserRound,
} from 'lucide-react'
import { useId, useState } from 'react'
import { Logo } from '@/components/brand/logo'
import { cx } from '@/lib/cx'

export type ShellView = 'new' | 'plaza' | 'runs' | 'profile'

interface NavItem {
  id: ShellView
  label: string
  icon: React.ReactNode
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'new', label: '新建定制', icon: <SquarePen size={18} /> },
  { id: 'plaza', label: '能力广场', icon: <LayoutGrid size={18} /> },
  { id: 'runs', label: '运行记录', icon: <History size={18} /> },
]

export interface RecentRun {
  id: string
  title: string
  subtitle: string
}

export interface SidebarProps {
  activeItem: ShellView
  recentRuns?: RecentRun[]
  onSelectItem: (id: ShellView) => void
  onSelectRun?: (id: string) => void
  onOpenSettings: () => void
  /** Omitted when the server has no accounts, hiding the sign-out control. */
  onLogout?: () => void
  /** Shown beside sign-out so the user knows which account is active. */
  userEmail?: string
}

export function Sidebar({
  activeItem,
  recentRuns = [],
  onSelectItem,
  onSelectRun,
  onOpenSettings,
  onLogout,
  userEmail,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const visibleRuns = normalizedQuery
    ? recentRuns.filter((run) =>
        `${run.title} ${run.subtitle}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery)
      )
    : recentRuns

  return (
    <aside className="bg-background-subtle shadow-xl flex h-full w-[288px] shrink-0 flex-col rounded-xl p-4">
      <div className="flex items-center px-2 pb-6 pt-2">
        <Logo />
      </div>

      <div className="mb-6 flex items-center gap-2 rounded-xs bg-[var(--overlay-subtle)] px-3 py-3">
        <Search
          size={18}
          className="text-foreground-muted"
          aria-hidden="true"
        />
        <label htmlFor={searchId} className="sr-only">
          搜索运行记录
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索运行记录"
          className="text-foreground-strong placeholder:text-foreground-muted w-full bg-transparent text-sm outline-none"
        />
      </div>

      <nav className="flex flex-col gap-1">
        {PRIMARY_NAV.map((item) => {
          const active = item.id === activeItem
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-xs px-3 py-3 text-[15px] transition-colors',
                active
                  ? 'bg-background text-foreground-strong shadow-md font-medium'
                  : 'text-foreground hover:bg-[var(--overlay-hover)]'
              )}
            >
              <span className="text-foreground">{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-8 flex min-h-0 flex-1 flex-col">
        <p className="text-foreground-muted px-3 pb-2 text-xs font-medium">
          运行记录
        </p>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {recentRuns.length === 0 ? (
            <p className="text-foreground-subtle px-3 py-2 text-xs leading-relaxed">
              还没有运行记录。完成第一次定制后会出现在这里（仅保存在本机）。
            </p>
          ) : visibleRuns.length === 0 ? (
            <p className="text-foreground-subtle px-3 py-2 text-xs leading-relaxed">
              没有匹配「{query.trim()}」的运行记录。
            </p>
          ) : (
            visibleRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelectRun?.(run.id)}
                className="text-foreground hover:bg-[var(--overlay-hover)] flex flex-col items-start gap-1 rounded-xs px-3 py-2 text-left transition-colors"
              >
                <span className="text-foreground-strong flex w-full items-center gap-2 text-sm">
                  <FileText
                    size={16}
                    className="text-foreground-muted shrink-0"
                  />
                  <span className="truncate">{run.title}</span>
                </span>
                <span className="text-foreground-muted w-full truncate pl-6 text-xs">
                  {run.subtitle}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="border-border mt-4 flex items-center gap-1 border-t px-1 pt-4">
        {/* The account row opens 个人主页. It used to sign the user out on a
            single click, which is the last thing anyone expects from their own
            name — signing out is now its own labelled control. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onSelectItem('profile')
          }}
          aria-current={activeItem === 'profile' ? 'page' : undefined}
          aria-label="个人主页"
          title={userEmail ? `已登录：${userEmail}` : '个人主页'}
          className={cx(
            'flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-2 text-left transition-colors',
            activeItem === 'profile'
              ? 'bg-background text-foreground-strong shadow-md'
              : 'text-foreground hover:bg-[var(--overlay-hover)]'
          )}
        >
          <span className="bg-foreground-strong text-background flex size-7 shrink-0 items-center justify-center rounded-full">
            <UserRound size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">个人主页</span>
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="设置"
          className="text-foreground-muted hover:text-foreground-strong hover:bg-[var(--overlay-hover)] flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
        >
          <Settings size={18} />
        </button>
        {/* Only rendered when the server actually has accounts: signing out of
            a server with auth disabled would 503 and bounce the user to a
            login screen that cannot work. */}
        {onLogout ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onLogout()
            }}
            aria-label="退出登录"
            title="退出登录"
            className="text-foreground-muted hover:text-foreground-strong hover:bg-[var(--overlay-hover)] flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <LogOut size={17} />
          </button>
        ) : null}
      </div>
    </aside>
  )
}
