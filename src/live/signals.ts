// Every live signal the app records, grouped the way riders think about them.
// Values are stored in metric base units; display units follow the user's choice.

import type { ImuData } from '../protocol/imu'
import type { Values } from '../protocol/messages'
import { fmt } from '../lib/format'
import { convertSpeed, convertTemp, motorRpm, speedKmh, unitLabels, type Units, type VehicleSetup } from '../lib/vehicle'

type SignalGroup = 'Currents' | 'Power' | 'Duty & speed' | 'Voltages' | 'Thermals' | 'Position' | 'Energy' | 'IMU'

export const SIGNAL_GROUPS: SignalGroup[] = ['Currents', 'Power', 'Duty & speed', 'Voltages', 'Thermals', 'Position', 'Energy', 'IMU']

/** Base unit; 'temp' and 'speed' switch with metric/imperial. */
type SignalUnit = 'A' | 'W' | '%' | 'ERPM' | 'rpm' | 'speed' | 'counts' | 'V' | 'temp' | '°' | 'Ah' | 'Wh' | 'g' | '°/s'

export interface SignalInput {
  values: Values
  imu: ImuData | null
  vehicle: VehicleSetup
}

export interface SignalDef {
  id: string
  label: string
  group: SignalGroup
  unit: SignalUnit
  digits: number
  hint?: string
  /** NaN when the source wasn't read this time (IMU). */
  get: (s: SignalInput) => number
}

const RAD = 180 / Math.PI
const v = (f: (v: Values) => number) => (s: SignalInput) => f(s.values)
const imu = (f: (d: ImuData) => number) => (s: SignalInput) => (s.imu ? f(s.imu) : NaN)

