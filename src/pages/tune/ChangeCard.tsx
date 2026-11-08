import { ArrowRight, Check, CircleAlert, FlaskConical, Loader2, Pencil, RotateCcw, Save, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import type { WriteItem } from '../../config/write'
import { useTune, type Proposal } from '../../ai/tune'
import { cx } from '../../lib/format'
import { useMotionBlock } from '../../state/motion'
import { useSession } from '../../state/session'
import { Button } from '../../ui/Primitives'
import { DemoPark } from '../config/LiveStrip'
import { WriteDialog } from '../config/WriteDialog'

const RISK = {
  low: { label: 'Low risk', cls: 'border-ok/40 text-ok' },
  medium: { label: 'Medium risk', cls: 'border-warn/40 text-warn' },
  high: { label: 'High risk', cls: 'border-danger/45 text-danger' },
} as const

const STATUS: Record<Proposal['status'], string | null> = {
  open: null,
  testing: 'Testing now',
  tested: 'Tested',
  applied: 'Saved',
  rejected: 'Rejected',
  reverted: 'Put back',
  failed: 'Not saved',
}

export function ChangeCard({ proposalId }: { proposalId: string }) {
  const p = useTune((s) => s.proposals[proposalId])
  const tune = useTune.getState
  const connected = useSession((s) => s.status === 'connected')
  const targets = p ? [...new Map(p.changes.map((c) => [c.deviceKey, c.target])).values()] : []
  const motion = useMotionBlock(connected ? targets : [], 'apply changes')
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<string[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [write, setWrite] = useState<{ mode: 'apply' | 'revert'; items: WriteItem[] } | null>(null)

  if (!p) return null
  const done = p.status === 'rejected' || p.status === 'reverted'
  const multi = new Set(p.changes.map((c) => c.deviceKey)).size > 1
  const blocked = !connected ? 'Connect to the controller to apply this.' : motion
  const risk = RISK[p.risk]

  const run = async (f: () => Promise<string | null>) => {
    setProblems([])
    setBusy(true)
    const err = await f()
    setBusy(false)
    if (err) setProblems([err])
  }
  const openWrite = (mode: 'apply' | 'revert') => {
    setProblems([])
    const plan = mode === 'apply' ? tune().applyPlan(p.id) : tune().revertPlan(p.id)
    if ('error' in plan) setProblems([plan.error])
    else setWrite({ mode, items: plan.items })
  }
  const startEdit = () => {
    setDrafts(p.changes.map((c) => String(c.newValue)))
    setProblems([])
    setEditing(true)
  }
  const saveEdit = () => {
    const values = drafts.map((d) => (d.trim() === '' ? NaN : Number(d.trim().replace(',', '.'))))
    const bad = values.flatMap((v, i) => (Number.isFinite(v) ? [] : [`${p.changes[i].label}: enter a number.`]))
    const errs = bad.length ? bad : (tune().edit(p.id, values) ?? [])
    setProblems(errs)
    if (!errs.length) setEditing(false)
  }
  const ask = () => void tune().send('How did that go? I just took a test ride with these changes.')

  return (
    <article className={cx('card overflow-hidden', done && 'opacity-60')} aria-label={`Proposed changes: ${p.summary}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="label text-[9.5px] text-accent">Proposed changes</div>
          <h3 className="mt-0.5 text-sm font-semibold">{p.summary}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {STATUS[p.status] && (
            <span className={cx('label inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px]', p.status === 'testing' ? 'border-accent/45 text-accent' : 'border-line-strong text-muted')}>
              {p.status === 'testing' && <FlaskConical className="size-3" />}
              {STATUS[p.status]}
            </span>
          )}
          <span className={cx('label inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px]', risk.cls)}>{risk.label}</span>
        </div>
      </header>

      <ul className="divide-y divide-line">
        {p.changes.map((c, i) => (
          <li key={`${c.deviceKey}|${c.param}`} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <span className="text-sm font-medium">{c.label}</span>
                {multi && <span className="text-xs text-muted"> · {c.deviceName}</span>}
                <div className="font-mono text-[11px] text-faint">
                  {c.param}
                  {c.live && <span className="ml-2 font-sans text-accent/80">live limit</span>}
                </div>
              </div>
              {editing ? (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{c.shownFrom}</span>
                  <ArrowRight className="size-3.5 text-faint" />
                  <input
                    value={drafts[i] ?? ''}
                    onChange={(e) => setDrafts((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
                    inputMode="decimal"
                    aria-label={`New value for ${c.label}, in the card's units (now ${c.shownTo})`}
                    className="num h-8 w-24 rounded-lg border border-line bg-surface-2 px-2 text-right outline-none focus:border-accent/60"
                  />
                  <span className="text-xs text-muted">{c.shownTo.replace(/^[-\d.,\s]+/, '')}</span>
                </label>
              ) : (
                <div className="num text-sm whitespace-nowrap">
                  <span className="text-muted">{c.shownFrom}</span>
                  <ArrowRight className="mx-1.5 inline size-3.5 text-faint" />
                  <span className="font-semibold text-accent">{c.shownTo}</span>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed">{c.reason}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              <span className="font-medium text-text/80">Trade-off: </span>
              {c.tradeoff}
            </p>
          </li>
        ))}
      </ul>

      {(p.note || problems.length > 0 || !done) && (
        <footer className="space-y-2.5 border-t border-line bg-surface-2/40 px-4 py-3">
          {p.note && !problems.length && <p className="text-xs text-muted">{p.note}</p>}
          {problems.length > 0 && (
            <ul className="space-y-1 text-xs text-danger" role="alert">
              {problems.map((x) => (
                <li key={x} className="flex gap-1.5">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {x}
                </li>
              ))}
            </ul>
          )}
          {!done && (
            <>
              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <Button variant="primary" className="h-9" onClick={saveEdit}>
                      <Check className="size-4" /> Check and keep
                    </Button>
                    <Button variant="ghost" className="h-9" onClick={() => (setEditing(false), setProblems([]))}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Actions
                    p={p}
                    busy={busy}
                    blocked={blocked}
                    onTest={() => void run(() => tune().startTest(p.id))}
                    onEnd={() => void run(() => tune().endTest())}
                    onApply={() => openWrite('apply')}
                    onRevert={() => openWrite('revert')}
                    onEdit={startEdit}
                    onReject={() => tune().reject(p.id)}
                    onAsk={ask}
                  />
                )}
              </div>
              {!editing && blocked && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-warn">{blocked}</p>
                  {motion && <DemoPark />}
                </div>
              )}
              {!editing && p.status === 'open' && !p.testable && (
                <p className="flex gap-1.5 text-xs text-muted">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  Test mode is only for live limits (current, power, speed and duty limits), which the controller holds in memory. This one changes a stored setting,
                  so it’s saved with a backup first and can be put back from this card.
                </p>
              )}
            </>
          )}
        </footer>
      )}

      {write && (
        <WriteDialog
          open
          onClose={() => setWrite(null)}
          fixedItems={write.items}
          onStart={() => tune().writeStarted(p.id, write.mode)}
          onFinished={(items, outcomes) => tune().writeFinished(p.id, write.mode, items, outcomes)}
        />
      )}
    </article>
  )
}

