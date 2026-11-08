import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ConfigValues } from '../../config/types'
import { cx, fmt } from '../../lib/format'
import { adcEnds, appToUse, emptyRange, ppmEnds, widen, type Range } from '../../lib/setupMath'
import { pendingCount, useConfig, type DeviceConfig } from '../../state/config'
import { markSetupDone } from '../../state/setupProgress'
import { activeClient, setDemoHandInput, useSession } from '../../state/session'
import { Button, PageTitle } from '../../ui/Primitives'
import { WriteDialog } from '../config/WriteDialog'
import { BackToSetup, DevicePicker, NotReady, Steps } from './common'
import { NextStep } from './SetupSteps'
import { useMotorDevices } from './helpers'

type Input = 'adc' | 'ppm'
type Step = 'choose' | 'prepare' | 'rest' | 'throttle' | 'brake' | 'review' | 'done'

const ADC_CTRL_OFF = 0
const ADC_CTRL_CURRENT = 1
const ADC_CTRL_BRAKE_ADC2 = 8
const PPM_CTRL_OFF = 0
const PPM_CTRL_BRAKE = 3

type PpmEnds = { start: number; center: number; end: number }
const isPpm = (x: object): x is PpmEnds => 'center' in x

interface Reading {
  a: number // ADC1 volts, or PPM pulse ms
  b: number // ADC2 volts (NaN for PPM)
}

