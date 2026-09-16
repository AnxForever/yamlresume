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

import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { describePreferences, type ScenarioPreset } from '@/lib/presets'

export interface PresetSelectProps {
  presets: ScenarioPreset[]
  value: string
  onChange: (id: string) => void
}

export function PresetSelect({ presets, value, onChange }: PresetSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxId = useId()
  const selected = presets.find((preset) => preset.id === value) ?? presets[0]

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) {
      // Without this the listbox unmounts while holding focus and the browser
      // drops it on <body>, stranding keyboard users at the top of the page.
      triggerRef.current?.focus()
    }
  }

  function openAtSelected() {
    const index = presets.findIndex((preset) => preset.id === selected?.id)
    setActiveIndex(index >= 0 ? index : 0)
    setOpen(true)
  }

  // `close` only touches refs and a state setter, so it is stable in practice;
  // depending on it directly would re-subscribe the listener every render.
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) {
      return undefined
    }
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        closeRef.current(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault()
        openAtSelected()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % presets.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + presets.length) % presets.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(presets.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const preset = presets[activeIndex]
      if (preset) {
        onChange(preset.id)
      }
      close(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }

  if (!selected) {
    return null
  }

  const SelectedIcon = selected.icon

  return (
    // The keydown handler is on the wrapper so it also covers the listbox
    // options, which are buttons that would otherwise swallow arrow keys.
    // biome-ignore lint/a11y/noStaticElementInteractions: composite listbox widget
    <div
      ref={ref}
      className="relative"
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : openAtSelected())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className="text-foreground hover:bg-[rgba(26,26,25,0.04)] flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors"
      >
        <SelectedIcon
          size={15}
          className="text-secondary-emphasis"
          aria-hidden="true"
        />
        <span>{selected.title}</span>
        <ChevronDown
          size={15}
          className={cx('transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        // A native <select> cannot render the icon + title + summary rows this
        // menu needs, so it is an explicit listbox of option buttons.
        // biome-ignore lint/a11y/useSemanticElements: rich custom listbox
        <div
          id={listboxId}
          role="listbox"
          aria-label="输出组合"
          className="bg-background shadow-xl absolute bottom-full right-0 z-10 mb-2 max-h-[360px] w-[320px] overflow-y-auto rounded-md p-2"
        >
          {presets.map((preset, index) => {
            const isSelected = preset.id === selected.id
            const isActive = index === activeIndex
            const Icon = preset.icon
            return (
              // biome-ignore lint/a11y/useSemanticElements: option inside a custom listbox
              <button
                key={preset.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                // Hovering with the mouse should move the keyboard cursor too,
                // so Enter acts on what the user is pointing at.
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(preset.id)
                  close(true)
                }}
                className={cx(
                  'flex w-full items-start gap-3 rounded-xs px-3 py-3 text-left transition-colors',
                  isSelected
                    ? 'bg-secondary-subtle'
                    : isActive
                      ? 'bg-[rgba(26,26,25,0.04)]'
                      : ''
                )}
              >
                <Icon
                  size={18}
                  className={cx(
                    'mt-0.5 shrink-0',
                    isSelected
                      ? 'text-secondary-emphasis'
                      : 'text-foreground-muted'
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span
                    className={cx(
                      'block text-sm font-medium',
                      isSelected
                        ? 'text-secondary-emphasis'
                        : 'text-foreground-strong'
                    )}
                  >
                    {preset.title}
                  </span>
                  <span className="text-foreground-muted mt-1 block text-xs leading-relaxed">
                    {describePreferences(preset.preferences)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
