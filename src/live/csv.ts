// CSV export of recorded live data. One row per poll, one column per
// controller and signal, in the units the user sees.

import type { Units } from '../lib/vehicle'
import type { DeviceLog } from './recorder'
import { SIGNALS, toDisplay, unitLabel } from './signals'

export interface CsvColumn {
  target: string
  /** "Local", "CAN 2" */
  deviceLabel: string
  signal: number
}

export function buildCsv(logs: Map<string, DeviceLog>, columns: CsvColumn[], from: number, to: number, units: Units): string {
  const header = ['time', 'seconds', ...columns.map((c) => {
    const s = SIGNALS[c.signal]
    const u = unitLabel(s.unit, units)
    return csvCell(`${c.deviceLabel} ${s.label}${u ? ` (${u})` : ''}`)
  })]

  // Rows keyed by timestamp: every controller polled in a cycle shares that cycle's time.
  const rows = new Map<number, (string | undefined)[]>()
  columns.forEach((c, n) => {
    const log = logs.get(c.target)
    if (!log) return
    const s = SIGNALS[c.signal]
    for (let i = log.firstAtOrAfter(from); i < log.size; i++) {
      const j = log.index(i)
      const at = log.t[j]
      if (at > to) break
      let row = rows.get(at)
      if (!row) {
        row = new Array(columns.length)
        rows.set(at, row)
      }
      const v = log.cols[c.signal][j]
      row[n] = Number.isFinite(v) ? trim(toDisplay(s.unit, units, v), s.digits + 2) : ''
    }
  })

  const times = [...rows.keys()].sort((a, b) => a - b)
  const start = times[0] ?? from
  const lines = [header.join(',')]
  for (const at of times) {
    const row = rows.get(at)!
    lines.push([new Date(at).toISOString(), ((at - start) / 1000).toFixed(3), ...columns.map((_, n) => row[n] ?? '')].join(','))
  }
  return lines.join('\n') + '\n'
}

function trim(v: number, digits: number) {
  return v.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
