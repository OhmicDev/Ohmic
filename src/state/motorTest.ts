// Spinning a motor from the app, with a dead-man control: it runs only while the
// rider holds the button. Releasing it, the tab losing focus or being hidden,
// Escape, a dropped link, or 15 seconds, all stop the motor. The command is
// repeated every 100 ms (plus a keep-alive), so if the app freezes or the link
// dies the controller's own timeout stops the motor within about a second.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { targetKey } from './devices'
import { motionBlock } from './motion'
import { activeClient, useSession } from './session'

const REPEAT_MS = 100
const MAX_RUN_MS = 15_000

interface MotorTestState {
  /** Target key of the motor running, or null. */
  running: string | null
  error: string | null
}

export const useMotorTest = create<MotorTestState>()(() => ({ running: null, error: null }))

let timer: ReturnType<typeof setInterval> | null = null
let deadline: ReturnType<typeof setTimeout> | null = null
let target: Target | null = null
let unsubscribe: (() => void) | null = null

const onHidden = () => {
  if (document.visibilityState !== 'visible') stopMotorTest()
}
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') stopMotorTest()
}

/** Starts spinning one motor at this ERPM. Returns why it can't, or null. */
export function startMotorTest(t: Target, erpm: number): string | null {
  stopMotorTest()
  const client = activeClient()
  if (!client) return fail('Not connected.')
  const block = motionBlock([t], Date.now(), 'run a motor test')
  if (block) return fail(block)
  if (!Number.isFinite(erpm) || Math.abs(erpm) > 10_000) return fail('That test speed is out of range.')
  target = t
  const tick = () => {
    void client.setRpm(erpm, t).catch(() => stopMotorTest())
    void client.sendAlive(t)
  }
  tick()
  timer = setInterval(tick, REPEAT_MS)
  deadline = setTimeout(stopMotorTest, MAX_RUN_MS)
  window.addEventListener('blur', stopMotorTest)
  window.addEventListener('pagehide', stopMotorTest)
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('keydown', onKey)
  unsubscribe = useSession.subscribe((s) => {
    if (s.status !== 'connected') stopMotorTest()
  })
  useMotorTest.setState({ running: targetKey(t), error: null })
  return null
}

/** Stops the motor (lets it coast). Safe to call any time. */
export function stopMotorTest() {
  if (timer) clearInterval(timer)
  if (deadline) clearTimeout(deadline)
  timer = null
  deadline = null
  window.removeEventListener('blur', stopMotorTest)
  window.removeEventListener('pagehide', stopMotorTest)
  document.removeEventListener('visibilitychange', onHidden)
  window.removeEventListener('keydown', onKey)
  unsubscribe?.()
  unsubscribe = null
  const t = target
  target = null
  const client = activeClient()
  if (t !== null && client) {
    // Twice, in case one is lost on a busy link.
    void client.setCurrent(0, t).catch(() => {})
    setTimeout(() => void client.setCurrent(0, t).catch(() => {}), 60)
  }
  if (useMotorTest.getState().running) useMotorTest.setState({ running: null })
}

function fail(error: string) {
  useMotorTest.setState({ error })
  return error
}
