import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import {
  batteryAmpsFromMotor,
  chargeHours,
  cRate,
  erpmAt,
  fieldProblem,
  fullVoltage,
  gearing,
  horsepower,
  LOADED_SHARE,
  pack,
  packWhFrom,
  parseField,
  pctChange,
  rangeKm,
  topSpeedKmh,
  TYPICAL_WH_PER_KM,
  whatIf,
  type FieldSpec,
} from '../../lib/calculators'
import { cx, fmt, fmtThousands } from '../../lib/format'
import { BATTERY_KINDS, kvFromFlux, type BatteryKind } from '../../lib/setupMath'
import { convertDistance, convertPerDistance, convertSpeed, KM_PER_MI, unitLabels, type Units } from '../../lib/vehicle'
import { averageWhPerKm } from '../../logs/summary'
import { useConfig } from '../../state/config'
import { useRideLogs } from '../../state/rideLogs'
import { useSettings } from '../../state/settings'
import { PageTitle, Segmented } from '../../ui/Primitives'
import { BackToMore } from './ToolBits'

// Every input's allowed range. Anything outside is refused, never trimmed.
const F = {
  series: { label: 'Cells in series', unit: 'S', min: 1, max: 40, integer: true },
  parallel: { label: 'Cells in parallel', unit: 'P', min: 1, max: 100, integer: true },
  cellAh: { label: 'Cell capacity', unit: 'Ah', min: 0.1, max: 400 },
  cellMaxA: { label: 'Cell discharge rating', unit: 'A', min: 0.5, max: 200 },
  packWh: { label: 'Pack energy', unit: 'Wh', min: 10, max: 50_000 },
  packAh: { label: 'Pack capacity', unit: 'Ah', min: 0.5, max: 1000 },
  usable: { label: 'Usable', unit: '%', min: 10, max: 100 },
  whPerKm: { label: 'Consumption', unit: 'Wh/km', min: 1, max: 500 },
  whPerMi: { label: 'Consumption', unit: 'Wh/mi', min: 1, max: 800 },
  volts: { label: 'Battery voltage', unit: 'V', min: 1, max: 200 },
  kv: { label: 'Motor KV', unit: 'rpm/V', min: 1, max: 5000 },
  wheelMm: { label: 'Wheel diameter', unit: 'mm', min: 50, max: 1500 },
  gearRatio: { label: 'Gear ratio', unit: ':1', min: 0.1, max: 100 },
  maxDuty: { label: 'Max duty', unit: '%', min: 10, max: 100 },
  chargerA: { label: 'Charger current', unit: 'A', min: 0.1, max: 200 },
  fromPct: { label: 'From', unit: '%', min: 0, max: 100 },
  toPct: { label: 'To', unit: '%', min: 0, max: 100 },
  motorTeeth: { label: 'Motor pulley or sprocket', unit: 'teeth', min: 5, max: 200, integer: true },
  wheelTeeth: { label: 'Wheel pulley or sprocket', unit: 'teeth', min: 5, max: 400, integer: true },
  amps: { label: 'Current', unit: 'A', min: 0, max: 2000 },
  motorA: { label: 'Motor current', unit: 'A', min: 0, max: 2000 },
  duty: { label: 'Duty', unit: '%', min: 0, max: 100 },
  batteryA: { label: 'Battery current limit', unit: 'A', min: 1, max: 2000 },
} satisfies Record<string, FieldSpec>

type Key = keyof typeof F

/** Text the user typed per field, and the value when it's valid. */
function useFields<K extends Key>(initial: Record<K, string>) {
  const [text, setText] = useState(initial)
  const keys = Object.keys(text) as K[]
  const problems = Object.fromEntries(keys.map((k) => [k, fieldProblem(F[k], text[k])])) as Record<K, string | null>
  const values = Object.fromEntries(keys.map((k) => [k, parseField(text[k])])) as Record<K, number>
  const ok = Object.values(problems).every((p) => p === null)
  const set = (k: K, v: string) => setText((t) => ({ ...t, [k]: v }))
  return { text, set, problems, values, ok }
}

const n = (v: number, digits = 1) => String(Number(v.toFixed(digits)))