function Actions({
  p,
  busy,
  blocked,
  onTest,
  onEnd,
  onApply,
  onRevert,
  onEdit,
  onReject,
  onAsk,
}: {
  p: Proposal
  busy: boolean
  blocked: string | null
  onTest: () => void
  onEnd: () => void
  onApply: () => void
  onRevert: () => void
  onEdit: () => void
  onReject: () => void
  onAsk: () => void
}) {
  const spin = busy ? <Loader2 className="size-4 animate-spin" /> : null
  switch (p.status) {
    case 'open':
    case 'failed':
    case 'tested':
      return (
        <>
          {p.testable && (
            <Button variant={p.status === 'tested' ? 'secondary' : 'primary'} className="h-9" disabled={!!blocked || busy} onClick={onTest}>
              {spin ?? <FlaskConical className="size-4" />} {p.status === 'tested' ? 'Test again' : 'Apply as test mode'}
            </Button>
          )}
          <Button variant={p.testable && p.status !== 'tested' ? 'secondary' : 'primary'} className="h-9" disabled={!!blocked || busy} onClick={onApply}>
            <Save className="size-4" /> Apply permanently
          </Button>
          {p.status === 'open' && (
            <Button variant="ghost" className="h-9" disabled={busy} onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </Button>
          )}
          {p.status === 'tested' && (
            <Button variant="ghost" className="h-9" onClick={onAsk}>
              How did that go?
            </Button>
          )}
          <Button variant="ghost" className="h-9" disabled={busy} onClick={onReject}>
            <X className="size-4" /> Reject
          </Button>
        </>
      )
    case 'testing':
      return (
        <>
          <Button variant="primary" className="h-9" onClick={onAsk}>
            How did that go?
          </Button>
          <Button className="h-9" disabled={!!blocked || busy} onClick={onApply}>
            <Save className="size-4" /> Make permanent
          </Button>
          <Button variant="ghost" className="h-9" disabled={busy} onClick={onEnd}>
            {spin ?? <X className="size-4" />} End test
          </Button>
        </>
      )
    case 'applied':
      return (
        <Button className="h-9" disabled={!!blocked} onClick={onRevert}>
          <RotateCcw className="size-4" /> Put old values back
        </Button>
      )
    default:
      return null
  }
}
