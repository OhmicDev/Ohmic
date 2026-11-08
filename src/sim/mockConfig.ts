// Motor and app settings for a simulated controller, handled the way firmware 6.06
// does it (commands.c): signature check, current-scale clamps, hardware limits,
// calibrated offsets kept, a short pause while flash is written.

import appDefsJson from '../config/defs/6.06/appconf.json'
import mcDefsJson from '../config/defs/6.06/mcconf.json'
import { decodeConfig, encodeConfig, xmlDefaults } from '../config/codec'
import { loadDefs, SUPPORTED_FW } from '../config/registry'
import type { ConfigDefs, ConfigKind, ConfigValues } from '../config/types'

export const MOCK_DEFS: Record<ConfigKind, ConfigDefs> = {
  mcconf: mcDefsJson as ConfigDefs,
  appconf: appDefsJson as ConfigDefs,
}

/** What the simulated "SIM_75_100" hardware can take (HW_LIM_* in a real hw_*.h). */
export const MOCK_HW_LIMITS: Record<string, [number, number]> = {
  l_current_max: [0, 100],
  l_current_min: [-100, 0],
  l_in_current_max: [0, 100],
  l_in_current_min: [-100, 0],
  l_abs_current_max: [0, 150],
  l_min_vin: [11, 78],
  l_max_vin: [11, 78],
  l_battery_cut_start: [11, 78],
  l_battery_cut_end: [11, 78],
  l_max_duty: [0, 0.95],
  l_temp_fet_start: [-40, 110],
  l_temp_fet_end: [-40, 110],
}

const offsetFields = (defs: ConfigDefs) => defs.order.filter((n) => n.startsWith('foc_offsets_') && n !== 'foc_offsets_cal_mode')

/** Hardware defaults: VESC Tool's defaults adjusted the way a hw config file would. */
function hwDefaults(kind: ConfigKind, controllerId: number, defs: ConfigDefs = MOCK_DEFS[kind]): ConfigValues {
  const v = xmlDefaults(defs)
  if (kind === 'appconf') {
    v.controller_id = controllerId
    return v
  }
  return { ...v, l_current_max: 60, l_abs_current_max: 150, l_max_vin: 72, l_min_vin: 11 }
}

/** The setup a rider would have after running the motor wizard on the demo scooter. */
function tunedMcconf(): ConfigValues {
  return {
    ...hwDefaults('mcconf', 0),
    motor_type: 2, // FOC
    l_current_max: 55,
    l_current_min: -40,
    l_in_current_max: 30,
    l_in_current_min: -12,
    l_abs_current_max: 150,
    l_max_duty: 0.95,
    l_min_vin: 30,
    l_max_vin: 60,
    l_battery_cut_start: 41.6,
    l_battery_cut_end: 39,
    foc_motor_r: 0.09,
    foc_motor_l: 0.00015,
    foc_motor_flux_linkage: 0.0216,
    foc_current_kp: 0.15,
    foc_current_ki: 90,
    foc_observer_gain: 2.14e6,
    foc_sensor_mode: 0, // sensorless
    si_motor_poles: 30,
    si_gear_ratio: 1,
    si_wheel_diameter: 0.254,
    si_battery_type: 0,
    si_battery_cells: 13,
    si_battery_ah: 14,
    foc_offsets_current__0: 2048.3,
    foc_offsets_current__1: 2047.6,
    foc_offsets_current__2: 2049.1,
  }
}

export class MockConfigStore {
  readonly values: Record<ConfigKind, ConfigValues>
  /** The layouts this firmware uses; a firmware update may change them. */
  defs: Record<ConfigKind, ConfigDefs> = { ...MOCK_DEFS }
  private readonly controllerId: number
  private readonly dualMotorHw: boolean
  /** Number of flash writes, so tests can see a write happened. */
  writes = 0

  constructor(controllerId: number, opts: { dualMotorHw?: boolean } = {}) {
    this.controllerId = controllerId
    this.dualMotorHw = opts.dualMotorHw ?? false
    this.values = { mcconf: tunedMcconf(), appconf: hwDefaults('appconf', controllerId) }
  }

  get(kind: ConfigKind, defaults = false): Uint8Array {
    return encodeConfig(this.defs[kind], defaults ? this.defaultsFor(kind) : this.values[kind])
  }

  private defaultsFor(kind: ConfigKind): ConfigValues {
    const d = hwDefaults(kind, this.controllerId, this.defs[kind])
    // GET_MCCONF_DEFAULT keeps the calibrated offsets.
    if (kind === 'mcconf') for (const f of offsetFields(this.defs.mcconf)) d[f] = this.values.mcconf[f]
    return d
  }

  /**
   * New firmware was installed. Like the real thing, settings stored in a layout
   * the new firmware doesn't use are dropped for its defaults (the calibration
   * offsets survive). Versions Ohmic has no layout for use the newest it has.
   */
  async reflash(fw: string): Promise<void> {
    const known = SUPPORTED_FW.includes(fw) ? fw : [...SUPPORTED_FW].reverse().find((v) => Number(v) <= Number(fw)) ?? SUPPORTED_FW[0]
    const [mc, app] = await Promise.all([loadDefs(known, 'mcconf'), loadDefs(known, 'appconf')])
    if (!mc || !app) return
    const next = { mcconf: mc, appconf: app }
    for (const kind of ['mcconf', 'appconf'] as const) {
      if (next[kind].signature === this.defs[kind].signature) continue
      const fresh = hwDefaults(kind, this.controllerId, next[kind])
      if (kind === 'mcconf') for (const f of offsetFields(next.mcconf)) if (this.values.mcconf[f] !== undefined) fresh[f] = this.values.mcconf[f]
      this.values[kind] = fresh
    }
    this.defs = next
  }

  /** Applies a SET_*CONF body. Throws SignatureMismatchError where the firmware would refuse. */
  set(kind: ConfigKind, body: Uint8Array): ConfigValues {
    const next = decodeConfig(this.defs[kind], body)
    if (kind === 'mcconf') {
      next.l_current_max_scale = clamp(next.l_current_max_scale as number, 0, 1)
      next.l_current_min_scale = clamp(next.l_current_min_scale as number, 0, 1)
      // Offsets come from calibration; a write only replaces them when asked to.
      if (!((next.foc_offsets_cal_mode as number) & 0b10)) {
        for (const f of offsetFields(this.defs.mcconf)) next[f] = this.values.mcconf[f]
      }
      for (const [name, [lo, hi]] of Object.entries(MOCK_HW_LIMITS)) {
        if (typeof next[name] === 'number') next[name] = clamp(next[name] as number, lo, hi)
      }
    } else if (this.dualMotorHw) {
      next.controller_id = this.values.appconf.controller_id
    }
    this.values[kind] = next
    this.writes++
    return next
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}