/** Polls the decoded input ten times a second. */
function useReading(d: DeviceConfig | null, input: Input, on: boolean): Reading | null {
  const [r, setR] = useState<Reading | null>(null)
  useEffect(() => {
    if (!on || !d) return
    let busy = false
    let alive = true
    const t = setInterval(async () => {
      const client = activeClient()
      if (busy || !client) return
      busy = true
      try {
        if (input === 'adc') {
          const x = await client.getDecodedAdc({ target: d.target, priority: 'low', retries: 0 })
          if (alive) setR({ a: x.voltage, b: x.voltage2 })
        } else {
          const x = await client.getDecodedPpm({ target: d.target, priority: 'low', retries: 0 })
          if (alive) setR({ a: x.pulseMs, b: NaN })
        }
      } catch {
        // a missed reading; the next one follows
      } finally {
        busy = false
      }
    }, 100)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [d, input, on])
  return r
}

export function InputWizard() {
  const list = useMotorDevices()
  const ready = list.length > 0 && list.every((d) => d.mcconf.status === 'ready' && d.appconf.status === 'ready')
  if (!ready) return <NotReady title="Throttle and brake" what="calibrate the throttle" list={list} />
  return <InputSteps list={list} />
}

function InputSteps({ list }: { list: DeviceConfig[] }) {
  const devices = useConfig((s) => s.devices)
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const [key, setKey] = useState(list[0].key)
  const [input, setInput] = useState<Input>('adc')
  const [brake, setBrake] = useState(true)
  const [step, setStep] = useState<Step>('choose')
  const [writing, setWriting] = useState<null | 'prepare' | 'final'>(null)
  const d = devices[key] ?? list[0]
  const app = d.appconf.device as ConfigValues
  const reading = useReading(d, input, step === 'rest' || step === 'throttle' || step === 'brake' || step === 'review')
  const [rest, setRest] = useState<{ a: Range; b: Range }>({ a: emptyRange(), b: emptyRange() })
  const [full, setFull] = useState<{ a: Range; b: Range }>({ a: emptyRange(), b: emptyRange() })
  const [brakeFull, setBrakeFull] = useState<Range>(emptyRange())
  const recording = useRef<'rest' | 'throttle' | 'brake' | null>(null)

  // Ranges grow while the matching step is open.
  useEffect(() => {
    if (!reading) return
    const mode = recording.current
    if (mode === 'rest') setRest((r) => ({ a: widen(r.a, reading.a), b: widen(r.b, reading.b) }))
    if (mode === 'throttle') setFull((r) => ({ a: widen(r.a, reading.a), b: widen(r.b, reading.b) }))
    if (mode === 'brake') setBrakeFull((r) => widen(r, reading.b))
  }, [reading])
  useEffect(() => () => setDemoHandInput(null), [])

  const steps = input === 'adc' && brake ? ['Input', 'Prepare', 'Released', 'Throttle', 'Brake', 'Review'] : ['Input', 'Prepare', 'Released', input === 'ppm' ? 'Both ends' : 'Throttle', 'Review']
  const order: Step[] = input === 'adc' && brake ? ['choose', 'prepare', 'rest', 'throttle', 'brake', 'review'] : ['choose', 'prepare', 'rest', 'throttle', 'review']
  const at = Math.min(order.indexOf(step === 'done' ? 'review' : step), steps.length - 1)

  const inCalMode =
    input === 'adc'
      ? [2, 5, 10].includes(Number(app.app_to_use)) && Number(app['app_adc_conf.ctrl_type']) === ADC_CTRL_OFF
      : [1, 4].includes(Number(app.app_to_use)) && Number(app['app_ppm_conf.ctrl_type']) === PPM_CTRL_OFF
  const pending = pendingCount(d.appconf) > 0

  const go = (s: Step) => {
    recording.current = s === 'rest' || s === 'throttle' || s === 'brake' ? s : null
    if (s === 'rest') setRest({ a: emptyRange(), b: emptyRange() })
    if (s === 'throttle') setFull({ a: emptyRange(), b: emptyRange() })
    if (s === 'brake') setBrakeFull(emptyRange())
    setStep(s)
  }

  const prepare = () => {
    const patch: ConfigValues = { app_to_use: appToUse(input, Number(app.app_to_use)) }
    if (input === 'adc') patch['app_adc_conf.ctrl_type'] = ADC_CTRL_OFF
    else patch['app_ppm_conf.ctrl_type'] = PPM_CTRL_OFF
    useConfig.getState().edit(d.key, 'appconf', patch)
    setWriting('prepare')
  }

  // Final values.
  const thr = input === 'adc' ? adcEnds(rest.a, full.a) : ppmEnds(rest.a, full.a)
  const brk = input === 'adc' && brake ? adcEnds(rest.b, brakeFull) : null
  const problem = typeof thr === 'string' ? thr : typeof brk === 'string' ? `Brake: ${brk}` : null

  const finish = () => {
    if (problem || typeof thr === 'string') return
    const patch: ConfigValues = { app_to_use: appToUse(input, Number(app.app_to_use)) }
    if (!isPpm(thr)) {
      patch['app_adc_conf.ctrl_type'] = brake ? ADC_CTRL_BRAKE_ADC2 : ADC_CTRL_CURRENT
      patch['app_adc_conf.voltage_start'] = thr.start
      patch['app_adc_conf.voltage_end'] = thr.end
      patch['app_adc_conf.voltage_inverted'] = 0
      if (brk && typeof brk !== 'string') {
        patch['app_adc_conf.voltage2_start'] = brk.start
        patch['app_adc_conf.voltage2_end'] = brk.end
        patch['app_adc_conf.voltage2_inverted'] = 0
      }
    } else {
      patch['app_ppm_conf.ctrl_type'] = PPM_CTRL_BRAKE
      patch['app_ppm_conf.pulse_start'] = thr.start
      patch['app_ppm_conf.pulse_center'] = thr.center
      patch['app_ppm_conf.pulse_end'] = thr.end
    }
    useConfig.getState().edit(d.key, 'appconf', patch)
    setWriting('final')
  }

  return (
    <>
      <BackToSetup />
      <PageTitle title="Throttle and brake" subtitle="Reads your throttle and brake while you move them, then sets the controller to match." />
      <Steps steps={steps} at={at} />

      <section className="card space-y-4 p-5">
        {step === 'choose' && (
          <>
            <DevicePicker list={list} value={key} onChange={setKey} label="Controller the throttle is wired to" />
            <div>
              <div className="text-sm font-medium">What kind of input?</div>
              <div role="radiogroup" className="mt-1.5 flex flex-wrap gap-1.5">
                {(
                  [
                    ['adc', 'Throttle and lever (ADC)'],
                    ['ppm', 'RC remote (PPM)'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={input === v}
                    onClick={() => setInput(v)}
                    className={cx('focus-ring h-10 rounded-xl border px-3.5 text-sm', input === v ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {input === 'adc' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={brake} onChange={(e) => setBrake(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                There’s a brake lever with a sensor on the second input (ADC2)
              </label>
            )}
            <p className="text-xs text-muted">Bluetooth modules on the UART port keep working: Ohmic keeps UART on alongside the new input.</p>
            <Button variant="primary" onClick={() => go('prepare')}>
              Next
            </Button>
          </>
        )}

        {step === 'prepare' && (
          <>
            <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3.5 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>
                While calibrating, the throttle is switched off in the settings so the motor can’t respond to it. Keep the vehicle
                stopped.
              </span>
            </div>
            {inCalMode ? (
              <p className="text-sm text-ok">The controller is already reading the {input === 'adc' ? 'throttle' : 'remote'} without driving the motor.</p>
            ) : (
              <p className="text-sm text-muted">
                This writes two settings to {d.name}: the input to use, and its control mode set to Off. You’ll review them first.
              </p>
            )}
            {pending && <p className="text-xs text-warn">{d.name} has app-setting edits that aren’t written yet. Write or discard them in Config first.</p>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => go('choose')}>
                Back
              </Button>
              {inCalMode ? (
                <Button variant="primary" onClick={() => go('rest')}>
                  Start calibrating
                </Button>
              ) : (
                <Button variant="primary" disabled={pending} onClick={prepare}>
                  Review and switch the throttle off
                </Button>
              )}
            </div>
          </>
        )}

        {(step === 'rest' || step === 'throttle' || step === 'brake' || step === 'review') && (
          <LiveBars input={input} brake={input === 'adc' && brake} reading={reading} rest={rest} full={full} brakeFull={brakeFull} />
        )}

        {isDemo && (step === 'rest' || step === 'throttle' || step === 'brake') && <DemoHand />}

        {step === 'rest' && (
          <StepBox
            text={input === 'adc' ? 'Let go of the throttle and brake, and leave them released.' : 'Let go of the remote’s throttle so it rests in the middle.'}
            ready={Number.isFinite(rest.a.min)}
            onBack={() => go('prepare')}
            onNext={() => go('throttle')}
          />
        )}
        {step === 'throttle' && (
          <StepBox
            text={input === 'adc' ? 'Push the throttle all the way, hold a moment, then let go.' : 'Push the throttle fully forward, then pull the brake fully back, then let go.'}
            ready={typeof (input === 'adc' ? adcEnds(rest.a, full.a) : ppmEnds(rest.a, full.a)) !== 'string'}
            onBack={() => go('rest')}
            onNext={() => go(input === 'adc' && brake ? 'brake' : 'review')}
          />
        )}
        {step === 'brake' && (
          <StepBox text="Squeeze the brake lever all the way, hold a moment, then let go." ready={typeof adcEnds(rest.b, brakeFull) !== 'string'} onBack={() => go('throttle')} onNext={() => go('review')} />
        )}

        {step === 'review' && (
          <>
            {problem ? (
              <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">{problem}</p>
            ) : (
              <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {typeof thr !== 'string' && isPpm(thr) ? (
                  <>
                    <dt className="text-muted">Full brake</dt>
                    <dd className="num text-right">{fmt(thr.start, 3)} ms</dd>
                    <dt className="text-muted">Centre</dt>
                    <dd className="num text-right">{fmt(thr.center, 3)} ms</dd>
                    <dt className="text-muted">Full throttle</dt>
                    <dd className="num text-right">{fmt(thr.end, 3)} ms</dd>
                  </>
                ) : typeof thr !== 'string' ? (
                  <>
                    <dt className="text-muted">Throttle starts at</dt>
                    <dd className="num text-right">{fmt(thr.start, 2)} V</dd>
                    <dt className="text-muted">Full throttle at</dt>
                    <dd className="num text-right">{fmt(thr.end, 2)} V</dd>
                    {brk && typeof brk !== 'string' && (
                      <>
                        <dt className="text-muted">Brake starts at</dt>
                        <dd className="num text-right">{fmt(brk.start, 2)} V</dd>
                        <dt className="text-muted">Full brake at</dt>
                        <dd className="num text-right">{fmt(brk.end, 2)} V</dd>
                      </>
                    )}
                  </>
                ) : null}
              </dl>
            )}
            <p className="text-xs text-muted">
              Writing this switches the throttle back on{input === 'adc' && brake ? ', with braking on the lever' : ''}. Lift the drive wheel for the first try.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => go('rest')}>
                Start over
              </Button>
              <Button variant="primary" disabled={!!problem || pending} onClick={finish}>
                Review and write
              </Button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="text-sm text-ok">
              Done. Try the throttle gently with the wheel lifted; it should start smoothly just past rest and reach full power at the end of its travel.
            </p>
            <NextStep step="input" />
          </>
        )}
      </section>

      {writing && (
        <WriteDialog
          open
          deviceKey={d.key}
          deviceKeys={[d.key]}
          kind="appconf"
          onClose={() => {
            const was = writing
            setWriting(null)
            // Move on only once the controller holds the new settings.
            const fresh = useConfig.getState().devices[d.key]
            if (pendingCount(fresh?.appconf) > 0) {
              // Not written: drop the wizard's edits so they don't linger in Config.
              useConfig.getState().discard(d.key, 'appconf')
              return
            }
            if (was === 'prepare') go('rest')
            else {
              setStep('done')
              markSetupDone('input')
            }
          }}
        />
      )}
    </>
  )
}

function StepBox({ text, ready, onBack, onNext }: { text: string; ready: boolean; onBack: () => void; onNext: () => void }) {
  return (
    <>
      <p className="text-base font-medium">{text}</p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" disabled={!ready} onClick={onNext}>
          {ready ? 'Next' : 'Waiting for movement…'}
        </Button>
      </div>
    </>
  )
}

function LiveBars({
  input,
  brake,
  reading,
  rest,
  full,
  brakeFull,
}: {
  input: Input
  brake: boolean
  reading: Reading | null
  rest: { a: Range; b: Range }
  full: { a: Range; b: Range }
  brakeFull: Range
}) {
  const scale: Scale = input === 'adc' ? { lo: 0, hi: 3.3, unit: 'V', digits: 2 } : { lo: 0.8, hi: 2.2, unit: 'ms', digits: 3 }
  return (
    <div className="space-y-3">
      <Bar label={input === 'adc' ? 'Throttle (ADC1)' : 'Remote pulse'} v={reading?.a} seen={[rest.a, full.a]} scale={scale} />
      {brake && <Bar label="Brake (ADC2)" v={reading?.b} seen={[rest.b, brakeFull]} scale={scale} />}
    </div>
  )
}

interface Scale {
  lo: number
  hi: number
  unit: string
  digits: number
}

/** One input's live position, with the ranges seen so far shaded. */
function Bar({ label, v, seen, scale }: { label: string; v: number | undefined; seen: Range[]; scale: Scale }) {
  const { lo, hi, unit, digits } = scale
  const pct = (x: number) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="num font-semibold">
          {v === undefined || !Number.isFinite(v) ? '—' : fmt(v, digits)} <span className="text-xs font-normal text-muted">{unit}</span>
        </span>
      </div>
      <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-surface-3">
        {seen
          .filter((r) => Number.isFinite(r.min))
          .map((r, i) => (
            <div key={i} className="absolute inset-y-0 bg-accent/25" style={{ left: pct(r.min), width: `calc(${pct(r.max)} - ${pct(r.min)})` }} />
          ))}
        {v !== undefined && Number.isFinite(v) && <div className="absolute inset-y-0 w-1 rounded-full bg-accent" style={{ left: pct(v) }} />}
      </div>
    </div>
  )
}

/** Demo only: stands in for a hand on the throttle and brake. */
function DemoHand() {
  const [t, setT] = useState(0)
  const [b, setB] = useState(0)
  useEffect(() => setDemoHandInput({ throttle: t, brake: b }), [t, b])
  return (
    <div className="rounded-xl border border-dashed border-line-strong p-3 text-xs text-muted">
      <div className="mb-1.5">Demo: drag these to move the simulated throttle and brake.</div>
      <label className="flex items-center gap-2">
        Throttle
        <input type="range" min={0} max={1} step={0.01} value={t} onChange={(e) => setT(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
      </label>
      <label className="mt-1 flex items-center gap-2">
        Brake
        <input type="range" min={0} max={1} step={0.01} value={b} onChange={(e) => setB(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
      </label>
    </div>
  )
}
