import { Check, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { cx, fmt } from '../../lib/format'
import { BATTERY_KINDS, batteryIssues, batteryKind, batterySettings, cellsRange, fullVoltage, guessCells, type BatteryInput, type BatteryKind } from '../../lib/setupMath'
import { pendingCount, useConfig, type DeviceConfig } from '../../state/config'
import { targetKey } from '../../state/devices'
import { markSetupDone } from '../../state/setupProgress'
import { useTelemetry } from '../../state/telemetry'
import { Button, PageTitle } from '../../ui/Primitives'
import { WriteDialog } from '../config/WriteDialog'
import { BackToSetup, NotReady, NumberField } from './common'
import { NextStep } from './SetupSteps'
import { toNum, useMotorDevices } from './helpers'

export function BatteryWizard() {
  const list = useMotorDevices()
  const ready = list.length > 0 && list.every((d) => d.mcconf.status === 'ready')
  if (!ready) return <NotReady title="Battery" what="set up the battery" list={list} />
  return <BatteryForm list={list} />
}

function BatteryForm({ list }: { list: DeviceConfig[] }) {
  const first = list[0]
  const mc = first.mcconf.device
  const vNow = useTelemetry((s) => s.devices[targetKey(first.target)]?.vIn)
  const startKind: BatteryKind = mc?.si_battery_type === 1 ? 'lifepo4' : mc?.si_battery_type === 2 ? 'lead' : 'liion'
  const [kind, setKind] = useState<BatteryKind>(startKind)
  const [cells, setCells] = useState(() => String(Number(mc?.si_battery_cells) || guessCells(vNow ?? 0, startKind) || ''))
  const [ah, setAh] = useState(() => String(Number(mc?.si_battery_ah) || ''))
  const sum = (f: (v: Record<string, unknown>) => number) => list.reduce((n, d) => n + (d.mcconf.device ? f(d.mcconf.device) : 0), 0)
  const [discharge, setDischarge] = useState(() => String(Math.round(sum((v) => Number(v.l_in_current_max)))))
  const [charge, setCharge] = useState(() => String(Math.round(sum((v) => Math.abs(Number(v.l_in_current_min))))))
  const [writing, setWriting] = useState(false)
  const [written, setWritten] = useState(false)

  const input: BatteryInput = {
    kind,
    cells: toNum(cells),
    ah: toNum(ah),
    maxDischargeA: discharge.trim() === '' ? null : toNum(discharge),
    maxChargeA: charge.trim() === '' ? null : toNum(charge),
  }
  const issues = batteryIssues(input)
  const full = issues.length ? NaN : fullVoltage(input)
  const chemistry = batteryKind(kind)
  const tooHigh = list.filter((d) => Number.isFinite(full) && full > Number(d.mcconf.device?.l_max_vin))
  const pending = list.some((d) => pendingCount(d.mcconf) > 0)
  const fits = cellsRange(vNow ?? 0, kind)

  const review = () => {
    const cfg = useConfig.getState()
    for (const d of list) cfg.edit(d.key, 'mcconf', batterySettings(input, list.length))
    setWriting(true)
  }

  return (
    <>
      <BackToSetup />
      <PageTitle title="Battery" subtitle="Describe the pack. Ohmic works out the settings for you to review." />
      {written && (
        <section className="card mb-4 space-y-3 border-ok/30 p-5" aria-label="Battery set up">
          <p className="flex items-center gap-2 text-sm text-ok">
            <Check className="size-4" aria-hidden /> The battery settings are on {list.length === 1 ? 'the controller' : list.length === 2 ? 'both controllers' : `all ${list.length} controllers`}.
          </p>
          <NextStep step="battery" />
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="card space-y-4 p-5">
          <div>
            <div className="text-sm font-medium">Chemistry</div>
            <div role="radiogroup" className="mt-1.5 flex flex-wrap gap-1.5">
              {BATTERY_KINDS.map((b) => (
                <button
                  key={b.value}
                  role="radio"
                  aria-checked={kind === b.value}
                  onClick={() => setKind(b.value)}
                  className={cx('focus-ring h-9 rounded-lg border px-3 text-sm', kind === b.value ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text')}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label="Cells in series"
            unit="S"
            value={cells}
            onChange={setCells}
            hint={
              fits && vNow
                ? `The battery reads ${fmt(vNow, 1)} V now, which fits ${fits[0] === fits[1] ? `${fits[0]}S` : `${fits[0]}S (charged) to ${fits[1]}S (low)`}. Check the label on the pack.`
                : 'The “S” number, e.g. 13S for a 48 V Li-ion pack.'
            }
          />
          <NumberField label="Capacity" unit="Ah" value={ah} onChange={setAh} hint="Printed on the pack. Used for range and battery %." />
          <NumberField
            label="Most the battery can give"
            unit="A"
            value={discharge}
            onChange={setDischarge}
            hint={`Its continuous discharge rating, for the whole vehicle${list.length > 1 ? `; split between the ${list.length} controllers` : ''}. Leave empty to keep the current limit.`}
          />
          <NumberField
            label="Most it can take back when braking"
            unit="A"
            value={charge}
            onChange={setCharge}
            hint="Its charge rating. Regen braking stays under this. Leave empty to keep the current limit."
          />
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">What will be set</h2>
          {issues.length ? (
            <ul className="space-y-1 text-sm text-danger">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Full charge</dt>
              <dd className="num text-right">{fmt(full, 1)} V</dd>
              <dt className="text-muted">Power starts fading at</dt>
              <dd className="num text-right">{fmt(chemistry.cutStart * input.cells, 1)} V</dd>
              <dt className="text-muted">Power stops at</dt>
              <dd className="num text-right">{fmt(chemistry.cutEnd * input.cells, 1)} V</dd>
              {input.maxDischargeA !== null && (
                <>
                  <dt className="text-muted">Battery current per controller</dt>
                  <dd className="num text-right">{fmt(input.maxDischargeA / list.length, 1)} A</dd>
                </>
              )}
              {input.maxChargeA !== null && (
                <>
                  <dt className="text-muted">Regen per controller</dt>
                  <dd className="num text-right">{fmt(input.maxChargeA / list.length, 1)} A</dd>
                </>
              )}
            </dl>
          )}
          {tooHigh.map((d) => (
            <p key={d.key} className="flex gap-2 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs text-warn">
              <TriangleAlert className="size-4 shrink-0" />
              {d.name} is set for at most {fmt(Number(d.mcconf.device?.l_max_vin), 1)} V input, below a full battery. Check the controller is rated for this
              battery before riding.
            </p>
          ))}
          {pending && <p className="text-xs text-warn">You have motor-setting edits that aren’t written yet. Write or discard them in Config first.</p>}
          <Button variant="primary" className="w-full" disabled={issues.length > 0 || pending} onClick={review}>
            Review changes
          </Button>
        </section>
      </div>
      {writing && (
        <WriteDialog
          open
          onClose={() => {
            setWriting(false)
            // Anything not written is dropped, so it doesn't linger in Config.
            const cfg = useConfig.getState()
            const left = list.filter((d) => pendingCount(cfg.devices[d.key]?.mcconf) > 0)
            for (const d of left) cfg.discard(d.key, 'mcconf')
            if (!left.length) {
              setWritten(true)
              markSetupDone('battery')
            }
          }}
          deviceKey={first.key}
          deviceKeys={list.map((d) => d.key)}
          kind="mcconf"
        />
      )}
    </>
  )
}
