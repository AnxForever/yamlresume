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

import { cx } from '@/lib/cx'

/**
 * Brand mark: an ascending path with a node, set in a soft rounded tile.
 *
 * The glyph reads as a career-growth trajectory; the squircle tile in a light
 * accent wash keeps it from looking like a heavy solid avatar. Monochrome via
 * currentColor so it adapts to context.
 */
export function LogoMark({
  size = 40,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      className={cx(
        'bg-secondary-subtle text-secondary-emphasis inline-flex items-center justify-center rounded-[28%]',
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="Career Agent"
      >
        <title>Career Agent</title>
        <path d="M3.5 16.5 10 10l4 3.2L20.5 6" />
        <circle cx="20.5" cy="6" r="1.7" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}

/**
 * Full lockup: mark plus wordmark, for the sidebar header.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={30} />
      <span className="text-foreground-strong text-[17px] font-semibold tracking-tight">
        Career Agent
      </span>
    </span>
  )
}
