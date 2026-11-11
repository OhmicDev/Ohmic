// Vehicle math: ERPM -> speed, tachometer -> distance, voltage -> battery %.
// The setup is read from the primary controller's motor settings, and can be edited in Settings.

export type Chemistry = 'liion' | 'lifepo4'

export interface VehicleSetup {
  motorPoles: number
  wheelDiameterMm: number
  gearRatio: number
  batteryCells: number
  batteryChemistry: Chemistry
  batteryAh: number
  maxDuty: number
}

export const DEFAULT_VEHICLE: VehicleSetup = {
  motorPoles: 30,
  wheelDiameterMm: 254,
  gearRatio: 1,
  batteryCells: 13,
  batteryChemistry: 'liion',
  batteryAh: 14,
  maxDuty: 0.95,
}

const polePairs = (v: VehicleSetup) => Math.max(1, v.motorPoles / 2)

export function motorRpm(erpm: number, v: VehicleSetup): number {
  return erpm / polePairs(v)
}

export function speedKmh(erpm: number, v: VehicleSetup): number {
  const wheelRpm = motorRpm(erpm, v) / (v.gearRatio || 1)
  return (wheelRpm * Math.PI * (v.wheelDiameterMm / 1000) * 60) / 1000
}

/** The firmware counts 6 tachometer steps per electrical revolution. */
export function tachoToKm(counts: number, v: VehicleSetup): number {
  const motorRevs = counts / (6 * polePairs(v))
  const wheelRevs = motorRevs / (v.gearRatio || 1)
  return (wheelRevs * Math.PI * (v.wheelDiameterMm / 1000)) / 1000
}

// Resting cell voltage -> state of charge (%).
const CURVES: Record<Chemistry, [number, number][]> = {
  liion: [
    [3.0, 0], [3.3, 5], [3.45, 10], [3.55, 20], [3.62, 30], [3.68, 40],
    [3.74, 50], [3.8, 60], [3.88, 70], [3.96, 80], [4.05, 90], [4.15, 100],
  ],
  lifepo4: [
    [2.5, 0], [3.0, 5], [3.2, 15], [3.25, 30], [3.28, 50], [3.3, 70], [3.33, 90], [3.4, 100],
  ],
}

/** Cell voltage when empty and when full, by the curve above. */
export function cellVoltageRange(chem: Chemistry): [number, number] {
  const t = CURVES[chem]
  return [t[0][0], t[t.length - 1][0]]
}

export function socFromCellVoltage(cellV: number, chem: Chemistry): number {
  const t = CURVES[chem]
  if (cellV <= t[0][0]) return 0
  for (let i = 1; i < t.length; i++) {
    const [v1, s1] = t[i]
    if (cellV <= v1) {
      const [v0, s0] = t[i - 1]
      return s0 + ((s1 - s0) * (cellV - v0)) / (v1 - v0)
    }
  }
  return 100
}

function nominalCellVoltage(chem: Chemistry): number {
  return chem === 'lifepo4' ? 3.2 : 3.6
}

export function packWh(v: VehicleSetup): number {
  return v.batteryCells * nominalCellVoltage(v.batteryChemistry) * v.batteryAh
}

/**
 * Battery % from voltage, without being fooled by sag under load: it follows
 * the voltage quickly when the battery is nearly at rest and very slowly
 * while current is flowing.
 */
export class SocEstimator {
  private soc: number | null = null

  update(vIn: number, currentIn: number, dtSec: number, v: VehicleSetup): number {
    const measured = socFromCellVoltage(vIn / v.batteryCells, v.batteryChemistry)
    if (this.soc === null) {
      this.soc = measured
      return measured
    }
    const tau = Math.abs(currentIn) < 2.5 ? 4 : 180
    this.soc += (measured - this.soc) * Math.min(1, dtSec / tau)
    return this.soc
  }

  reset() {
    this.soc = null
  }
}

export type Units = 'metric' | 'imperial'

export const KM_PER_MI = 1.609344

export const unitLabels = (u: Units) =>
  u === 'metric'
    ? { speed: 'km/h', distance: 'km', perDistance: 'Wh/km', temp: '°C' }
    : { speed: 'mph', distance: 'mi', perDistance: 'Wh/mi', temp: '°F' }

export const convertSpeed = (kmh: number, u: Units) => (u === 'metric' ? kmh : kmh / KM_PER_MI)
export const convertDistance = (km: number, u: Units) => (u === 'metric' ? km : km / KM_PER_MI)
export const convertPerDistance = (whPerKm: number, u: Units) => (u === 'metric' ? whPerKm : whPerKm * KM_PER_MI)
export const convertTemp = (c: number, u: Units) => (u === 'metric' ? c : (c * 9) / 5 + 32)
