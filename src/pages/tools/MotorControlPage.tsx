import { Keyboard, Loader2, OctagonX, Pencil, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import type { DeviceConfig } from '../../state/config'
import { targetKey } from '../../state/devices'
import {
  benchLimitOf,
  fmtValue,
  MODES,
  modeSpec,
  nudge,
  parseValue,
  presetValues,
  runDevices,
  setControlKey,
  setInput,
  setLatch,
  setLifted,
  setMode,
  slowsOnly,
  startControl,
  stopAll,
  stopControl,
  testLimit,
  toggleAlso,
  useMotorControl,
  type ControlMode,
} from '../../state/motorControl'
import { useSession } from '../../state/session'
import { useSettings, type BenchLimits, type LatchSeconds } from '../../state/settings'
import { useTelemetry } from '../../state/telemetry'
import { Button, PageTitle, Segmented } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { DevicePicker } from '../setup/common'
import { useMotorDevices } from '../setup/helpers'
import { BenchChart } from './BenchChart'
import { BackToMore } from './ToolBits'

/** Whether the panel's keys apply: not while a control that uses them has focus. */
function panelKeys(el: Element | null) {
  if (!el || el === document.body) return true
  if (el instanceof HTMLElement && el.dataset.benchKeys !== undefined) return true
  return !el.closest('button, input, select, textarea, a, [role="radio"], [role="switch"], [contenteditable]')
}

/** Space or the hold button let go: a held run stops, a latched one carries on. */
function releaseHold() {
  const r = useMotorControl.getState().run
  if (r && !r.latched) stopControl()
}

export function MotorControlPage() {
  const list = useMotorDevices()
  const connected = useSession((s) => s.status === 'connected')
  const st = useMotorControl()
  const runDevs = runDevices(st)
  const main = runDevs[0] ?? null

  // Space runs, arrows adjust; Escape is handled by the run itself.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!panelKeys(document.activeElement)) return
      if (e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        const s = useMotorControl.getState()
        if (s.latch && s.run) stopControl()
        else startControl(s.latch)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !panelKeys(document.activeElement)) return
      e.preventDefault()
      releaseHold()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      stopControl()
    }
  }, [])

  return (
    <>
      <BackToMore />
      <PageTitle
        title="Motor control"
        subtitle="Drive a motor on the bench to test it."
        actions={<DemoPark />}
      />
      {!connected || !list.length ? (
        <p className="card flex items-center gap-2 p-5 text-sm text-muted">
          {connected ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Reading controller settings…
            </>
          ) : (
            'Connect to a motor controller to drive it from here.'
          )}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <LiftedCard />
            <section className="card space-y-4 p-5" aria-label="What to drive">
              <DevicePicker list={list} value={main?.key ?? null} onChange={setControlKey} label="Controller" />
              {list.length > 1 && main && <AlsoDrive list={list} main={main} also={st.also} />}
              <div>
                <div className="label mb-1.5">Mode</div>
                <div className="overflow-x-auto">
                  <Segmented<ControlMode> label="Control mode" value={st.mode} onChange={setMode} options={MODES.map((m) => ({ value: m.mode, label: m.label }))} />
                </div>
                <p className="mt-2 text-sm text-muted">{modeSpec(st.mode).help}</p>
              </div>
              <ValueBox devs={runDevs} />
            </section>
          </div>
          <div className="space-y-4">
            <RunCard devs={runDevs} />
            {main && <Readouts devs={runDevs} />}
            {main && (
              <section className="card p-5" aria-label="Response">
                <h2 className="mb-3 text-sm font-semibold">Response</h2>
                <BenchChart key={main.key} target={main.target} />
              </section>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function LiftedCard() {
  const lifted = useMotorControl((s) => s.lifted)
  return (
    <label className={cx('card flex cursor-pointer items-start gap-3 p-4', !lifted && 'border-warn/40')}>
      <input type="checkbox" checked={lifted} onChange={(e) => setLifted(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" />
      <span className="text-sm">
        <span className="flex items-center gap-1.5 font-semibold">
          {!lifted && <TriangleAlert className="size-4 text-warn" />} The wheel is off the ground and free to turn
        </span>
        <span className="mt-0.5 block text-muted">
          The motor will turn. Keep hands, cables and clothing clear, and keep the vehicle from rolling.
        </span>
      </span>
    </label>
  )
}

function AlsoDrive({ list, main, also }: { list: DeviceConfig[]; main: DeviceConfig; also: string[] }) {
  const others = list.filter((d) => d.key !== main.key)
  return (
    <div>
      <div className="label mb-1.5">Also drive</div>
      <div className="flex flex-wrap gap-2">
        {others.map((d) => (
          <label key={d.key} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 text-sm">
            <input type="checkbox" checked={also.includes(d.key)} onChange={() => toggleAlso(d.key)} className="size-4 accent-[var(--accent)]" />
            {d.name}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">They get the same command at the same time.</p>
    </div>
  )
}

function ValueBox({ devs }: { devs: DeviceConfig[] }) {
  const mode = useMotorControl((s) => s.mode)
  const input = useMotorControl((s) => s.inputs[s.mode])
  const inputError = useMotorControl((s) => s.inputError)
  const run = useMotorControl((s) => s.run)
  const benchLimits = useSettings((s) => s.benchLimits)
  const [editing, setEditing] = useState(false)
  const spec = modeSpec(mode)
  const lim = testLimit(mode, devs, benchLimits)
  const limit = 'error' in lim ? null : lim.limit
  const check = limit === null ? null : parseValue(mode, input, limit)

  return (
    <div>
      <label className="block">
        <span className="label mb-1.5 block">Value</span>
        <span className="flex items-center gap-2">
          <input
            data-bench-keys=""
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={!!check && 'error' in check}
            aria-describedby="bench-limit"
            className="focus-ring num h-12 w-36 rounded-xl border border-line-strong bg-surface-2 px-3 text-right text-xl"
          />
          <span className="text-base text-muted">{spec.unit}</span>
          {run && <span className="num ml-2 text-sm text-accent">driving {fmtValue(run.mode, run.value)}</span>}
        </span>
      </label>
      {inputError ? (
        <p className="mt-1.5 text-sm text-warn">{inputError}</p>
      ) : (
        check && 'error' in check && <p className="mt-1.5 text-sm text-warn">{check.error}</p>
      )}
      {limit !== null && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Presets">
          {presetValues(mode, limit).map((v, i) => (
            <button
              key={i}
              onClick={() => setInput(fmtValue(mode, v))}
              className={cx('focus-ring num h-9 rounded-lg border px-3 text-sm', Number(input) === v ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text')}
            >
              {fmtValue(mode, v)}
              <span className="ml-1 text-[11px] text-faint">{[10, 25, 50, 75, 100][i]}%</span>
            </button>
          ))}
        </div>
      )}
      <p id="bench-limit" className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {'error' in lim ? (
          <span className="text-warn">{lim.error}</span>
        ) : (
          <>
            Test limit {spec.signed ? '±' : ''}
            {fmtValue(mode, lim.limit)} {spec.unit}, set by {lim.by}.{spec.signed && ' Negative turns the other way.'}
            {mode !== 'pos' && !editing && (
              <button onClick={() => setEditing(true)} className="focus-ring inline-flex items-center gap-1 rounded text-accent hover:underline">
                <Pencil className="size-3" /> Change
              </button>
            )}
          </>
        )}
      </p>
      {editing && mode !== 'pos' && <BenchLimitEditor mode={mode} devs={devs} onDone={() => setEditing(false)} />}
    </div>
  )
}

function BenchLimitEditor({ mode, devs, onDone }: { mode: Exclude<ControlMode, 'pos'>; devs: DeviceConfig[]; onDone: () => void }) {
  const spec = modeSpec(mode)
  const current = useSettings((s) => benchLimitOf(mode, s.benchLimits))
  const [text, setText] = useState(fmtValue(mode, current))
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    const v = Number(text.trim().replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) return setError('Enter a number above zero.')
    // The controllers' own limits, ignoring the bench limit.
    const own = testLimit(mode, devs, { [mode]: Infinity } as unknown as BenchLimits)
    if ('error' in own) return setError(own.error)
    if (v > own.limit + 1e-9) return setError(`That’s above ${own.by.replace(/’s own limit$/, '')}’s own limit of ${fmtValue(mode, own.limit)} ${spec.unit}. Raise that in the motor settings first.`)
    stopControl()
    useSettings.getState().setBenchLimit(mode, v)
    onDone()
  }
  return (
    <div className="mt-2 rounded-xl border border-line-strong bg-surface-2 p-3">
      <label className="block text-sm">
        <span className="font-medium">Bench limit for {spec.label.toLowerCase()}</span>
        <span className="mt-1 flex items-center gap-2">
          <input
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="focus-ring num h-9 w-28 rounded-lg border border-line-strong bg-surface px-2 text-right text-sm"
          />
          <span className="text-muted">{spec.unit}</span>
          <Button variant="primary" className="h-9" onClick={save}>
            Save
          </Button>
          <Button variant="ghost" className="h-9" onClick={onDone}>
            Cancel
          </Button>
        </span>
      </label>
      {error && <p className="mt-1.5 text-sm text-warn">{error}</p>}
    </div>
  )
}

function RunCard({ devs }: { devs: DeviceConfig[] }) {
  const run = useMotorControl((s) => s.run)
  const latch = useMotorControl((s) => s.latch)
  const lifted = useMotorControl((s) => s.lifted)
  const mode = useMotorControl((s) => s.mode)
  const error = useMotorControl((s) => s.error)
  const input = useMotorControl((s) => s.inputs[s.mode])
  const benchLimits = useSettings((s) => s.benchLimits)
  const latchSeconds = useSettings((s) => s.latchSeconds)
  // The value box already shows what's wrong with the value; don't say it twice.
  const lim = testLimit(mode, devs, benchLimits)
  const checked = 'error' in lim ? lim : parseValue(mode, input, lim.limit)
  const shownByValue = 'error' in checked ? checked.error : null
  const now = useNow(run ? 250 : 5000)
  const left = run ? Math.max(0, Math.ceil((run.endsAt - now) / 1000)) : 0
  const names = devs.map((d) => d.name).join(' and ')

  return (
    <section className="card sticky bottom-24 z-10 space-y-3 p-5 md:bottom-4" aria-label="Run">
      <div className="flex flex-wrap items-stretch gap-3">
        <button
          data-bench-keys=""
          disabled={!lifted}
          onPointerDown={(e) => {
            if (latch || e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            startControl(false)
          }}
          onPointerUp={releaseHold}
          onPointerCancel={releaseHold}
          onLostPointerCapture={releaseHold}
          onClick={(e) => {
            // Keyboard presses are handled by the panel (Space); this is for latched clicks and taps.
            if (!latch || e.detail === 0) return
            if (useMotorControl.getState().run) stopControl()
            else startControl(true)
          }}
          onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none' }}
          className={cx(
            'focus-ring h-16 min-w-[200px] flex-1 rounded-2xl border px-5 text-base font-semibold transition-colors select-none disabled:opacity-40',
            run ? 'border-accent bg-accent/25 text-accent' : 'border-accent/50 bg-accent/10 text-text hover:bg-accent/15',
          )}
        >
          {run
            ? run.latched
              ? `Running · stops in ${left} s`
              : 'Running… let go to stop'
            : latch
              ? `Run for ${latchSeconds} s`
              : slowsOnly(mode)
                ? 'Hold to brake'
                : 'Hold to run'}
        </button>
        <button
          onClick={() => stopControl()}
          className="focus-ring inline-flex h-16 items-center gap-2 rounded-2xl border border-danger/50 bg-danger/15 px-6 text-base font-bold text-danger"
        >
          <OctagonX className="size-5" /> Stop
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm">
            <Toggle checked={latch} onChange={setLatch} label="Latch on" />
            Latch on
          </span>
          {latch && (
            <Segmented<LatchSeconds>
              label="Latch time"
              value={latchSeconds}
              onChange={(v) => {
                stopControl()
                useSettings.getState().setLatchSeconds(v)
              }}
              options={[5, 10, 30, 60].map((v) => ({ value: v as LatchSeconds, label: `${v} s` }))}
            />
          )}
        </div>
        <Button variant="danger" className="h-9" onClick={stopAll} title="Stops every motor on every controller, including tests">
          Stop all
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Keyboard className="size-3.5" /> Space {latch ? 'starts and stops' : 'runs while held'} · ↑ ↓ adjust (Shift ×10) · Esc stops
      </p>
      {run && <p className="text-xs text-muted">Driving {names}. Letting go, leaving the page or switching apps stops it.</p>}
      {error && !run && error !== shownByValue && <p className="text-sm text-warn">{error}</p>}
    </section>
  )
}

const fmt = (x: number | undefined, digits: number) => (x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(digits))

function Readouts({ devs }: { devs: DeviceConfig[] }) {
  const values = useTelemetry((s) => s.devices)
  return (
    <section className="card p-5" aria-label="Live readouts">
      {devs.map((d, i) => {
        const v = values[targetKey(d.target)]
        return (
          <div key={d.key} className={cx(i > 0 && 'mt-4 border-t border-line pt-4')}>
            {devs.length > 1 && <div className="mb-2 text-sm font-semibold">{d.name}</div>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Readout label="ERPM" value={fmt(v?.rpm, 0)} big />
              <Readout label="Position" value={fmt(v?.pidPos, 1)} unit="°" big />
              <Readout label="Motor current" value={fmt(v?.currentMotor, 1)} unit="A" />
              <Readout label="Battery current" value={fmt(v?.currentIn, 1)} unit="A" />
              <Readout label="Duty" value={fmt(v ? v.dutyNow * 100 : undefined, 1)} unit="%" />
              <Readout label="Battery" value={fmt(v?.vIn, 1)} unit="V" />
              <Readout label="Controller temp" value={fmt(v?.tempFet, 1)} unit="°C" warn={!!v && v.tempFet > 80} />
              <Readout label="Motor temp" value={fmt(v?.tempMotor, 1)} unit="°C" warn={!!v && v.tempMotor > 100} />
            </dl>
          </div>
        )
      })}
    </section>
  )
}

function Readout({ label, value, unit, big, warn }: { label: string; value: string; unit?: string; big?: boolean; warn?: boolean }) {
  return (
    <div>
      <dt className="label text-[9.5px]">{label}</dt>
      <dd className={cx('num mt-0.5 font-semibold', big ? 'text-2xl' : 'text-lg', warn ? 'text-warn' : 'text-text')}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </dd>
    </div>
  )
}
