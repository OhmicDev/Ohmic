import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Check, CircleAlert, Loader2, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import type { ConfigKind } from '../../config/types'
import type { WriteItem, WriteOutcome } from '../../config/write'
import { cx } from '../../lib/format'
import { useConfig } from '../../state/config'
import { useMotionBlock } from '../../state/motion'
import { planWrite, planWriteEach, runWrites, shareTargets, type WriteProgress } from '../../state/writes'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'
import { describeValue } from './describe'
import { DemoPark } from './LiveStrip'

const STEP_TEXT: Record<WriteProgress['step'], string> = {
  waiting: 'Waiting',
  checking: 'Checking current settings',
  backup: 'Saving a backup',
  writing: 'Writing to the controller',
  verifying: 'Reading back to verify',
  done: 'Done',
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const kindWord = (k: ConfigKind) => (k === 'mcconf' ? 'motor' : 'app')
const itemWord = (i: WriteItem) => i.custom?.label ?? kindWord(i.kind)

function ChangeTable({ item }: { item: WriteItem }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-sm">
        <tbody>
          {item.changes.map((c) => {
            const p = item.defs.params[c.name]
            return (
              <tr key={c.name} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 align-top">
                  <div className="font-medium">{p.label}</div>
                  <div className="font-mono text-[11px] text-faint">{c.name}</div>
                </td>
                <td className="num px-3 py-2 text-right align-top whitespace-nowrap">
                  <span className="text-muted">{describeValue(p, c.from)}</span>
                  <ArrowRight className="mx-1.5 inline size-3.5 text-faint" />
                  <span className="font-semibold text-accent">{describeValue(p, c.to)}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OutcomeView({ item, outcome }: { item: WriteItem; outcome: WriteOutcome }) {
  const p = (n: string) => item.defs.params[n]
  switch (outcome.status) {
    case 'ok':
      return (
        <p className="flex items-center gap-2 text-sm text-ok">
          <Check className="size-4" /> Written and verified: the controller holds exactly what you reviewed.
        </p>
      )
    case 'adjusted':
      return (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 text-warn">
            <AlertTriangle className="size-4" /> Written, but the controller stored {plural(outcome.adjusted.length, 'value')} differently.
          </p>
          <ul className="space-y-1 rounded-xl border border-warn/30 bg-warn/5 p-3">
            {outcome.adjusted.map((a) => (
              <li key={a.name}>
                <span className="font-medium">{p(a.name)?.label ?? a.name}</span>: asked for {describeValue(p(a.name), a.wanted)}, it kept{' '}
                <span className="font-semibold">{describeValue(p(a.name), a.got)}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted">
            This usually means the hardware can’t go that far (its limits are built into the firmware), or the value is set by
            calibration. The editor now shows what the controller actually has.
          </p>
        </div>
      )
    case 'stale':
      return (
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2 text-warn">
            <AlertTriangle className="size-4" /> Nothing was written: {plural(outcome.changedOnDevice.length, 'setting')} changed on the controller
            since they were read.
          </p>
          <p className="text-muted">
            Your edits are kept on top of the controller’s new values ({outcome.changedOnDevice.map((n) => p(n)?.label ?? n).join(', ')}). Review
            them and write again.
          </p>
        </div>
      )
    case 'failed':
      return (
        <p className="flex items-start gap-2 text-sm text-danger">
          <X className="mt-0.5 size-4 shrink-0" /> {outcome.error}
        </p>
      )
  }
}

export function WriteDialog({
  open,
  onClose,
  deviceKey = '',
  kind = 'mcconf',
  deviceKeys,
  fixedItems,
  onStart,
  onFinished,
}: {
  open: boolean
  onClose: () => void
  deviceKey?: string
  kind?: ConfigKind
  /** Write each of these controllers' own edits (no "also write" choice). */
  deviceKeys?: string[]
  /** Write exactly these (built elsewhere, e.g. an AI proposal), ignoring the editor's drafts. */
  fixedItems?: WriteItem[]
  /** Called as writing starts. */
  onStart?: () => void
  /** Called with what was written and how each went. */
  onFinished?: (items: WriteItem[], outcomes: WriteOutcome[]) => void
}) {
  const devices = useConfig((s) => s.devices)
  const [also, setAlso] = useState<string[]>([])
  const [phase, setPhase] = useState<'review' | 'running' | 'done'>('review')
  const [progress, setProgress] = useState<WriteProgress[]>([])
  const [ran, setRan] = useState<WriteItem[]>([])

  // Recomputed from the store on every render (cheap): the plan follows the latest
  // edits while reviewing, and is frozen into `ran` once writing starts.
  void devices
  const plan = fixedItems ? { items: fixedItems, skipped: {} as Record<string, string[]> } : deviceKeys ? planWriteEach(deviceKeys, kind) : planWrite(deviceKey, kind, also)
  const others = deviceKeys || fixedItems ? [] : shareTargets(deviceKey, kind)
  const items = phase === 'review' ? (plan?.items ?? []) : ran
  const motion = useMotionBlock(items.map((i) => i.target))
  const errors = items.flatMap((i) => i.issues.filter((x) => x.level === 'error').map((x) => ({ ...x, device: i.deviceName, label: i.defs.params[x.param]?.label ?? x.param })))
  const warnings = items.flatMap((i) => i.issues.filter((x) => x.level === 'warning').map((x) => ({ ...x, device: i.deviceName, label: i.defs.params[x.param]?.label ?? x.param })))
  const kinds = [...new Set(items.map(itemWord))]
  const devicesShown = [...new Set(items.map((i) => i.deviceName))]
  const total = items.reduce((n, i) => n + i.changes.length, 0)
  const main = items[0]

  const close = () => {
    if (phase === 'running') return
    setPhase('review')
    setProgress([])
    setAlso([])
    onClose()
  }

  const start = async () => {
    if (!plan) return
    const frozen = plan.items
    setRan(frozen)
    setPhase('running')
    setProgress(frozen.map(() => ({ step: 'waiting' })))
    onStart?.()
    const outcomes = await runWrites(frozen, (i, p) => setProgress((prev) => prev.map((x, j) => (j === i ? p : x))))
    setPhase('done')
    onFinished?.(frozen, outcomes)
  }

  const blockedReason =
    total === 0 ? 'No changes to write.' : errors.length ? 'Fix the problems above first.' : motion ? motion : null

  const title =
    phase === 'done'
      ? 'Write finished'
      : devicesShown.length > 1
        ? `Write ${plural(total, 'change')} to ${devicesShown.length} controllers?`
        : `Write ${plural(total, 'change')} to the controller?`

  return (
    <Dialog
      open={open}
      onClose={close}
      locked={phase === 'running'}
      size="md"
      title={title}
      subtitle={main ? `${devicesShown.join(', ')} · ${kinds.join(' and ')} settings` : undefined}
      footer={
        phase === 'review' ? (
          <>
            {blockedReason && total > 0 && (
              <span className="mr-auto flex flex-wrap items-center gap-2 text-xs text-warn">
                {blockedReason}
                {motion && !errors.length && <DemoPark />}
              </span>
            )}
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!!blockedReason} onClick={() => void start()}>
              Write {plural(total, 'change')}
            </Button>
          </>
        ) : phase === 'done' ? (
          <>
            <Link to="/config/backups" className="mr-auto text-sm text-muted underline-offset-4 hover:text-text hover:underline">
              View backups
            </Link>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Keep the controller powered and connected…
          </span>
        )
      }
    >
      <div className="space-y-5">
        {items.map((item, i) => {
          const pr = progress[i]
          return (
            <section key={`${item.key}:${item.kind}`} className="space-y-2.5">
              {(items.length > 1 || phase !== 'review') && (
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {pr?.step === 'done' ? (
                    pr.outcome?.status === 'ok' ? (
                      <Check className="size-4 text-ok" />
                    ) : pr.outcome?.status === 'adjusted' || pr.outcome?.status === 'stale' ? (
                      <AlertTriangle className="size-4 text-warn" />
                    ) : (
                      <CircleAlert className="size-4 text-danger" />
                    )
                  ) : pr ? (
                    <Loader2 className={cx('size-4', pr.step !== 'waiting' && 'animate-spin text-accent')} />
                  ) : null}
                  {item.deviceName}
                  {kinds.length > 1 && <span className="font-normal text-muted"> · {itemWord(item)}</span>}
                  <span className="font-normal text-muted">
                    · {plural(item.changes.length, 'change')}
                    {pr && pr.step !== 'done' && ` · ${STEP_TEXT[pr.step]}`}
                  </span>
                </h3>
              )}
              {pr?.step === 'done' && pr.outcome ? <OutcomeView item={item} outcome={pr.outcome} /> : <ChangeTable item={item} />}
            </section>
          )
        })}

        {phase === 'review' && others.length > 0 && (
          <section className="rounded-xl border border-line bg-surface-2/50 p-3.5">
            <div className="label mb-2 text-[9.5px]">Also write the same changes to</div>
            <div className="space-y-2">
              {others.map((d) => {
                const on = also.includes(d.key)
                const skipped = plan?.skipped[d.key] ?? []
                return (
                  <label key={d.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setAlso(on ? also.filter((k) => k !== d.key) : [...also, d.key])}
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                    />
                    <span>
                      {d.name}
                      {on && skipped.length > 0 && (
                        <span className="block text-xs text-muted">
                          Not copied (belongs to each controller): {skipped.map((n) => main?.defs.params[n]?.label ?? n).join(', ')}
                        </span>
                      )}
                      {on && plan && !plan.items.some((it) => it.key === d.key) && (
                        <span className="block text-xs text-muted">Already has these values.</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        )}

        {phase === 'review' && errors.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-danger/35 bg-danger/8 p-3.5 text-sm text-danger">
            {errors.map((e) => (
              <li key={e.device + e.param + e.message} className="flex gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  {e.label}: {e.message}
                  {items.length > 1 && <span className="text-danger/70"> ({e.device})</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {phase === 'review' && warnings.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-warn/30 bg-warn/5 p-3.5 text-sm text-warn">
            {warnings.map((w) => (
              <li key={w.device + w.param + w.message} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {w.label}: {w.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {phase === 'review' && (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            The current settings are backed up first. After writing, they’re read back and checked against what you reviewed. You can
            restore the backup from Backups at any time.
          </p>
        )}
      </div>
    </Dialog>
  )
}