/** What the app knows about the vehicle, for starting values. */
function useVehicleFacts() {
  const vehicle = useSettings((s) => s.vehicle)
  const devices = useConfig((s) => s.devices)
  const order = useConfig((s) => s.order)
  const rides = useRideLogs((s) => s.rides)
  const refresh = useRideLogs((s) => s.refresh)
  useEffect(() => {
    void refresh()
  }, [refresh])
  return useMemo(() => {
    const motors = order.map((k) => devices[k]?.mcconf.device).filter((v): v is NonNullable<typeof v> => !!v)
    const main = motors[0]
    const kv = main ? kvFromFlux(Number(main.foc_motor_flux_linkage), Number(main.si_motor_poles)) : null
    const batteryA = motors.reduce((sum, m) => sum + (Number(m.l_in_current_max) || 0), 0)
    const maxVin = main ? Number(main.l_max_vin) : null
    return {
      vehicle,
      chemistry: vehicle.batteryChemistry,
      kv: kv && Number.isFinite(kv) ? kv : null,
      batteryA: batteryA > 0 ? batteryA : null,
      maxVin: maxVin && Number.isFinite(maxVin) ? maxVin : null,
      whPerKm: averageWhPerKm(rides),
      rides: rides.length,
    }
  }, [vehicle, devices, order, rides])
}

export function CalculatorsPage() {
  const facts = useVehicleFacts()
  const units = useSettings((s) => s.units)
  return (
    <>
      <BackToMore />
      <PageTitle title="Calculators" subtitle="Quick answers for planning a build, from your setup." />
      <div className="grid gap-4 lg:grid-cols-2">
        <PackCalc facts={facts} />
        <RangeCalc facts={facts} units={units} />
        <SpeedCalc facts={facts} units={units} />
        <ChargeCalc facts={facts} />
        <GearCalc />
        <PowerCalc facts={facts} />
      </div>
      <div className="mt-4">
        <WhatIfCalc facts={facts} units={units} />
      </div>
    </>
  )
}

type Facts = ReturnType<typeof useVehicleFacts>

const nominalVolts = (facts: Facts) => facts.vehicle.batteryCells * (facts.chemistry === 'lifepo4' ? 3.2 : 3.6)

function PackCalc({ facts }: { facts: Facts }) {
  const [chem, setChem] = useState<BatteryKind>(facts.chemistry)
  const f = useFields({ series: String(facts.vehicle.batteryCells), parallel: '4', cellAh: '3.5', cellMaxA: '10' })
  const r = f.ok ? pack({ chemistry: chem, series: f.values.series, parallel: f.values.parallel, cellAh: f.values.cellAh, cellMaxA: f.values.cellMaxA }) : null
  return (
    <Calc title="Battery pack" hint="From the cells: voltage, capacity, energy and how much current it can give.">
      <Segmented<BatteryKind> label="Cell type" value={chem} onChange={setChem} options={BATTERY_KINDS.map((k) => ({ value: k.value, label: k.value === 'liion' ? 'Li-ion' : k.value === 'lifepo4' ? 'LiFePO₄' : 'Lead' }))} />
      <Inputs f={f} keys={['series', 'parallel', 'cellAh', 'cellMaxA']} />
      <Results>
        <Result label="Energy" value={r ? fmtThousands(r.wh) : '—'} unit="Wh" big />
        <Result label="Capacity" value={r ? fmt(r.ah, 1) : '—'} unit="Ah" />
        <Result label="Full / nominal / empty" value={r ? `${fmt(r.fullV, 1)} / ${fmt(r.nominalV, 1)} / ${fmt(r.emptyV, 1)}` : '—'} unit="V" />
        <Result label="Continuous current" value={r ? fmt(r.maxA, 0) : '—'} unit="A" hint={r ? `about ${fmt(r.maxPowerW / 1000, 1)} kW` : undefined} />
      </Results>
    </Calc>
  )
}

