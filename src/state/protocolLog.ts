// Developer option: a log of every packet between the app and the controllers.
// Off by default; when off, the client doesn't call into it at all. Kept in
// memory only (the last few thousand packets), outside React state, with a
// counter the viewer redraws from a few times a second.

import { create } from 'zustand'
import { setProtocolTap } from '../client/VescClient'
import { COMM, commandName } from '../protocol/commands'
import { useSettings } from './settings'

export const PROTOCOL_LOG_LIMIT = 5000
/** Bytes kept per packet; long ones (config, firmware) are cut. */
const KEEP_BYTES = 96

export interface ProtocolEntry {
  seq: number
  at: number
  dir: 'tx' | 'rx' | 'timeout'
  /** 'local', or the CAN id a packet was forwarded to. */
  target: number | 'local'
  command: number
  name: string
  length: number
  bytes: Uint8Array
}

const ring: (ProtocolEntry | undefined)[] = new Array(PROTOCOL_LOG_LIMIT)
let head = 0
let total = 0
let seq = 0

export function protocolEntries(limit = PROTOCOL_LOG_LIMIT): ProtocolEntry[] {
  const n = Math.min(limit, total, PROTOCOL_LOG_LIMIT)
  const out: ProtocolEntry[] = []
  for (let i = 1; i <= n; i++) out.push(ring[(head - i + PROTOCOL_LOG_LIMIT) % PROTOCOL_LOG_LIMIT]!)
  return out
}

interface ProtocolLogState {
  version: number
  count: number
  clear: () => void
}

export const useProtocolLog = create<ProtocolLogState>()((set) => ({
  version: 0,
  count: 0,
  clear: () => {
    ring.fill(undefined)
    head = 0
    total = 0
    set((s) => ({ version: s.version + 1, count: 0 }))
  },
}))

function record(dir: ProtocolEntry['dir'], payload: Uint8Array) {
  // Forwarded requests read [FORWARD_CAN][id][command...].
  const fwd = payload[0] === COMM.FORWARD_CAN && payload.length >= 3 && dir !== 'rx'
  const command = fwd ? payload[2] : payload[0]
  ring[head] = {
    seq: ++seq,
    at: Date.now(),
    dir,
    target: fwd ? payload[1] : 'local',
    command,
    name: commandName(command),
    length: payload.length,
    bytes: payload.slice(0, KEEP_BYTES),
  }
  head = (head + 1) % PROTOCOL_LOG_LIMIT
  total++
  dirty = true
}

let dirty = false
let tick: ReturnType<typeof setInterval> | null = null

function enable(on: boolean) {
  if (on && !tick) {
    setProtocolTap(record)
    tick = setInterval(() => {
      if (!dirty) return
      dirty = false
      useProtocolLog.setState((s) => ({ version: s.version + 1, count: Math.min(total, PROTOCOL_LOG_LIMIT) }))
    }, 250)
  } else if (!on && tick) {
    setProtocolTap(null)
    clearInterval(tick)
    tick = null
  }
}

enable(useSettings.getState().protocolLog)
useSettings.subscribe((s, prev) => {
  if (s.protocolLog !== prev.protocolLog) enable(s.protocolLog)
})

/** The log as text, oldest first, for a bug report. */
export function protocolLogText(): string {
  const rows = protocolEntries().reverse()
  const t0 = rows[0]?.at ?? 0
  return rows
    .map((e) => {
      const hex = Array.from(e.bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
      const more = e.length > e.bytes.length ? ` … (${e.length} bytes)` : ''
      const target = e.target === 'local' ? '' : ` → CAN ${e.target}`
      return `${((e.at - t0) / 1000).toFixed(3).padStart(9)}  ${e.dir.padEnd(7)} ${e.name}${target}  [${hex}${more}]`
    })
    .join('\n')
}
