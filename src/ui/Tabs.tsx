// A row of tabs. The chosen one is marked by a bar (or a pill) that slides
// between them. When they don't fit, the row scrolls sideways, fades at the
// edge that has more, and keeps the chosen tab in view.

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../lib/format'
import { haptic } from './haptics'

export interface TabItem<T extends string> {
  id: T
  label: string
  /** A count beside the name, such as unsaved changes. */
  count?: number
  /** What the count means, read out after it ("changed"). */
  countLabel?: string
}

type Look = 'line' | 'pill' | 'segment'

interface Props<T extends string> {
  label: string
  tabs: TabItem<T>[]
  /** null when none is chosen, such as while search results show. */
  value: T | null
  onChange: (id: T) => void
  /** line: underlined, for the main row. pill: for a row under it. segment: boxed, like a switch. */
  look?: Look
  /** The id of each tab's element, so the panel can say which tab names it. */
  tabId: (id: T) => string
  /** The panel the tabs show, when there is one. */
  panelId?: string
  className?: string
}

const tabClass: Record<Look, string> = {
  line: 'h-11 px-3 text-[14px]',
  pill: 'h-8 rounded-full px-3 text-[13px]',
  segment: 'h-8 rounded-md px-3 text-[13px] md:h-7',
}

const markClass: Record<Look, string> = {
  line: 'bottom-0 h-[2px] rounded-full bg-accent',
  pill: 'inset-y-0 rounded-full bg-surface-3 shadow-[0_1px_2px_rgb(0_0_0/0.25),inset_0_0_0_1px_var(--color-line-strong)]',
  segment: 'inset-y-0 rounded-md bg-surface-3 shadow-[0_1px_2px_rgb(0_0_0/0.25),inset_0_0_0_1px_var(--color-line-strong)]',
}

export function Tabs<T extends string>({ label, tabs, value, onChange, look = 'line', tabId, panelId, className }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  // Where the marker sits; it only slides once it has been placed, so it doesn't fly in from the left.
  const [mark, setMark] = useState<{ x: number; w: number; slide: boolean } | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  // The first time, the row jumps straight to the chosen tab; after that it glides.
  const shown = useRef(false)

  const checkEdges = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  // Widths change with the counts, so they're part of what moves the marker.
  const shape = tabs.map((t) => `${t.id}:${t.label}:${t.count ?? ''}`).join('|')

  useLayoutEffect(() => {
    const el = scroller.current
    const inner = row.current
    if (!el || !inner) return
    const place = (scroll: boolean) => {
      const on = value === null ? null : inner.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`)
      setMark((m) => {
        if (!on) return null
        const next = { x: on.offsetLeft, w: on.offsetWidth, slide: m !== null }
        return m && m.x === next.x && m.w === next.w ? m : next
      })
      if (on && scroll) {
        const left = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2
        el.scrollTo({ left: Math.max(0, left), behavior: shown.current ? 'smooth' : 'auto' })
        shown.current = true
      }
      checkEdges()
    }
    place(true)
    // Fonts arriving and the screen turning both change the widths.
    const ro = new ResizeObserver(() => place(false))
    ro.observe(el)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [value, shape, checkEdges])

  const pick = (id: T) => {
    if (id === value) return
    haptic(5)
    onChange(id)
  }

  const onKey = (e: KeyboardEvent) => {
    const ids = tabs.map((t) => t.id)
    const at = ids.indexOf((e.target as HTMLElement).dataset.tab as T)
    if (at < 0) return
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = ids[(to + ids.length) % ids.length]
    pick(next)
    row.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next)}"]`)?.focus()
  }

  // The tab reached with the Tab key: the chosen one, or the first while none is.
  const focusable = value !== null && tabs.some((t) => t.id === value) ? value : tabs[0]?.id
  const fade = `linear-gradient(to right, ${edges.left ? 'transparent' : 'black'}, black 28px, black calc(100% - 28px), ${edges.right ? 'transparent' : 'black'})`

  return (
    <div
      ref={scroller}
      onScroll={checkEdges}
      className={cx(
        'overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        look === 'segment' && 'inline-flex max-w-full rounded-lg border border-line bg-surface-2 p-0.5',
        className,
      )}
      style={edges.left || edges.right ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
    >
      <div ref={row} role="tablist" aria-label={label} onKeyDown={onKey} className={cx('relative flex w-max', look === 'line' ? 'min-w-full' : 'gap-0.5')}>
        {mark && (
          <span
            aria-hidden
            className={cx(
              'pointer-events-none absolute left-0',
              markClass[look],
              mark.slide && 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
            )}
            style={{ transform: `translateX(${mark.x}px)`, width: mark.w }}
          />
        )}
        {tabs.map((t) => {
          const on = t.id === value
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(t.id)}
              data-tab={t.id}
              aria-selected={on}
              aria-controls={on ? panelId : undefined}
              tabIndex={t.id === focusable ? 0 : -1}
              onClick={() => pick(t.id)}
              className={cx(
                'relative flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap outline-none transition-colors duration-200 select-none',
                'focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-inset',
                look === 'line' && 'rounded-md',
                tabClass[look],
                on ? 'text-text' : 'text-muted hover:text-text',
              )}
            >
              {t.label}
              {!!t.count && (
                <span className="num min-w-[18px] rounded-full bg-accent/18 px-1.5 text-center text-[11px] leading-[18px] font-semibold text-accent">
                  {t.count}
                  {t.countLabel && <span className="sr-only"> {t.countLabel}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
