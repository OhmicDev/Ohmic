import { useEffect, useState } from 'react'
import { useLiveData } from '../../state/live'

/** Re-renders on new live data, at most every `ms` (lists don't need 50 updates a second). */
export function useLiveTick(ms = 150): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending = false
    const fire = () => {
      setTick((n) => n + 1)
      timer = setTimeout(() => {
        timer = null
        if (pending) {
          pending = false
          fire()
        }
      }, ms)
    }
    const off = useLiveData.subscribe(() => {
      if (timer) pending = true
      else fire()
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [ms])
  return tick
}
