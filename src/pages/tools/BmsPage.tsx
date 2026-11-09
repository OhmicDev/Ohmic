import { BatteryCharging, Scale, Thermometer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TimeoutError } from '../../client/VescClient'
import { cx, errorText, fmt } from '../../lib/format'
import { cellSummary, hasBms, type BmsValues } from '../../protocol/bms'
import { HW_TYPE } from '../../protocol/commands'
import { targetKey, targetLabel, type DeviceInfo } from '../../state/devices'
import { activeClient, useSession } from '../../state/session'
import { Badge, PageTitle } from '../../ui/Primitives'
import { pickTarget } from './pickTarget'
import { TargetPicker } from './TargetPicker'
import { BackToMore, Banner } from './ToolBits'

const POLL_MS = 600

type Reading = { status: 'waiting' } | { status: 'ok'; v: BmsValues; at: number } | { status: 'none'; at: number } | { status: 'error'; message: string }

/** Polls one device for BMS values while mounted. */
function useBms(device: DeviceInfo | null, connected: boolean): Reading {
  const [state, setState] = useState<{ key: string; reading: Reading }>({ key: '', reading: { status: 'waiting' } })
  const target = device?.target
  const key = target === undefined ? '' : String(target)
  useEffect(() => {
    if (!connected || target === undefined) return
    const setReading = (reading: Reading) => setState({ key: String(target), reading })
    let stop = false
    let misses = 0
    const loop = async () => {
      while (!stop) {
        const client = activeClient()
        if (!client) break
        const started = Date.now()
        try {
          const v = await client.bmsValues({ target })
          misses = 0
          if (!stop) setReading(hasBms(v) ? { status: 'ok', v, at: Date.now() } : { status: 'none', at: Date.now() })
        } catch (e) {
          misses++
          if (stop) break
          if (e instanceof TimeoutError) {
            if (misses >= 3) setReading({ status: 'none', at: Date.now() })
          } else setReading({ status: 'error', message: errorText(e) })
        }
        await new Promise((r) => setTimeout(r, Math.max(100, POLL_MS - (Date.now() - started))))
      }
    }
    void loop()
    return () => {
      stop = true
    }
  }, [connected, target])
  // A reading from the previously picked device doesn't count.
  return state.key === key ? state.reading : { status: 'waiting' }
}

export function BmsPage() {
  const devices = useSession((x) => x.devices)
  const connected = useSession((x) => x.status === 'connected')
  const [pick, setPick] = useState('local')
  // Motor controllers pass on their BMS's values; a BMS on CAN answers for itself.
  const sources = devices.filter((d) => d.motor || d.fw?.hwType === HW_TYPE.VESC_BMS)
  const info = pickTarget(sources, pick)
  const reading = useBms(info, connected)

  return (
    <>
      <BackToMore />
      <PageTitle title="Battery (BMS)" subtitle="Cell voltages, balancing, temperatures and charge, from a VESC-compatible BMS on the CAN bus." />
      <div className="mb-3">
        <TargetPicker devices={sources} value={info ? targetKey(info.target) : pick} onChange={setPick} label="Read from" />
      </div>
      {!connected && <Banner tone="info">Connect to a controller with a BMS on its CAN bus to see the battery here.</Banner>}
      {connected && reading.status === 'waiting' && <p className="card p-4 text-sm text-muted">Asking for battery data…</p>}
      {connected && reading.status === 'none' && (
        <div className="card p-5 text-sm text-muted">
          <h2 className="mb-1 font-semibold text-text">No BMS is reporting</h2>
          <p>
            {info ? targetLabel(info.target) : 'The controller'} hasn’t heard from a BMS. A VESC-compatible BMS needs to be on the same CAN bus and powered. Other
            battery systems don’t report here.
          </p>
        </div>
      )}
      {connected && reading.status === 'error' && <Banner tone="danger">{reading.message}</Banner>}
      {connected && reading.status === 'ok' && <BmsView v={reading.v} />}
    </>
  )
}

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="label text-[9.5px]">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num text-2xl font-semibold">{value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  )
}

