// ABS test with the wheel lifted, for when you can't ride: spin the wheel up,
// brake it hard, and see whether ABS eased the braking. A lifted wheel has
// little to slow down, so hard braking stops it far faster than a tyre on the
// road could, which is exactly what ABS watches for.
//
// It's a hold-to-run test, like the motor test: letting go, the app losing
// focus or being hidden, Escape, a dropped link, or the time limit all stop the
// motor, and the commands repeat with a keep-alive so the controller's own
// timeout stops it if the app freezes.

import { create } from 'zustand'
import { erpmForSpeed } from '../lib/rideModes'
import { useConfig, type DeviceConfig } from './config'
import { targetKey } from './devices'
import { motionBlock } from './motion'
import { useMotorTest } from './motorTest'
import { readAbs, useAbs } from './onboard'
import { activeClient, useSession } from './session'
import { useTelemetry } from './telemetry'

const REPEAT_MS = 100
const SPIN_UP_MS = 5000
const BRAKE_MS = 3000
/** The wheel counts as stopped below this. */
const STOPPED_ERPM = 150
/** Test speed: comfortably above the 7 km/h below which ABS never acts. */
const TEST_KMH = 20
const MAX_TEST_ERPM = 10_000

export type AbsTestPhase = 'idle' | 'checking' | 'spinning' | 'braking' | 'reading' | 'done'

interface AbsTestState {
  phase: AbsTestPhase
  key: string | null
  /** The spin-up target. */
  erpm: number
  /** Brake releases ABS made during the test, once known. */
  releases: number | null
  error: string | null
  /** Set when the test was stopped before it finished. */
  stopped: boolean
}

export const useAbsTest = create<AbsTestState>()(() => ({ phase: 'idle', key: null, erpm: 0, releases: null, error: null, stopped: false }))

/** ERPM to spin a lifted wheel to for the test, or null without a wheel setup. */
export function absTestErpm(d: DeviceConfig): number | null {
  const mc = d.mcconf.device
  if (!mc) return null
  const e = erpmForSpeed(TEST_KMH, mc)
  return Number.isFinite(e) && e > 0 ? Math.round(Math.min(MAX_TEST_ERPM, e)) : null
}

/** Why the test can't run on this controller right now, or null. */
export function absTestBlock(d: DeviceConfig): string | null {
  if (useSession.getState().status !== 'connected' || !activeClient()) return 'Connect to the controller first.'
  if (!useAbs.getState().status[d.key]?.on) return 'Turn ABS on first.'
  if (useAbs.getState().busy) return 'Wait for ABS to finish setting up.'
  if (useMotorTest.getState().running) return 'A motor test is running.'
  if (!absTestErpm(d)) return `${d.name} has no wheel size or motor poles set.`
  if (!(Math.abs(Number(d.mcconf.device?.l_current_min)) > 0)) return `${d.name} has no motor braking current set.`
  return motionBlock([d.target], Date.now(), 'test ABS')
}

let run = 0
let cleanup: (() => void) | null = null
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function liveErpm(d: DeviceConfig): number {
  return Math.abs(useTelemetry.getState().devices[targetKey(d.target)]?.rpm ?? 0)
}

function release(d: DeviceConfig) {
  const client = activeClient()
  if (!client) return
  // Twice, in case one is lost on a busy link.
  void client.setCurrent(0, d.target).catch(() => {})
  setTimeout(() => void client.setCurrent(0, d.target).catch(() => {}), 60)
}

/** Starts the test on one controller. Runs while held; call stopAbsTest() on release. */
export async function startAbsTest(key: string): Promise<void> {
  const s = useAbsTest.getState()
  if (s.phase !== 'idle' && s.phase !== 'done') return
  const d = useConfig.getState().devices[key]
  if (!d) return
  const block = absTestBlock(d)
  if (block) {
    useAbsTest.setState({ phase: 'done', key, releases: null, error: block, stopped: false })
    return
  }
  const client = activeClient()!
  const erpm = absTestErpm(d)!
  const brakeAmps = Math.abs(Number(d.mcconf.device!.l_current_min))
  const me = ++run
  const alive = () => me === run
  useAbsTest.setState({ phase: 'checking', key, erpm, releases: null, error: null, stopped: false })

  // Dead-man: anything that takes the rider's attention away stops the motor.
  const stop = () => stopAbsTest()
  const onHidden = () => document.visibilityState !== 'visible' && stop()
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stop()
  window.addEventListener('blur', stop)
  window.addEventListener('pagehide', stop)
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('keydown', onKey)
  const unsubscribe = useSession.subscribe((st) => st.status !== 'connected' && stop())
  cleanup = () => {
    window.removeEventListener('blur', stop)
    window.removeEventListener('pagehide', stop)
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('keydown', onKey)
    unsubscribe()
  }
  const finish = (patch: Partial<AbsTestState>) => {
    if (!alive()) return
    cleanup?.()
    cleanup = null
    run++
    useAbsTest.setState({ phase: 'done', ...patch })
  }

  try {
    const before = await readAbs(d)
    if (!alive()) return
    if (!before?.on) return finish({ error: 'ABS isn’t running on this controller. Turn it off and on again.' })

    // 1. Spin the lifted wheel up to test speed.
    useAbsTest.setState({ phase: 'spinning' })
    const spinStart = Date.now()
    while (alive() && liveErpm(d) < erpm * 0.85) {
      if (Date.now() - spinStart > SPIN_UP_MS) {
        release(d)
        return finish({ error: 'The wheel didn’t reach test speed. Check it’s off the ground and turns freely.' })
      }
      void client.setRpm(erpm, d.target).catch(() => {})
      void client.sendAlive(d.target)
      await sleep(REPEAT_MS)
    }
    if (!alive()) return

    // 2. Brake hard, as a panic stop would.
    useAbsTest.setState({ phase: 'braking' })
    const brakeStart = Date.now()
    while (alive() && liveErpm(d) > STOPPED_ERPM && Date.now() - brakeStart < BRAKE_MS) {
      void client.setCurrentBrake(brakeAmps, d.target).catch(() => {})
      void client.sendAlive(d.target)
      await sleep(REPEAT_MS)
    }
    if (!alive()) return
    release(d)
    if (liveErpm(d) > erpm * 0.5) return finish({ error: 'The wheel didn’t slow down when braked. Check the motor braking current in the motor settings.' })

    // 3. Did ABS step in?
    useAbsTest.setState({ phase: 'reading' })
    const after = await readAbs(d)
    if (!alive()) return
    if (!after?.on) return finish({ error: 'ABS stopped running during the test. Turn it off and on again.' })
    // The count restarts if ABS was re-armed in between.
    const releases = after.interventions >= before.interventions ? after.interventions - before.interventions : after.interventions
    finish({ releases })
  } catch (e) {
    release(d)
    finish({ error: `The test stopped: ${msg(e)}` })
  }
}

/** Stops the motor. A test that hadn't finished braking is marked as stopped. */
export function stopAbsTest() {
  const s = useAbsTest.getState()
  if (s.phase !== 'checking' && s.phase !== 'spinning' && s.phase !== 'braking') return
  run++
  cleanup?.()
  cleanup = null
  const d = s.key ? useConfig.getState().devices[s.key] : null
  if (d) release(d)
  useAbsTest.setState({ phase: 'done', releases: null, error: null, stopped: true })
}

export function resetAbsTest() {
  stopAbsTest()
  useAbsTest.setState({ phase: 'idle', key: null, releases: null, error: null, stopped: false })
}
