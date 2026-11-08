// What the route on a ride's map can be coloured by.

import { convertSpeed, convertTemp, unitLabels, type Units } from '../lib/vehicle'
import type { ColumnId } from './columns'

export type MapMetric = 'speed' | 'power' | 'current' | 'temp'

export interface MetricDef {
  label: string
  col: ColumnId
  unit: (u: Units) => string
  conv: (v: number, u: Units) => number
  digits: number
}

export const MAP_METRICS: Record<MapMetric, MetricDef> = {
  speed: { label: 'Speed', col: 'speed', unit: (u) => unitLabels(u).speed, conv: convertSpeed, digits: 0 },
  power: { label: 'Power', col: 'power', unit: () => 'kW', conv: (v) => v / 1000, digits: 1 },
  current: { label: 'Current', col: 'currentIn', unit: () => 'A', conv: (v) => v, digits: 0 },
  temp: { label: 'Motor temp', col: 'tempMotor', unit: (u) => unitLabels(u).temp, conv: convertTemp, digits: 0 },
}