function BmsView({ v }: { v: BmsValues }) {
  const sum = cellSummary(v)
  const power = v.vTotal * v.current
  const charging = v.current < -0.2
  return (
    <div className="space-y-4">
      <section className="card p-5" aria-label="Pack">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <BatteryCharging className="size-5 text-accent" />
          <h2 className="font-semibold">Pack</h2>
          {v.status && <Badge tone={/fault|error/i.test(v.status) ? 'warn' : 'muted'}>{v.status}</Badge>}
          {v.canId !== null && v.canId !== 255 && <span className="text-xs text-faint">BMS on CAN {v.canId}</span>}
        </div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Voltage" value={fmt(v.vTotal, 2)} unit="V" sub={v.vCharge > 0.5 ? `Charger ${fmt(v.vCharge, 1)} V` : undefined} />
          <Stat label={charging ? 'Charging' : 'Current'} value={fmt(Math.abs(v.current), 1)} unit="A" />
          <Stat label="Power" value={fmt(Math.abs(power), 0)} unit="W" />
          <Stat label="Charge" value={v.soc === null ? '–' : fmt(v.soc * 100, 0)} unit={v.soc === null ? undefined : '%'} />
          <Stat label="Health" value={v.soh === null ? '–' : fmt(v.soh * 100, 0)} unit={v.soh === null ? undefined : '%'} />
          <Stat label="Used" value={fmt(v.ahCount, 2)} unit="Ah" sub={`${fmt(v.whCount, 1)} Wh`} />
        </div>
        {v.soc !== null && (
          <div
            className="mt-5 h-2 overflow-hidden rounded-full bg-surface-3"
            role="meter"
            aria-label="State of charge"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(v.soc * 100)}
          >
            <div className={cx('h-full rounded-full', v.soc < 0.15 ? 'bg-danger' : v.soc < 0.3 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(1, v.soc)) * 100}%` }} />
          </div>
        )}
      </section>

      {sum && <Cells v={v} sum={sum} />}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-5" aria-label="Temperatures">
          <div className="mb-3 flex items-center gap-2">
            <Thermometer className="size-5 text-accent" />
            <h2 className="font-semibold">Temperatures</h2>
          </div>
          <dl className="divide-y divide-line">
            <Row label="Hottest cell" value={`${fmt(v.tempCellsHighest, 1)} °C`} />
            {v.temps.map((t, i) => (
              <Row key={i} label={`Sensor ${i + 1}`} value={t < -50 ? 'Not fitted' : `${fmt(t, 1)} °C`} />
            ))}
            <Row label="BMS chip" value={`${fmt(v.tempIc, 1)} °C`} />
            {v.humidity > 0 && <Row label="Humidity" value={`${fmt(v.humidity, 0)} % at ${fmt(v.tempHumSensor, 1)} °C`} />}
          </dl>
        </section>
        <section className="card p-5" aria-label="Counters">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="size-5 text-accent" />
            <h2 className="font-semibold">Totals</h2>
          </div>
          <dl className="divide-y divide-line">
            <Row label="Used since reset" value={`${fmt(v.ahCount, 2)} Ah · ${fmt(v.whCount, 1)} Wh`} />
            {v.ahChargeTotal !== null && <Row label="Charged, lifetime" value={`${fmt(v.ahChargeTotal, 1)} Ah · ${fmt(v.whChargeTotal, 0)} Wh`} />}
            {v.ahDischargeTotal !== null && <Row label="Discharged, lifetime" value={`${fmt(v.ahDischargeTotal, 1)} Ah · ${fmt(v.whDischargeTotal, 0)} Wh`} />}
            <Row label="Current (BMS chip)" value={`${fmt(v.currentIc, 2)} A`} />
          </dl>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="num text-sm">{value}</dd>
    </div>
  )
}

function Cells({ v, sum }: { v: BmsValues; sum: NonNullable<ReturnType<typeof cellSummary>> }) {
  // Bars show how far each cell sits above the lowest one: the number that matters for balance.
  const scaleMv = Math.max(20, sum.spread * 1000)
  return (
    <section className="card p-5" aria-label="Cells">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <h2 className="font-semibold">{v.cells.length} cells</h2>
        <span className="text-sm text-muted">
          Lowest <span className="num text-text">{fmt(sum.min, 3)} V</span> · highest <span className="num text-text">{fmt(sum.max, 3)} V</span> · spread{' '}
          <span className={cx('num', sum.spread > 0.05 ? 'text-warn' : 'text-text')}>{fmt(sum.spread * 1000, 0)} mV</span>
        </span>
        <span className="text-sm text-muted">{sum.balancing ? `${sum.balancing} balancing` : 'None balancing'}</span>
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {v.cells.map((c, i) => {
          const above = (c - sum.min) * 1000
          const lowest = i === sum.minIndex
          const highest = i === sum.maxIndex && sum.spread > 0
          const bal = v.balancing[i]
          return (
            <li
              key={i}
              className={cx('rounded-xl border px-3 py-2.5', lowest ? 'border-warn/40' : 'border-line')}
              aria-label={`Cell ${i + 1}: ${fmt(c, 3)} volts, ${fmt(above, 0)} millivolts above the lowest${bal ? ', balancing' : ''}${lowest ? ', lowest' : ''}`}
            >
              <div className="flex items-center justify-between text-[11px] text-faint">
                <span>Cell {i + 1}</span>
                {bal && <span className="text-accent">Balancing</span>}
                {!bal && lowest && <span className="text-warn">Lowest</span>}
                {!bal && highest && <span>Highest</span>}
              </div>
              <div className="num mt-0.5 text-[15px] font-semibold">{fmt(c, 3)}</div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <div className={cx('h-full rounded-full', bal ? 'bg-accent' : 'bg-muted/70')} style={{ width: `${Math.min(100, (above / scaleMv) * 100)}%` }} />
                </div>
                <span className="num w-10 text-right text-[11px] text-muted">+{fmt(above, 0)}</span>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-xs text-faint">Bars and numbers under each voltage: millivolts above the lowest cell.</p>
    </section>
  )
}
