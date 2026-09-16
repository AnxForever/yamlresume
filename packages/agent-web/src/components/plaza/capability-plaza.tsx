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

import { StatusBadge } from '@/components/ui/status-badge'
import {
  CAPABILITIES,
  CAPABILITY_STATUS_META,
  type Capability,
  isUsable,
} from '@/lib/capabilities'
import { cx } from '@/lib/cx'

interface CapabilityCardProps {
  capability: Capability
  onOpen?: (id: string) => void
}

function CapabilityCard({ capability, onOpen }: CapabilityCardProps) {
  const meta = CAPABILITY_STATUS_META[capability.status]
  const usable = isUsable(capability)
  const Icon = capability.icon

  return (
    <article
      className={cx(
        'bg-background shadow-md flex flex-col rounded-md p-5 transition-shadow',
        usable && 'hover:shadow-xl'
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span
          className={cx(
            'flex size-10 items-center justify-center rounded-[12px]',
            usable
              ? 'bg-secondary-subtle text-secondary-emphasis'
              : 'bg-[rgba(26,26,25,0.05)] text-foreground-muted'
          )}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="flex items-center gap-2">
          <span className="text-foreground-subtle text-xs font-medium">
            {capability.tier}
          </span>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
      </div>

      <h3 className="text-foreground-strong text-base font-semibold">
        {capability.title}
      </h3>
      <p className="text-foreground mt-1 text-sm leading-relaxed">
        {capability.summary}
      </p>

      <ul className="mt-3 flex flex-1 flex-col gap-1.5">
        {capability.highlights.map((highlight) => (
          <li
            key={highlight}
            className="text-foreground-muted flex gap-2 text-xs leading-relaxed"
          >
            <span className="text-foreground-subtle mt-1.5 size-1 shrink-0 rounded-full bg-current" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {usable ? (
          <button
            type="button"
            onClick={() => onOpen?.(capability.id)}
            className="text-secondary-emphasis hover:bg-secondary-subtle -ml-2 rounded-xs px-2 py-1 text-sm font-medium transition-colors"
          >
            开始使用 →
          </button>
        ) : (
          <span className="text-foreground-subtle text-xs">敬请期待</span>
        )}
      </div>
    </article>
  )
}

export interface CapabilityPlazaProps {
  onOpenCapability?: (id: string) => void
}

export function CapabilityPlaza({ onOpenCapability }: CapabilityPlazaProps) {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-10 pt-[10vh] pb-12">
      <header className="mb-8">
        <h1 className="text-foreground-strong text-[24px] font-semibold tracking-tight">
          能力广场
        </h1>
        <p className="text-foreground mt-2 max-w-[640px] text-[15px] leading-relaxed">
          Career Agent
          的长期目标是覆盖求职与职业成长全过程。下面是完整的能力地图——
          现在能用的、正在开发的、以及已经规划但尚未开始的。我们只把真正可用的能力
          标为可用，其余诚实标注状态。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((capability) => (
          <CapabilityCard
            key={capability.id}
            capability={capability}
            onOpen={onOpenCapability}
          />
        ))}
      </div>

      <p className="text-foreground-subtle mt-8 text-xs leading-relaxed">
        能力地图对应产品路线图 RP-000 至 RP-006。每一项进入开发前都会拆成独立的
        Feature Brief、验收标准和 Eval，不会用一个大 Prompt 假装完成所有任务。
      </p>
    </div>
  )
}
