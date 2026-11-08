// Turns the plotted list into chart panes: one per display unit, so two
// different measures never share an axis.

import type { Units } from '../lib/vehicle'
import { parsePlotKey, type Plotted } from '../state/live'
import { signalDef, unitLabel, type SignalDef } from './signals'

export interface ChartSeries {
  key: string
  slot: number
  target: string
  def: SignalDef
  /** "Local", "CAN 2"; shown only when several controllers are plotted. */
  deviceLabel: string
}

export interface ChartPaneSpec {
  unit: string
  series: ChartSeries[]
}

export const MAX_PLOTTED_HINT = 'The chart is full (8 signals). Remove one to add another.'

export function plotPanes(plotted: Plotted[], units: Units, labelOf: (target: string) => string): ChartPaneSpec[] {
  const panes = new Map<string, ChartPaneSpec>()
  for (const p of [...plotted].sort((a, b) => a.slot - b.slot)) {
    const { target, signal } = parsePlotKey(p.key)
    const def = signalDef(signal)
    if (!def) continue
    const unit = unitLabel(def.unit, units) || 'count'
    let pane = panes.get(unit)
    if (!pane) {
      pane = { unit, series: [] }
      panes.set(unit, pane)
    }
    pane.series.push({ key: p.key, slot: p.slot, target, def, deviceLabel: labelOf(target) })
  }
  return [...panes.values()]
}
