// Settings are never written while a motor turns: a write briefly stops the
// motor controller (flash write) and can change limits mid-ride.

import { useEffect, useState } from 'react'
import type { Target } from '../client/VescClient'
import { targetFromKey, targetKey, targetLabel } from './devices'
import { useSession } from './session'
import { useTelemetry } from './telemetry'

/** Electrical RPM below which a motor counts as stopped (a wheel at walking pace is several hundred). */
export const STOPPED_ERPM = 200
/** Live data older than this is treated as unknown. */
const STALE_MS = 3000

/** Why writing to these controllers isn't allowed right now, or null when it is. */
export function motionBlock(targets: Target[], now = Date.now(), action = 'write settings'): string | null {
  const busy = useSession.getState().busy
  if (busy) return `Wait until ${busy} is done.`
  const t = useTelemetry.getState()
  if (now - t.lastUpdate > STALE_MS) return 'Waiting for live data to confirm the motor is stopped.'
  for (const target of targets) {
    const v = t.devices[targetKey(target)]
    if (!v) return `No live data from ${targetLabel(target)} yet, so it can’t be confirmed stopped.`
    const erpm = Math.abs(v.rpm)
    if (erpm > STOPPED_ERPM) {
      return `The motor on ${targetLabel(target)} is turning (${Math.round(erpm).toLocaleString()} ERPM). Stop the wheel to ${action}.`
    }
  }
  return null
}

/** Re-checks whenever live data arrives, plus once a second so stale data is noticed. */
export function useMotionBlock(targets: Target[], action?: string): string | null {
  const key = targets.map(targetKey).join(',')
  const [block, setBlock] = useState<string | null>(() => motionBlock(targets, undefined, action))
  useEffect(() => {
    const list = key ? key.split(',').map(targetFromKey) : []
    const check = () => setBlock(motionBlock(list, undefined, action))
    check()
    const off = useTelemetry.subscribe(check)
    const timer = setInterval(check, 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [key, action])
  return block
}
