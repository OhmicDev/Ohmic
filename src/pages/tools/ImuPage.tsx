import { Compass, Crosshair, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { makeItem, type WriteItem } from '../../config/write'
import { cx, fmt } from '../../lib/format'
import { IMU_CAL_PARAMS, type ImuCalibration, type ImuData } from '../../protocol/imu'
import { deviceKey, useConfig } from '../../state/config'
import { targetKey, targetLabel } from '../../state/devices'
import { requestImu } from '../../state/live'
import { motionBlock } from '../../state/motion'
import { activeClient, sessionEvents, useSession } from '../../state/session'
import { Button, PageTitle } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { WriteDialog } from '../config/WriteDialog'
import { pickTarget } from './pickTarget'
import { TargetPicker } from './TargetPicker'
import { BackToMore, Banner, Progress } from './ToolBits'

const DEG = 180 / Math.PI

export function ImuPage() {
  const devices = useSession((x) => x.devices)
  const connected = useSession((x) => x.status === 'connected')
  const isDemo = useSession((x) => x.transportKind === 'mock')
  const motors = devices.filter((d) => d.motor)
  const [pick, setPick] = useState('local')
  const info = pickTarget(motors, pick)
  const key = info ? targetKey(info.target) : ''
  const latest = useRef<ImuData | null>(null)
  const [shown, setShown] = useState<ImuData | null>(null)
  const [yawZero, setYawZero] = useState(0)

  useEffect(() => {
    if (!connected || !key) return
    latest.current = null
    const release = requestImu(key)
    const off = sessionEvents.samples.on(({ samples }) => {
      const s = samples.find((x) => targetKey(x.target) === key)
      if (s?.imu) latest.current = s.imu
    })
    // Numbers redraw ten times a second; the 3D view reads `latest` every frame.
    const t = setInterval(() => setShown(latest.current), 100)
    return () => {
      release()
      off()
      clearInterval(t)
    }
  }, [connected, key])

  const dk = info ? deviceKey(info) : ''
  const app = useConfig((s) => s.devices[dk]?.appconf)
  const imuOff = app?.device?.['imu_conf.type'] === 0

  return (
    <>
      <BackToMore />
      <PageTitle title="IMU" subtitle="The controller’s motion sensor: which way it’s tilted, how it’s accelerating and turning. Calibrate it after mounting the controller." />
      <div className="mb-3">
        <TargetPicker devices={motors} value={key} onChange={setPick} label="IMU of" />
      </div>
      {!connected && <Banner tone="info">Connect to a controller to see its IMU.</Banner>}
      {connected && imuOff && <Banner tone="warn">The IMU is turned off in this controller’s app settings (IMU type), so it reports nothing.</Banner>}

      {connected && info && (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <section className="card overflow-hidden" aria-label="Orientation">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Compass className="size-5 text-accent" />
              <h2 className="font-semibold">Orientation</h2>
              <Button
                variant="ghost"
                className="ml-auto h-8 px-2 text-xs"
                disabled={!shown}
                onClick={() => setYawZero(shown ? shown.yaw * DEG : 0)}
                title="Turn the picture so the vehicle points the same way as now. Only the view changes."
              >
                <RotateCcw className="size-3.5" /> Face forward
              </Button>
            </div>
            <Board3d source={latest} yawZero={yawZero} />
            <div className="grid grid-cols-3 border-t border-line">
              <Angle label="Roll" deg={shown ? shown.roll * DEG : null} />
              <Angle label="Pitch" deg={shown ? shown.pitch * DEG : null} />
              <Angle label="Yaw" deg={shown ? shown.yaw * DEG : null} />
            </div>
          </section>

          <div className="space-y-4">
            <section className="card p-4" aria-label="Motion">
              <h2 className="label mb-3">Acceleration and rotation</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-faint">
                    <th className="pb-1.5 font-normal" scope="col">
                      <span className="sr-only">Quantity</span>
                    </th>
                    <th className="pb-1.5 text-right font-normal" scope="col">
                      X
                    </th>
                    <th className="pb-1.5 text-right font-normal" scope="col">
                      Y
                    </th>
                    <th className="pb-1.5 text-right font-normal" scope="col">
                      Z
                    </th>
                  </tr>
                </thead>
                <tbody className="num">
                  <tr className="border-t border-line">
                    <th scope="row" className="py-2 text-left font-normal text-muted">
                      Acceleration (g)
                    </th>
                    <td className="text-right">{shown ? fmt(shown.accX, 2) : '–'}</td>
                    <td className="text-right">{shown ? fmt(shown.accY, 2) : '–'}</td>
                    <td className="text-right">{shown ? fmt(shown.accZ, 2) : '–'}</td>
                  </tr>
                  <tr className="border-t border-line">
                    <th scope="row" className="py-2 text-left font-normal text-muted">
                      Rotation (°/s)
                    </th>
                    <td className="text-right">{shown ? fmt(shown.gyroX, 1) : '–'}</td>
                    <td className="text-right">{shown ? fmt(shown.gyroY, 1) : '–'}</td>
                    <td className="text-right">{shown ? fmt(shown.gyroZ, 1) : '–'}</td>
                  </tr>
                </tbody>
              </table>
              {!shown && !imuOff && <p className="mt-3 text-xs text-faint">Waiting for IMU data…</p>}
            </section>
            <Calibration key={dk} dk={dk} isDemo={isDemo} />
          </div>
        </div>
      )}
    </>
  )
}

function Angle({ label, deg }: { label: string; deg: number | null }) {
  return (
    <div className="border-r border-line px-4 py-3 last:border-r-0">
      <div className="label text-[9.5px]">{label}</div>
      <div className="num mt-0.5 text-xl font-semibold">{deg === null ? '–' : `${fmt(deg, 1)}°`}</div>
    </div>
  )
}

/** A board drawn with CSS 3D, turned every animation frame to follow the IMU. */
function Board3d({ source, yawZero }: { source: React.RefObject<ImuData | null>; yawZero: number }) {
  const board = useRef<HTMLDivElement>(null)
  const zero = useRef(yawZero)
  useEffect(() => {
    zero.current = yawZero
  }, [yawZero])

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const cur = { roll: 0, pitch: 0, yaw: 0 }
    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const d = source.current
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (!d || !board.current) return
      const k = reduce ? 1 : 1 - Math.exp(-dt / 0.06)
      const target = { roll: d.roll * DEG, pitch: d.pitch * DEG, yaw: d.yaw * DEG - zero.current }
      for (const a of ['roll', 'pitch', 'yaw'] as const) {
        const diff = ((((target[a] - cur[a]) % 360) + 540) % 360) - 180
        cur[a] += diff * k
      }
      // Nose up lifts the front (+x); roll right lowers the right side (+y on screen).
      board.current.style.transform = `rotateZ(${cur.yaw.toFixed(2)}deg) rotateY(${(-cur.pitch).toFixed(2)}deg) rotateX(${(-cur.roll).toFixed(2)}deg)`
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [source])

  const T = 10 // deck thickness, px
  const face = 'absolute inset-0 rounded-[18px] [backface-visibility:visible]'
  return (
    <div className="relative h-72 overflow-hidden [perspective:900px] sm:h-80" role="img" aria-label="3D view of the controller’s orientation. The numbers below give the same angles.">
      <div className="absolute top-1/2 left-1/2 [transform-style:preserve-3d]" style={{ transform: 'translate(-50%,-50%) rotateX(60deg) rotateZ(-32deg)' }}>
        {/* Floor */}
        <div
          className="absolute top-1/2 left-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
          style={{
            background:
              'repeating-linear-gradient(0deg, var(--color-line) 0 1px, transparent 1px 42px), repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px 42px)',
            maskImage: 'radial-gradient(circle, black 35%, transparent 70%)',
            transform: 'translateZ(-40px)',
          }}
        />
        <div ref={board} className="relative h-[84px] w-[230px] -translate-x-1/2 -translate-y-1/2 [transform-style:preserve-3d]">
          <div className={cx(face, 'bg-surface-3')} style={{ transform: 'translateZ(0px)' }} />
          {/* Sides */}
          <div className="absolute top-0 left-[18px] h-[10px] w-[194px] origin-top bg-surface-2" style={{ transform: 'rotateX(-90deg)' }} />
          <div className="absolute bottom-0 left-[18px] h-[10px] w-[194px] origin-bottom bg-surface-2" style={{ transform: 'rotateX(90deg)' }} />
          <div className="absolute top-[18px] right-0 h-[48px] w-[10px] origin-right bg-accent/60" style={{ transform: 'rotateY(-90deg)' }} />
          <div className="absolute top-[18px] left-0 h-[48px] w-[10px] origin-left bg-surface-2" style={{ transform: 'rotateY(90deg)' }} />
          {/* Top */}
          <div
            className={cx(face, 'border border-accent/50 bg-surface-2 shadow-[0_0_40px_-10px_var(--accent)]')}
            style={{ transform: `translateZ(${T}px)` }}
          >
            <div className="absolute inset-y-3 left-5 w-1/2 rounded-lg border border-line-strong/70" />
            <svg viewBox="0 0 24 24" className="absolute top-1/2 right-4 size-8 -translate-y-1/2 text-accent" aria-hidden>
              <path d="M6 4l12 8-12 8z" fill="currentColor" />
            </svg>
            <span className="label absolute bottom-1.5 left-5 text-[8px] text-faint">Front →</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const CAL_LABELS: Record<string, string> = {
  'imu_conf.rot_roll': 'Mounting roll',
  'imu_conf.rot_pitch': 'Mounting pitch',
  'imu_conf.rot_yaw': 'Mounting yaw',
  'imu_conf.accel_offsets__0': 'Accel offset X',
  'imu_conf.accel_offsets__1': 'Accel offset Y',
  'imu_conf.accel_offsets__2': 'Accel offset Z',
  'imu_conf.gyro_offsets__0': 'Gyro offset X',
  'imu_conf.gyro_offsets__1': 'Gyro offset Y',
  'imu_conf.gyro_offsets__2': 'Gyro offset Z',
}

function Calibration({ dk, isDemo }: { dk: string; isDemo: boolean }) {
  const d = useConfig((s) => s.devices[dk])
  const app = d?.appconf
  const [yawText, setYawText] = useState('0')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<ImuCalibration | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState<WriteItem[] | null>(null)
  const now = useNow(500)

  const yawP = app?.defs?.params['imu_conf.rot_yaw']
  const yaw = Number(yawText.replace(',', '.'))
  const yawError = !yawText.trim() || !Number.isFinite(yaw) ? 'Enter a number of degrees.' : yawP && (yaw < yawP.min || yaw > yawP.max) ? `Between ${yawP.min}° and ${yawP.max}°.` : null
  const block = d ? motionBlock([d.target], now, 'calibrate the IMU') : 'Waiting for the controller.'
  const configReady = app?.status === 'ready' && !!app.defs && !!app.device && IMU_CAL_PARAMS.every((n) => n in app.defs!.params)
  const configReason = app?.status === 'readonly' || app?.status === 'unsupported' ? app.reason : !configReady ? 'Waiting for the app settings to load.' : null

  const item = useMemo(() => {
    if (!result || !configReady || !d) return null
    const after = { ...app!.device! }
    IMU_CAL_PARAMS.forEach((n, i) => (after[n] = result[i]))
    return makeItem({ key: d.key, target: d.target, deviceName: d.name, kind: 'appconf', defs: app!.defs!, before: app!.device!, after })
  }, [result, configReady, d, app])

  const run = async () => {
    const client = activeClient()
    if (!client || !d || yawError || block) return
    setPhase('running')
    setError(null)
    setResult(null)
    try {
      setResult(await client.imuCalibration(yaw, d.target))
      setPhase('done')
    } catch (e) {
      setError(`Calibration failed: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('idle')
    }
  }

  return (
    <section className="card p-4" aria-label="Calibration">
      <div className="mb-2 flex items-center gap-2">
        <Crosshair className="size-5 text-accent" />
        <h2 className="font-semibold">Calibrate</h2>
      </div>
      <p className="text-sm text-muted">
        Put the vehicle on level ground and keep it still. The controller measures for a few seconds and works out how it’s mounted. Nothing is written until
        you review it.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-muted">Mounting yaw (°)</span>
          <input
            inputMode="decimal"
            value={yawText}
            onChange={(e) => setYawText(e.target.value)}
            aria-invalid={!!yawError}
            aria-describedby="yaw-help"
            className={cx('focus-ring num mt-1 block h-10 w-28 rounded-lg border bg-surface-2 px-3 text-sm', yawError ? 'border-danger/60' : 'border-line-strong')}
          />
        </label>
        <Button variant="primary" className="h-10" disabled={!!yawError || !!block || phase === 'running' || !!configReason} onClick={() => void run()}>
          {phase === 'done' ? 'Measure again' : 'Start'}
        </Button>
      </div>
      <p id="yaw-help" className={cx('mt-1.5 text-xs', yawError ? 'text-danger' : 'text-faint')}>
        {yawError ?? 'Gravity can’t show which way the controller faces. If it’s turned on the frame, enter by how much; usually 0.'}
      </p>
      {block && phase !== 'running' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-warn">
          <span className="min-w-0 flex-1">{block}</span>
          {isDemo && <DemoPark />}
        </div>
      )}
      {configReason && !block && <p className="mt-3 text-sm text-muted">{configReason}</p>}
      {phase === 'running' && (
        <div className="mt-3">
          <Progress what="Measuring. Keep it still…" progress={null} />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {result && item && (
        <div className="mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="pb-1 font-normal">Setting</th>
                <th className="pb-1 text-right font-normal">Now</th>
                <th className="pb-1 text-right font-normal">Measured</th>
              </tr>
            </thead>
            <tbody className="num">
              {IMU_CAL_PARAMS.map((n, i) => (
                <tr key={n} className="border-t border-line">
                  <th scope="row" className="py-1.5 text-left font-sans font-normal text-muted">
                    {CAL_LABELS[n]}
                  </th>
                  <td className="text-right text-muted">{fmt(Number(app!.device![n]), 3)}</td>
                  <td className="text-right">{fmt(result[i], 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" disabled={!item.changes.length} onClick={() => setWriting([item])}>
              {item.changes.length ? 'Review and write' : 'Already set'}
            </Button>
          </div>
        </div>
      )}
      <WriteDialog
        open={!!writing}
        onClose={() => setWriting(null)}
        fixedItems={writing ?? undefined}
        onFinished={(_, outcomes) => {
          if (outcomes.every((o) => o.status === 'ok' || o.status === 'adjusted')) setPhase('idle')
        }}
      />
      {d && <span className="sr-only">Calibrating {targetLabel(d.target)}</span>}
    </section>
  )
}
