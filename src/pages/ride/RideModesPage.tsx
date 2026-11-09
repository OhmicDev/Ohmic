import { Check, Loader2, Pencil, Plus, Stamp, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ConfigValues } from '../../config/types'
import { cx, fmt } from '../../lib/format'
import {
  describeMode,
  limitsFor,
  limitsFromConfig,
  MODE_SETTINGS,
  modeIssues,
  TEMPLATES,
  type ModeSetting,
  type RideMode,
} from '../../lib/rideModes'
import { convertSpeed, KM_PER_MI, unitLabels } from '../../lib/vehicle'
import { TEMP_FIELDS, TEMP_KEYS } from '../../protocol/setup'
import { pendingCount, useConfig, type DeviceConfig } from '../../state/config'
import { useMotionBlock } from '../../state/motion'
import { singleDriverKey, useRideModes } from '../../state/rideModes'
import { useSettings } from '../../state/settings'
import { Dialog } from '../../ui/Dialog'
import { BackLink, Badge, Button, PageTitle } from '../../ui/Primitives'
import { WriteDialog } from '../config/WriteDialog'
import { useMotorDevices } from '../setup/helpers'

export function RideModesPage() {
  const { modes, activeId, busy, error, load, apply, save, remove, addFromTemplate, clearError } = useRideModes()
  const units = useSettings((s) => s.units)
  const list = useMotorDevices()
  const [editing, setEditing] = useState<RideMode | null>(null)
  const [permanent, setPermanent] = useState<RideMode | null>(null)
  useEffect(() => void load(), [load])
  const sorted = [...modes].sort((a, b) => a.order - b.order)
  const fmtSpeed = (kmh: number) => `${fmt(convertSpeed(kmh, units), 0)} ${unitLabels(units).speed}`
  const ready = list.length > 0 && list.every((d) => d.mcconf.status === 'ready')

  return (
    <>
      <BackLink to="/tune">Tune</BackLink>
      <PageTitle
        title="Ride modes"
        subtitle="Each mode lowers a few limits on top of your controller settings. Switching is instant and works while riding; the controllers forget the mode when powered off, and your stored settings never change unless you make a mode permanent."
      />

      {error && (
        <div role="alert" className="card mb-4 flex items-start gap-2 border-warn/30 bg-warn/5 p-3 text-sm text-warn">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {sorted.map((m) => (
          <div key={m.id} className={cx('card p-4', m.id === activeId && 'border-accent/40')}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">{m.name}</span>
                  {m.id === activeId && <Badge tone="accent">In use</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted">{describeMode(m, fmtSpeed)}</p>
              </div>
              <Button
                variant={m.id === activeId ? 'secondary' : 'primary'}
                className="h-9 px-3"
                disabled={!ready || busy}
                onClick={() => void apply(m.id === activeId ? null : m.id)}
              >
                {m.id === activeId ? 'Stop using' : 'Use'}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
              <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setEditing({ ...m })}>
                <Pencil className="size-3.5" /> Edit
              </Button>
              <Button variant="ghost" className="h-8 px-2.5 text-xs" disabled={!ready} onClick={() => setPermanent(m)}>
                <Stamp className="size-3.5" /> Make permanent
              </Button>
              {!m.starter && (
                <Button variant="ghost" className="h-8 px-2.5 text-xs text-danger hover:text-danger" onClick={() => void remove(m.id)}>
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="label mb-2">Add from a template</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t, i) => (
            <button
              key={t.name}
              onClick={() => void addFromTemplate(i).then((m) => setEditing({ ...m }))}
              className="card focus-ring flex items-start gap-3 p-3.5 text-left transition-colors hover:border-line-strong"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Plus className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{t.name}</span>
                <span className="block text-xs text-muted">{t.about}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {list.length > 1 && <SingleMotorChoice list={list} />}

      {editing && (
        <ModeEditor
          mode={editing}
          list={list}
          onClose={() => setEditing(null)}
          onSave={async (m) => {
            const issues = await save(m)
            if (!issues.length) setEditing(null)
            return issues
          }}
        />
      )}
      {permanent && <MakePermanent mode={permanent} list={list} onClose={() => setPermanent(null)} />}
    </>
  )
}

function SingleMotorChoice({ list }: { list: DeviceConfig[] }) {
  const chosen = useSettings((s) => s.singleMotorKey)
  const setChosen = useSettings((s) => s.setSingleMotorKey)
  const { motors, activeId, apply, busy } = useRideModes()
  const current = singleDriverKey(list)
  return (
    <section className="card mt-6 p-4">
      <h2 className="text-sm font-semibold">Single-motor mode</h2>
      <p className="mt-0.5 text-sm text-muted">
        Which motor keeps driving and braking when you pick Single on the dashboard. The other one rolls freely, which saves
        battery on flat roads. You can only switch motors while stopped, because it changes braking too.
      </p>
      <div role="radiogroup" aria-label="Motor that drives" className="mt-3 flex flex-wrap gap-2">
        {list.map((d) => (
          <button
            key={d.key}
            role="radio"
            aria-checked={current === d.key}
            disabled={busy}
            onClick={async () => {
              setChosen(d.key)
              if (motors === 'single' && chosen !== d.key) await apply(activeId, 'single')
            }}
            className={cx(
              'focus-ring inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm',
              current === d.key ? 'border-accent/50 bg-accent/10 text-text' : 'border-line-strong text-muted hover:text-text',
            )}
          >
            {current === d.key && <Check className="size-4 text-accent" />}
            {d.name}
          </button>
        ))}
      </div>
    </section>
  )
}

/** The limits a mode gives each controller, next to its own. */
function previewRows(m: RideMode, list: DeviceConfig[]) {
  const rows: { device: string; label: string; from: string; to: string }[] = []
  for (const d of list) {
    const mc = d.mcconf.device
    if (!mc || d.mcconf.status !== 'ready') continue
    const stock = limitsFromConfig(mc)
    const out = limitsFor(stock, mc, m, true, list.length)
    const show = (label: string, a: number, b: number, unit: string, digits = 0) => {
      if (Math.abs(a - b) > 1e-6) rows.push({ device: d.name, label, from: `${fmt(a, digits)} ${unit}`, to: `${fmt(b, digits)} ${unit}` })
    }
    const amps = Number(mc.l_current_max)
    const brake = Math.abs(Number(mc.l_current_min))
    show('Motor current', amps * stock.currentMaxScale, amps * out.currentMaxScale, 'A', 1)
    show('Braking current', brake * stock.currentMinScale, brake * out.currentMinScale, 'A', 1)
    show('Battery current', stock.inCurrentMax, out.inCurrentMax, 'A', 1)
    show('Top ERPM', stock.maxErpm, out.maxErpm, '')
    show('Power', stock.wattMax, out.wattMax, 'W')
  }
  return rows
}

function ModeEditor({
  mode,
  list,
  onClose,
  onSave,
}: {
  mode: RideMode
  list: DeviceConfig[]
  onClose: () => void
  onSave: (m: RideMode) => Promise<string[]>
}) {
  const units = useSettings((s) => s.units)
  // Top speed is typed in the rider's unit; the mode keeps km/h.
  const shown = (key: ModeSetting, v: number) => (key === 'maxSpeedKmh' ? round1(convertSpeed(v, units)) : v)
  const [name, setName] = useState(mode.name)
  const [text, setText] = useState<Record<ModeSetting, string>>(
    () =>
      Object.fromEntries(
        MODE_SETTINGS.map((s) => {
          const v = mode[s.key]
          return [s.key, v === null ? '' : String(shown(s.key, v))]
        }),
      ) as Record<ModeSetting, string>,
  )
  const [custom, setCustom] = useState<Record<ModeSetting, boolean>>(
    () => Object.fromEntries(MODE_SETTINGS.map((s) => [s.key, mode[s.key] !== null])) as Record<ModeSetting, boolean>,
  )
  const [saving, setSaving] = useState(false)
  const speedUnit = unitLabels(units).speed

  const draft: RideMode = { ...mode, name }
  for (const s of MODE_SETTINGS) {
    if (!custom[s.key]) draft[s.key] = null
    else {
      const raw = text[s.key].trim()
      const v = raw === '' ? NaN : Number(raw)
      draft[s.key] = s.key === 'maxSpeedKmh' && units === 'imperial' ? v * KM_PER_MI : v
    }
  }
  const issues = modeIssues(draft)
  const preview = issues.length ? [] : previewRows(draft, list)

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Edit ${mode.name}`}
      subtitle="Leave a setting on Default to keep what the controllers are set up for."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={issues.length > 0 || saving}
            onClick={async () => {
              setSaving(true)
              await onSave(draft)
              setSaving(false)
            }}
          >
            {saving && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            className="focus-ring mt-1 h-10 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-sm"
          />
        </label>
        {MODE_SETTINGS.map((s) => {
          const unit = s.key === 'maxSpeedKmh' ? speedUnit : s.unit
          return (
            <div key={s.key} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs leading-snug text-muted">{s.help}</div>
                </div>
                <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
                  {[false, true].map((c) => (
                    <button
                      key={String(c)}
                      aria-pressed={custom[s.key] === c}
                      onClick={() => {
                        setCustom({ ...custom, [s.key]: c })
                        if (c && text[s.key] === '') setText({ ...text, [s.key]: String(shown(s.key, s.key === 'maxSpeedKmh' ? 25 : s.max === 100 ? 70 : 2000)) })
                      }}
                      className={cx('focus-ring h-7 rounded-md px-2.5', custom[s.key] === c ? 'bg-surface-3 text-text' : 'text-muted')}
                    >
                      {c ? 'Custom' : 'Default'}
                    </button>
                  ))}
                </div>
                {custom[s.key] && (
                  <label className="flex items-center gap-1.5">
                    <input
                      inputMode="decimal"
                      value={text[s.key]}
                      onChange={(e) => setText({ ...text, [s.key]: e.target.value })}
                      aria-label={s.label}
                      className="focus-ring num h-9 w-24 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-right text-sm"
                    />
                    <span className="w-10 text-xs text-muted">{unit}</span>
                  </label>
                )}
              </div>
            </div>
          )
        })}
        {issues.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-danger/35 bg-danger/8 p-3 text-sm text-danger">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        {preview.length > 0 && (
          <div>
            <div className="label mb-1.5">What the controllers get</div>
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-sm">
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.device + r.label} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5">
                        {r.label}
                        {list.length > 1 && <span className="ml-1.5 text-xs text-faint">{r.device}</span>}
                      </td>
                      <td className="num px-3 py-1.5 text-right whitespace-nowrap">
                        <span className="text-muted">{r.from}</span> → <span className="font-semibold text-accent">{r.to}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Writes a mode's limits into each controller's stored settings, through the normal review and write. */
function MakePermanent({ mode, list, onClose }: { mode: RideMode; list: DeviceConfig[]; onClose: () => void }) {
  const { apply, busy } = useRideModes()
  const motion = useMotionBlock(list.map((d) => d.target))
  const [stage, setStage] = useState<'explain' | 'write'>('explain')
  const [error, setError] = useState<string | null>(null)
  const pending = list.some((d) => pendingCount(d.mcconf) > 0)

  const start = async () => {
    setError(null)
    // The stored settings must be the live ones before they're edited.
    const ok = await apply(null, 'dual')
    if (!ok) {
      setError(useRideModes.getState().error)
      return
    }
    const cfg = useConfig.getState()
    for (const d of list) {
      const k = cfg.devices[d.key]?.mcconf
      if (!k?.device || k.status !== 'ready') continue
      const stock = limitsFromConfig(k.device)
      const out = limitsFor(stock, k.device, mode, true, list.length)
      const patch: ConfigValues = {}
      for (const key of TEMP_KEYS) if (Math.abs(out[key] - stock[key]) > 1e-6) patch[TEMP_FIELDS[key]] = round6(out[key])
      if (Object.keys(patch).length) cfg.edit(d.key, 'mcconf', patch)
    }
    setStage('write')
  }

  if (stage === 'write' && list[0])
    return (
      <WriteDialog
        open
        onClose={() => {
          // Anything not written is dropped, so it doesn't linger in Config.
          const cfg = useConfig.getState()
          for (const d of list) if (pendingCount(cfg.devices[d.key]?.mcconf) > 0) cfg.discard(d.key, 'mcconf')
          onClose()
        }}
        deviceKey={list[0].key}
        deviceKeys={list.map((d) => d.key)}
        kind="mcconf"
      />
    )

  const blocked = pending
    ? 'You have motor-setting edits that aren’t written yet. Write or discard them in Config first.'
    : motion
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Make ${mode.name} permanent?`}
      subtitle="Writes its limits into each controller’s stored settings"
      footer={
        <>
          {blocked && <span className="mr-auto text-xs text-warn">{blocked}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!!blocked || busy} onClick={() => void start()}>
            {busy && <Loader2 className="size-4 animate-spin" />} Review changes
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm leading-relaxed text-muted">
        <p>
          The mode’s limits become the controllers’ own settings, so they stay after a power cycle and apply even without the
          app. Ride modes are switched off first; the other modes then work on top of the new settings.
        </p>
        <p>You’ll see every change before anything is written, and a backup is saved first.</p>
        {error && <p className="text-warn">{error}</p>}
      </div>
    </Dialog>
  )
}

const round6 = (n: number) => Number(n.toPrecision(6))