function RangeCalc({ facts, units }: { facts: Facts; units: Units }) {
  const imperial = units === 'imperial'
  const perKey = imperial ? 'whPerMi' : 'whPerKm'
  const wh = packWhFrom(facts.chemistry, facts.vehicle.batteryCells, facts.vehicle.batteryAh)
  const startPer = facts.whPerKm ?? 18
  // Both units are kept, so switching km/mi never leaves a field without a value.
  const f = useFields({ packWh: n(wh, 0), usable: '90', whPerKm: n(startPer, 1), whPerMi: n(startPer * KM_PER_MI, 1) })
  const per = f.values[perKey]
  const ok = !f.problems.packWh && !f.problems.usable && !f.problems[perKey]
  const km = ok ? rangeKm(f.values.packWh, f.values.usable, imperial ? per / KM_PER_MI : per) : null
  const u = unitLabels(units)
  return (
    <Calc title="Range" hint="How far a charge goes at your usual consumption. Riding faster, colder or uphill uses more.">
      <Inputs f={f} keys={['packWh', 'usable', perKey]} />
      <div className="flex flex-wrap gap-1.5">
        {facts.whPerKm !== null && (
          <Chip onClick={() => f.set(perKey, n(convertPerDistance(facts.whPerKm!, units), 1))}>
            Your rides: {fmt(convertPerDistance(facts.whPerKm, units), 1)} {u.perDistance}
          </Chip>
        )}
        {TYPICAL_WH_PER_KM.map((t) => (
          <Chip key={t.label} onClick={() => f.set(perKey, n(convertPerDistance(t.value, units), 1))}>
            {t.label} {fmt(convertPerDistance(t.value, units), 0)}
          </Chip>
        ))}
      </div>
      <Results>
        <Result label="Range" value={km === null ? '—' : fmt(convertDistance(km, units), 0)} unit={u.distance} big />
      </Results>
    </Calc>
  )
}

function SpeedCalc({ facts, units }: { facts: Facts; units: Units }) {
  const v = facts.vehicle
  const nominal = nominalVolts(facts)
  const f = useFields({
    volts: n(nominal, 1),
    kv: n(facts.kv ?? 15, 1),
    wheelMm: String(v.wheelDiameterMm),
    gearRatio: n(v.gearRatio, 2),
    maxDuty: n(v.maxDuty * 100, 0),
  })
  const kmh = f.ok ? topSpeedKmh({ volts: f.values.volts, kv: f.values.kv, wheelMm: f.values.wheelMm, gearRatio: f.values.gearRatio, maxDutyPct: f.values.maxDuty }) : null
  const u = unitLabels(units)
  return (
    <Calc
      title="Top speed"
      hint={
        facts.kv
          ? 'KV is worked out from the flux linkage your controller measured.'
          : 'KV is a typical hub motor’s; connect after motor detection for yours.'
      }
    >
      <Inputs f={f} keys={['volts', 'kv', 'wheelMm', 'gearRatio', 'maxDuty']} />
      <div className="flex flex-wrap gap-1.5">
        <Chip onClick={() => f.set('volts', n(fullVoltage(facts.chemistry, v.batteryCells), 1))}>Full battery</Chip>
        <Chip onClick={() => f.set('volts', n(nominal, 1))}>Half charged</Chip>
      </div>
      <Results>
        <Result label="Riding" value={kmh === null ? '—' : fmt(convertSpeed(kmh * LOADED_SHARE, units), 0)} unit={u.speed} hint="about, with air and road" big />
        <Result label="Wheel off the ground" value={kmh === null ? '—' : fmt(convertSpeed(kmh, units), 0)} unit={u.speed} />
        <Result label="At" value={kmh === null ? '—' : fmtThousands(erpmAt(kmh, v.motorPoles, f.values.wheelMm, f.values.gearRatio))} unit="ERPM" hint={`${v.motorPoles} motor poles`} />
      </Results>
      <p className="text-xs text-faint">Field weakening can add more on top, at the cost of heat and range.</p>
    </Calc>
  )
}

