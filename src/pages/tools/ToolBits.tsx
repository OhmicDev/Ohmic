import { CircleAlert, Info, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/format'
import { BackLink } from '../../ui/Primitives'

/** The "← More" link above each tool page. */
export function BackToMore() {
  return <BackLink to="/more">More</BackLink>
}

/** A full-width message: a warning, an error or a success note. */
export function Banner({ tone, children, onClose, action }: { tone: 'warn' | 'danger' | 'ok' | 'info'; children: ReactNode; onClose?: () => void; action?: ReactNode }) {
  const cls = {
    warn: 'border-warn/30 bg-warn/5 text-warn',
    danger: 'border-danger/35 bg-danger/5 text-danger',
    ok: 'border-ok/30 bg-ok/5 text-ok',
    info: 'border-line-strong bg-surface-2 text-muted',
  }[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('mb-3 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm', cls)}>
      {tone === 'ok' || tone === 'info' ? <Info className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="focus-ring -m-1 rounded p-1 opacity-70 hover:opacity-100">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/** A step in progress, with a bar when the share done is known. */
export function Progress({ what, progress }: { what: string; progress: number | null }) {
  return (
    <div className="space-y-1.5" role="status">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> {what}
        {progress !== null && <span className="num">{Math.round(progress * 100)} %</span>}
      </div>
      {progress !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label={what}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  )
}
