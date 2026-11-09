// COMM_BMS_GET_VALUES (bldc bms.c, VESC Tool commands.cpp). A motor controller
// answers it with what its VESC BMS last sent over CAN; a BMS answers for itself.
// Newer fields are only present on newer firmware, so the tail is read while bytes remain.

import { BufferReader, BufferWriter } from './buffer'

export interface BmsValues {
  /** Pack voltage (V). */
  vTotal: number
  /** Voltage on the charge input (V). */
  vCharge: number
  /** Pack current (A), positive when discharging. */
  current: number
  /** Current as the BMS chip measured it (A). */
  currentIc: number
  ahCount: number
  whCount: number
  cells: number[]
  balancing: boolean[]
  /** Cell and board temperature sensors (°C). */
  temps: number[]
  tempIc: number
  tempHumSensor: number
  /** Relative humidity (%). */
  humidity: number
  tempCellsHighest: number
  /** 0..1, when reported. */
  soc: number | null
  soh: number | null
  canId: number | null
  ahChargeTotal: number | null
  whChargeTotal: number | null
  ahDischargeTotal: number | null
  whDischargeTotal: number | null
  pressure: number | null
  dataVersion: number | null
  status: string | null
}

export function decodeBmsValues(r: BufferReader): BmsValues {
  const v: BmsValues = {
    vTotal: r.f32(1e6),
    vCharge: r.f32(1e6),
    current: r.f32(1e6),
    currentIc: r.f32(1e6),
    ahCount: r.f32(1e3),
    whCount: r.f32(1e3),
    cells: [],
    balancing: [],
    temps: [],
    tempIc: 0,
    tempHumSensor: 0,
    humidity: 0,
    tempCellsHighest: 0,
    soc: null,
    soh: null,
    canId: null,
    ahChargeTotal: null,
    whChargeTotal: null,
    ahDischargeTotal: null,
    whDischargeTotal: null,
    pressure: null,
    dataVersion: null,
    status: null,
  }
  const cells = r.u8()
  for (let i = 0; i < cells; i++) v.cells.push(r.f16(1e3))
  for (let i = 0; i < cells; i++) v.balancing.push(r.u8() !== 0)
  const sensors = r.u8()
  for (let i = 0; i < sensors; i++) v.temps.push(r.f16(1e2))
  v.tempIc = r.f16(1e2)
  v.tempHumSensor = r.f16(1e2)
  v.humidity = r.f16(1e2)
  v.tempCellsHighest = r.f16(1e2)
  if (r.has(2)) v.soc = r.f16(1e3)
  if (r.has(2)) v.soh = r.f16(1e3)
  if (r.has(1)) v.canId = r.u8()
  if (r.has(16)) {
    v.ahChargeTotal = r.f32auto()
    v.whChargeTotal = r.f32auto()
    v.ahDischargeTotal = r.f32auto()
    v.whDischargeTotal = r.f32auto()
  }
  // Stored ×0.1, so one unit is 10 Pa.
  if (r.has(2)) v.pressure = r.f16(1e-1)
  if (r.has(1)) v.dataVersion = r.u8()
  if (r.has(1)) {
    try {
      v.status = r.cstring()
    } catch {
      v.status = null
    }
  }
  return v
}

/** The reply body (after the command id), as the firmware builds it. Used by the simulator and tests. */
export function encodeBmsValues(v: BmsValues): Uint8Array {
  const w = new BufferWriter()
    .f32(v.vTotal, 1e6)
    .f32(v.vCharge, 1e6)
    .f32(v.current, 1e6)
    .f32(v.currentIc, 1e6)
    .f32(v.ahCount, 1e3)
    .f32(v.whCount, 1e3)
    .u8(v.cells.length)
  for (const c of v.cells) w.f16(c, 1e3)
  for (const b of v.balancing) w.u8(b ? 1 : 0)
  w.u8(v.temps.length)
  for (const t of v.temps) w.f16(t, 1e2)
  w.f16(v.tempIc, 1e2).f16(v.tempHumSensor, 1e2).f16(v.humidity, 1e2).f16(v.tempCellsHighest, 1e2)
  w.f16(v.soc ?? 0, 1e3).f16(v.soh ?? 0, 1e3).u8(v.canId ?? 255)
  w.f32auto(v.ahChargeTotal ?? 0).f32auto(v.whChargeTotal ?? 0).f32auto(v.ahDischargeTotal ?? 0).f32auto(v.whDischargeTotal ?? 0)
  w.f16(v.pressure ?? 0, 1e-1).u8(v.dataVersion ?? 1).cstring(v.status ?? '')
  return w.toUint8Array()
}

/** A controller with no BMS on its CAN bus replies with an empty record. */
export function hasBms(v: BmsValues): boolean {
  return v.cells.length > 0 || v.vTotal > 0.5
}

interface CellSummary {
  min: number
  max: number
  spread: number
  avg: number
  minIndex: number
  maxIndex: number
  balancing: number
}

export function cellSummary(v: BmsValues): CellSummary | null {
  if (!v.cells.length) return null
  let min = Infinity
  let max = -Infinity
  let minIndex = 0
  let maxIndex = 0
  v.cells.forEach((c, i) => {
    if (c < min) {
      min = c
      minIndex = i
    }
    if (c > max) {
      max = c
      maxIndex = i
    }
  })
  const avg = v.cells.reduce((a, b) => a + b, 0) / v.cells.length
  return { min, max, spread: max - min, avg, minIndex, maxIndex, balancing: v.balancing.filter(Boolean).length }
}