function ChargeCalc({ facts }: { facts: Facts }) {
  const f = useFields({ packAh: n(facts.vehicle.batteryAh, 1), chargerA: '2', fromPct: '20', toPct: '100' })
  const order = f.ok && f.values.toPct <= f.values.fromPct ? '“To” must be more than “From”.' : null
  const h = f.ok && !order ? chargeHours(f.values.packAh, f.values.chargerA, f.values.fromPct, f.values.toPct) : null
  const c = f.ok ? cRate(f.values.chargerA, f.values.packAh) : null
  const watts = f.ok ? fullVoltage(facts.chemistry, facts.vehicle.batteryCells) * f.values.chargerA : null
  return (
    <Calc title="Charge time" hint="Full current to about 80 %, then the charger tapers off, so the last part is slower.">
      <Inputs f={f} keys={['packAh', 'chargerA', 'fromPct', 'toPct']} />
      {order && <p className="text-sm text-warn">{order}</p>}
      <Results>
        <Result label="Time" value={h === null ? '—' : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`} unit="min" big />
        <Result label="Charge rate" value={c === null ? '—' : fmt(c, 2)} unit="C" hint={c !== null && c > 0.5 ? 'fast: check the cells’ charge rating' : 'gentle on the cells'} warn={c !== null && c > 0.5} />
        <Result label="Charger output" value={watts === null ? '—' : fmt(watts, 0)} unit="W" hint={`at ${facts.vehicle.batteryCells}S full`} />
      </Results>
    </Calc>
  )
}

function GearCalc() {
  const f = useFields({ motorTeeth: '15', wheelTeeth: '36' })
  const g = f.ok ? gearing(f.values.motorTeeth, f.values.wheelTeeth) : null
  return (
    <Calc title="Gear ratio" hint="For belt or chain drives. Put the ratio into the controller’s settings (Additional info › gear ratio) so speed reads right.">
      <Inputs f={f} keys={['motorTeeth', 'wheelTeeth']} />
      <Results>
        <Result label="Ratio" value={g ? fmt(g.ratio, 2) : '—'} unit=": 1" big />
        <Result label="Wheel torque" value={g ? `× ${fmt(g.torqueX, 2)}` : '—'} hint="compared with direct drive" />
        <Result label="Top speed" value={g ? `× ${fmt(g.speedX, 2)}` : '—'} hint="compared with direct drive" />
      </Results>
    </Calc>
  )
}

function PowerCalc({ facts }: { facts: Facts }) {
  const f = useFields({ volts: n(nominalVolts(facts), 1), amps: '30', motorA: '60', duty: '50' })
  const okP = !f.problems.volts && !f.problems.amps
  const okB = !f.problems.motorA && !f.problems.duty
  const w = okP ? f.values.volts * f.values.amps : null
  return (
    <Calc title="Current and power" hint="Battery power is volts × amps. Motor current is higher than battery current at part throttle.">
      <Inputs f={f} keys={['volts', 'amps']} />
      <Results>
        <Result label="Power" value={w === null ? '—' : fmt(w / 1000, 2)} unit="kW" big />
        <Result label="Horsepower" value={w === null ? '—' : fmt(horsepower(w), 2)} unit="hp" />
      </Results>
      <div className="border-t border-line pt-3">
        <Inputs f={f} keys={['motorA', 'duty']} />
      </div>
      <Results>
        <Result label="Battery current" value={okB ? fmt(batteryAmpsFromMotor(f.values.motorA, f.values.duty), 1) : '—'} unit="A" hint="about, ignoring losses" />
      </Results>
    </Calc>
  )
}

function WhatIfCalc({ facts, units }: { facts: Facts; units: Units }) {
  const v = facts.vehicle
  const now = useFields({ series: String(v.batteryCells), packAh: n(v.batteryAh, 1), wheelMm: String(v.wheelDiameterMm), batteryA: n(facts.batteryA ?? 30, 0) })
  const next = useFields({ series: String(v.batteryCells + 3), packAh: n(v.batteryAh, 1), wheelMm: String(v.wheelDiameterMm), batteryA: n(facts.batteryA ?? 30, 0) })
  const shared = { kv: facts.kv ?? 15, gearRatio: v.gearRatio, maxDutyPct: v.maxDuty * 100, whPerKm: facts.whPerKm ?? 18, usablePct: 90 }
  const run = (x: typeof now) =>
    x.ok ? whatIf({ chemistry: facts.chemistry, series: x.values.series, ah: x.values.packAh, wheelMm: x.values.wheelMm, batteryA: x.values.batteryA }, shared) : null
  const a = run(now)
  const b = run(next)
  const u = unitLabels(units)
  const tooHigh = b && facts.maxVin !== null && b.fullV > facts.maxVin

  const rows: { label: string; unit: string; get: (r: NonNullable<typeof a>) => number; digits: number }[] = [
    { label: 'Full voltage', unit: 'V', get: (r) => r.fullV, digits: 1 },
    { label: 'Top speed', unit: u.speed, get: (r) => convertSpeed(r.topSpeedKmh * LOADED_SHARE, units), digits: 0 },
    { label: 'Energy', unit: 'Wh', get: (r) => r.wh, digits: 0 },
    { label: 'Range', unit: u.distance, get: (r) => convertDistance(r.rangeKm, units), digits: 0 },
    { label: 'Peak power', unit: 'kW', get: (r) => r.powerW / 1000, digits: 1 },
  ]

  return (
    <Calc title="What if…" hint="Compare your setup with a change, such as more cells (13S → 16S), a bigger pack, other wheels or a higher battery current.">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label mb-2">Now</div>
          <Inputs f={now} keys={['series', 'packAh', 'wheelMm', 'batteryA']} />
        </div>
        <div>
          <div className="label mb-2 text-accent">What if</div>
          <Inputs f={next} keys={['series', 'packAh', 'wheelMm', 'batteryA']} />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-2 font-medium" />
            <th className="py-2 text-right font-medium">Now</th>
            <th className="py-2 text-right font-medium">What if</th>
            <th className="py-2 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody className="num divide-y divide-line">
          {rows.map((r) => {
            const d = a && b ? pctChange(r.get(a), r.get(b)) : null
            return (
              <tr key={r.label}>
                <td className="py-2 text-muted">{r.label}</td>
                <td className="py-2 text-right">{a ? `${fmt(r.get(a), r.digits)} ${r.unit}` : '—'}</td>
                <td className="py-2 text-right font-medium">{b ? `${fmt(r.get(b), r.digits)} ${r.unit}` : '—'}</td>
                <td className={cx('py-2 text-right', d !== null && d > 0.5 ? 'text-ok' : d !== null && d < -0.5 ? 'text-warn' : 'text-muted')}>
                  {d === null ? '—' : `${d > 0 ? '+' : ''}${fmt(d, 0)} %`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {tooHigh && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {fmt(b.fullV, 1)} V when full is above your controller’s {fmt(facts.maxVin!, 0)} V limit. It would shut off with an over-voltage fault, or be damaged.
        </p>
      )}
      {b && a && b.fullV > a.fullV + 0.1 && (
        <p className="text-xs text-faint">
          More voltage also needs a charger and BMS for the new cell count, and a controller, capacitors and lights rated for it. Range assumes you ride the same way; going faster uses more.
        </p>
      )}
    </Calc>
  )
}

function Calc({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="card h-fit space-y-4 p-5" aria-label={title}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Inputs<K extends Key>({ f, keys }: { f: { text: Record<K, string>; set: (k: K, v: string) => void; problems: Record<K, string | null> }; keys: K[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
      {keys.map((k) => (
        <NumField key={k} spec={F[k]} text={f.text[k]} problem={f.problems[k]} onChange={(v) => f.set(k, v)} />
      ))}
    </div>
  )
}

function NumField({ spec, text, problem, onChange }: { spec: FieldSpec; text: string; problem: string | null; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {spec.label}
      </label>
      <div className={cx('mt-1 flex h-10 items-center rounded-xl border bg-surface-2 pr-3 focus-within:border-accent/50', problem ? 'border-warn/60' : 'border-line-strong')}>
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!problem}
          aria-describedby={problem ? `${id}-p` : undefined}
          className="num w-full min-w-0 bg-transparent px-3 text-right text-sm font-medium outline-none"
        />
        <span className="shrink-0 text-xs text-muted">{spec.unit}</span>
      </div>
      {problem && (
        <p id={`${id}-p`} className="mt-1 text-xs text-warn">
          {problem}
        </p>
      )}
    </div>
  )
}

function Results({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2/60 p-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">{children}</dl>
}

function Result({ label, value, unit, hint, big, warn }: { label: string; value: string; unit?: string; hint?: string; big?: boolean; warn?: boolean }) {
  return (
    <div>
      <dt className="label text-[9.5px]">{label}</dt>
      <dd className={cx('num mt-1 font-semibold', big ? 'text-2xl' : 'text-base')}>
        {value}
        {unit && value !== '—' && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </dd>
      {hint && <dd className={cx('mt-0.5 text-[11px]', warn ? 'text-warn' : 'text-faint')}>{hint}</dd>}
    </div>
  )
}

function Chip({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="focus-ring rounded-full border border-line-strong bg-surface-2 px-3 py-1 text-xs text-muted transition-colors hover:text-text">
      {children}
    </button>
  )
}
