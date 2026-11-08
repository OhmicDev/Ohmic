import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '../lib/format'

/** A modal built on <dialog>: focus is kept inside, Escape closes (unless `locked`). */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  locked = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** While true (e.g. a write is running) the dialog can't be dismissed. */
  locked?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const subtitleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        if (!locked) onClose()
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (e.target === e.currentTarget && !locked) onClose()
      }}
      className={cx(
        'm-auto max-h-[min(88dvh,860px)] w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-line-strong bg-surface p-0 text-text shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm',
        { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' }[size],
      )}
    >
      {open && (
        <div className="flex max-h-[min(88dvh,860px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="wide text-lg font-semibold">
                {title}
              </h2>
              {subtitle && (
                <div id={subtitleId} className="mt-0.5 text-sm text-muted">
                  {subtitle}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={locked}
              aria-label="Close"
              className="focus-ring -mr-1 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-30"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