export const SIGNALS: SignalDef[] = [
  { id: 'currentMotor', label: 'Motor current', group: 'Currents', unit: 'A', digits: 1, get: v((x) => x.currentMotor), hint: 'Current through the motor windings. Makes torque.' },
  { id: 'currentIn', label: 'Battery current', group: 'Currents', unit: 'A', digits: 1, get: v((x) => x.currentIn), hint: 'Current drawn from the battery. Negative while braking with regen.' },
  { id: 'id', label: 'Id (field current)', group: 'Currents', unit: 'A', digits: 2, get: v((x) => x.id), hint: 'Negative at high speed when field weakening is on.' },
  { id: 'iq', label: 'Iq (torque current)', group: 'Currents', unit: 'A', digits: 2, get: v((x) => x.iq) },
  { id: 'power', label: 'Battery power', group: 'Power', unit: 'W', digits: 0, get: v((x) => x.vIn * x.currentIn) },
  { id: 'duty', label: 'Duty cycle', group: 'Duty & speed', unit: '%', digits: 1, get: v((x) => x.dutyNow * 100), hint: 'How much of the battery voltage is used. Near the max, the motor can’t go faster.' },
  { id: 'erpm', label: 'Electrical RPM', group: 'Duty & speed', unit: 'ERPM', digits: 0, get: v((x) => x.rpm) },
  { id: 'motorRpm', label: 'Motor RPM', group: 'Duty & speed', unit: 'rpm', digits: 0, get: (s) => motorRpm(s.values.rpm, s.vehicle), hint: 'From ERPM and the motor pole count.' },
  { id: 'speed', label: 'Speed', group: 'Duty & speed', unit: 'speed', digits: 1, get: (s) => speedKmh(s.values.rpm, s.vehicle), hint: 'From ERPM, poles, gearing and wheel size.' },
  { id: 'tachometer', label: 'Tachometer', group: 'Duty & speed', unit: 'counts', digits: 0, get: v((x) => x.tachometer) },
  { id: 'tachometerAbs', label: 'Tachometer (abs)', group: 'Duty & speed', unit: 'counts', digits: 0, get: v((x) => x.tachometerAbs) },
  { id: 'vIn', label: 'Battery voltage', group: 'Voltages', unit: 'V', digits: 2, get: v((x) => x.vIn) },
  { id: 'vd', label: 'Vd', group: 'Voltages', unit: 'V', digits: 2, get: v((x) => x.vd) },
  { id: 'vq', label: 'Vq', group: 'Voltages', unit: 'V', digits: 2, get: v((x) => x.vq) },
  { id: 'tempFet', label: 'Controller', group: 'Thermals', unit: 'temp', digits: 1, get: v((x) => x.tempFet) },
  { id: 'tempMos1', label: 'MOSFET 1', group: 'Thermals', unit: 'temp', digits: 1, get: v((x) => x.tempMos1) },
  { id: 'tempMos2', label: 'MOSFET 2', group: 'Thermals', unit: 'temp', digits: 1, get: v((x) => x.tempMos2) },
  { id: 'tempMos3', label: 'MOSFET 3', group: 'Thermals', unit: 'temp', digits: 1, get: v((x) => x.tempMos3) },
  { id: 'tempMotor', label: 'Motor', group: 'Thermals', unit: 'temp', digits: 1, get: v((x) => x.tempMotor) },
  { id: 'pidPos', label: 'Rotor position', group: 'Position', unit: '°', digits: 1, get: v((x) => x.pidPos) },
  { id: 'ampHours', label: 'Amp hours used', group: 'Energy', unit: 'Ah', digits: 3, get: v((x) => x.ampHours) },
  { id: 'ampHoursCharged', label: 'Amp hours charged', group: 'Energy', unit: 'Ah', digits: 3, get: v((x) => x.ampHoursCharged) },
  { id: 'wattHours', label: 'Watt hours used', group: 'Energy', unit: 'Wh', digits: 2, get: v((x) => x.wattHours) },
  { id: 'wattHoursCharged', label: 'Watt hours charged', group: 'Energy', unit: 'Wh', digits: 2, get: v((x) => x.wattHoursCharged) },
  { id: 'roll', label: 'Roll', group: 'IMU', unit: '°', digits: 1, get: imu((d) => d.roll * RAD) },
  { id: 'pitch', label: 'Pitch', group: 'IMU', unit: '°', digits: 1, get: imu((d) => d.pitch * RAD) },
  { id: 'yaw', label: 'Yaw', group: 'IMU', unit: '°', digits: 1, get: imu((d) => d.yaw * RAD) },
  { id: 'accX', label: 'Acceleration X', group: 'IMU', unit: 'g', digits: 3, get: imu((d) => d.accX) },
  { id: 'accY', label: 'Acceleration Y', group: 'IMU', unit: 'g', digits: 3, get: imu((d) => d.accY) },
  { id: 'accZ', label: 'Acceleration Z', group: 'IMU', unit: 'g', digits: 3, get: imu((d) => d.accZ) },
  { id: 'gyroX', label: 'Rotation X', group: 'IMU', unit: '°/s', digits: 1, get: imu((d) => d.gyroX) },
  { id: 'gyroY', label: 'Rotation Y', group: 'IMU', unit: '°/s', digits: 1, get: imu((d) => d.gyroY) },
  { id: 'gyroZ', label: 'Rotation Z', group: 'IMU', unit: '°/s', digits: 1, get: imu((d) => d.gyroZ) },
]

export const SIGNAL_INDEX = new Map(SIGNALS.map((s, i) => [s.id, i]))

export function signalDef(id: string): SignalDef | undefined {
  const i = SIGNAL_INDEX.get(id)
  return i === undefined ? undefined : SIGNALS[i]
}

export function unitLabel(unit: SignalUnit, units: Units): string {
  if (unit === 'temp') return unitLabels(units).temp
  if (unit === 'speed') return unitLabels(units).speed
  if (unit === 'counts') return ''
  return unit
}

/** Converts a stored (metric) value to what the user sees. */
export function toDisplay(unit: SignalUnit, units: Units, value: number): number {
  if (unit === 'temp') return convertTemp(value, units)
  if (unit === 'speed') return convertSpeed(value, units)
  return value
}

/** Formats with fixed digits; "—" for missing values, no "-0". */
export function formatSignal(def: SignalDef, units: Units, value: number): string {
  return fmt(toDisplay(def.unit, units, value), def.digits)
}
