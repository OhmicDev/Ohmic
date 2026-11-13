import { ArrowDown, ArrowUp, Check, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cx } from '../../lib/format'
import { erpmForSpeed } from '../../lib/rideModes'
import { pendingCount, useConfig, type DeviceConfig } from '../../state/config'
import { targetKey } from '../../state/devices'
import { useMotionBlock } from '../../state/motion'
import { useMotorTest } from '../../state/motorTest'
import { useRideModes } from '../../state/rideModes'
import { markSetupDone } from '../../state/setupProgress'
import { demoWheelDirection, useSession } from '../../state/session'
import { Button, PageTitle } from '../../ui/Primitives'
import { DemoPark } from '../config/LiveStrip'
import { WriteDialog } from '../config/WriteDialog'
import { BackToSetup, HoldToRun, NotReady } from './common'
import { NextStep } from './SetupSteps'
import { useMotorDevices } from './helpers'

/** A gentle test speed: about walking pace, within what sensorless control handles. */
function testErpm(d: DeviceConfig): number {
  const e = erpmForSpeed(4, d.mcconf.device!)
  return Number.isFinite(e) ? Math.round(Math.min(2500, Math.max(700, e))) : 1000
}

export function DirectionWizard() {
  const list = useMotorDevices()
  const ready = list.length > 0 && list.every((d) => d.mcconf.status === 'ready')
  if (!ready) return <NotReady title="Motor direction" what="check motor direction" list={list} />
  return <DirectionChecks list={list} />
}

function DirectionChecks({ list }: { list: DeviceConfig[] }) {
  const motors = useRideModes((s) => s.motors)
  const isDemo = useSession((s) => s.transportKind === 'mock')
  // Controllers whose wheel was seen turning forward.
  const [forward, setForward] = useState<Record<string, boolean>>({})
  const allForward = list.every((d) => forward[d.key])
  useEffect(() => {
    if (allForward) markSetupDone('direction')
  }, [allForward])
  return (
    <>
      <BackToSetup />
      <PageTitle
        title="Motor direction"
        subtitle="Check each wheel turns forward. Ohmic flips any that don’t."
      />
      <div className="card mb-4 flex gap-3 border-warn/30 bg-warn/5 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
        <div>
          <div className="font-semibold text-warn">Lift the wheel off the ground first</div>
          <p className="mt-0.5 text-muted">
            The wheel turns slowly while you hold the button and stops when you let go, switch away from the app or press
            Escape. Keep hands, feet and cables clear of it.
          </p>
        </div>
      </div>
      {motors === 'single' && (
        <p className="card mb-4 p-4 text-sm text-warn">Single-motor mode is on, so one motor can’t turn. Switch to Dual on the dashboard first.</p>
      )}
      {isDemo && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted">
          <DemoPark /> The demo scooter must be parked for motor tests. Its second motor is wired backwards on purpose.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((d) => (
          <MotorCheck key={d.key} d={d} onAnswer={(ok) => setForward((f) => ({ ...f, [d.key]: ok }))} />
        ))}
      </div>
      {allForward && (
        <section className="card mt-4 space-y-3 p-5" aria-label="Direction checked">
          <p className="flex items-center gap-2 text-sm text-ok">
            <Check className="size-4" aria-hidden /> {list.length > 1 ? 'Every wheel turns forward.' : 'The wheel turns forward.'}
          </p>
          <NextStep step="direction" />
        </section>
      )}
    </>
  )
}

function MotorCheck({ d, onAnswer }: { d: DeviceConfig; onAnswer: (forward: boolean) => void }) {
  const [answer, setAnswerState] = useState<'forward' | 'backwards' | null>(null)
  const setAnswer = (a: 'forward' | 'backwards' | null) => {
    setAnswerState(a)
    onAnswer(a === 'forward')
  }
  const [tested, setTested] = useState(false)
  const [writing, setWriting] = useState(false)
  const motion = useMotionBlock([d.target], 'run a motor test')
  const isDemo = useSession((s) => s.transportKind === 'mock')
  const inverted = Number(d.mcconf.device?.m_invert_direction) === 1
  const pending = pendingCount(d.mcconf) > 0
  const demoDir = isDemo && tested ? demoWheelDirection(d.target) : null
  // Marked tested once this wheel has been turned.
  useEffect(
    () =>
      useMotorTest.subscribe((s) => {
        if (s.running === targetKey(d.target)) setTested(true)
      }),
    [d.target],
  )

  const flip = () => {
    useConfig.getState().edit(d.key, 'mcconf', { m_invert_direction: inverted ? 0 : 1 })
    setWriting(true)
  }

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{d.name}</h2>
        <span className="text-xs text-muted">Direction setting: {inverted ? 'inverted' : 'normal'}</span>
      </div>
      <div className="mt-3">
        <HoldToRun target={d.target} erpm={testErpm(d)} label="Hold to turn the wheel" disabled={!!motion && !tested} />
        {motion && !tested && <p className="mt-2 text-xs text-warn">{motion}</p>}
      </div>
      <div className="mt-4">
        <div className="text-sm font-medium">Which way did it turn?</div>
        {demoDir !== null && <p className="text-xs text-faint">Demo: the simulated wheel turned {demoDir > 0 ? 'forward' : 'backwards'}.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => setAnswer('forward')}
            aria-pressed={answer === 'forward'}
            className={cx('focus-ring inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm', answer === 'forward' ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line-strong text-muted hover:text-text')}
          >
            <ArrowUp className="size-4" /> Forward
          </button>
          <button
            onClick={() => setAnswer('backwards')}
            aria-pressed={answer === 'backwards'}
            className={cx('focus-ring inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm', answer === 'backwards' ? 'border-warn/50 bg-warn/10 text-warn' : 'border-line-strong text-muted hover:text-text')}
          >
            <ArrowDown className="size-4" /> Backwards
          </button>
        </div>
        {answer === 'forward' && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ok">
            <Check className="size-4" /> Good, nothing to change.
          </p>
        )}
        {answer === 'backwards' && (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted">
              Ohmic will {inverted ? 'set the direction back to normal' : 'invert the direction'} for {d.name}. Test again after writing.
            </p>
            {pending && <p className="text-xs text-warn">This controller has motor-setting edits that aren’t written yet; they’d be written too. Write or discard them in Tune first.</p>}
            <Button variant="primary" disabled={pending} onClick={flip}>
              Review the change
            </Button>
          </div>
        )}
      </div>
      {writing && (
        <WriteDialog
          open
          onClose={() => {
            setWriting(false)
            setTested(false)
            if (pendingCount(useConfig.getState().devices[d.key]?.mcconf) > 0) {
              // Not written: drop the edit and keep the answer, so it can be tried again.
              useConfig.getState().discard(d.key, 'mcconf')
              return
            }
            setAnswer(null)
          }}
          deviceKey={d.key}
          deviceKeys={[d.key]}
          kind="mcconf"
        />
      )}
    </section>
  )
}
