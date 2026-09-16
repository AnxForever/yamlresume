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

import { Badge } from '@appica/ui-react/badge'

import { cx } from '@/lib/cx'

/**
 * App-level status tones mapped onto appica's badge variants so the whole app
 * shares one badge vocabulary. Only tones the product actually uses are
 * exposed.
 */
export type StatusBadgeTone = 'accent' | 'done' | 'warn' | 'fail' | 'mute'

const TONE_VARIANT: Record<StatusBadgeTone, string> = {
  accent: 'secondary',
  done: 'success',
  warn: 'warning',
  fail: 'error',
  mute: 'soft',
}

export interface StatusBadgeProps {
  tone: StatusBadgeTone
  children: React.ReactNode
  /** Renders a small leading dot; useful for live status. */
  dot?: boolean
  className?: string
}

export function StatusBadge({
  tone,
  children,
  dot = false,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant={TONE_VARIANT[tone] as never}
      className={cx('px-2 py-1 text-xs font-medium', className)}
    >
      {dot ? (
        <span className="size-2 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </Badge>
  )
}
