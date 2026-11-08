// The assistant's tools, run in the browser because they need the controller.
// Every input is checked against the tool's schema first. None of them writes to
// the controller or moves the motor: proposals only become cards the rider reviews.

import { sameOnWire } from '../config/codec'
import { displaySpec, formatNumber, toDisplay } from '../config/display'
import { optionLabel } from '../config/help'
import { CFG, type ConfigKind, type ParamDef } from '../config/types'
import {
  batteryAmpsFromMotor,
  horsepower,
  LOADED_SHARE,
  pack,
  rangeKm,
  topSpeedKmh,
  watts,
} from '../lib/calculators'
import type { BatteryKind } from '../lib/setupMath'
import { kvFromFlux } from '../lib/setupMath'
import { convertSpeed, unitLabels } from '../lib/vehicle'
import { hasColumn } from '../logs/columns'
import { summarize } from '../logs/summary'
import { faultInfo } from '../protocol/faults'
import { hwTypeLabel } from '../protocol/commands'
import { useConfig, type DeviceConfig } from '../state/config'
import { deviceKind } from '../state/devices'
import { useFaults } from '../state/faults'
import { listRides, loadRideData, rideTitle } from '../state/rideLogs'
import { useRideModes } from '../state/rideModes'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { history, useTelemetry, type HistoryKey } from '../state/telemetry'
import { CALCULATIONS, LIVE_LIMIT_PARAMS, PROFILE_FIELDS, TOOLS } from './agentSpec'
import { blockedReason } from './blocklist'
import { aiId, checkProposal, type GuardContext, type ProposedChange, type ResolvedChange } from './guardrails'
import { packChargeLimitA, packLimitA, parseProfileField, PROFILE_RULES, useProfile, type ProfileField, type VehicleProfile } from './profile'
import { schemaProblem } from './schema'

export interface ToolResult {
  /** What goes back to the assistant. */
  content: string
  isError?: boolean
  /** One line for the chat ("Read your controller's setup"). */
  label: string
}

export interface ToolEnv {
  /** Shows a checked proposal as change cards; returns its id. */
  onProposal: (p: { summary: string; risk: 'low' | 'medium' | 'high'; changes: ResolvedChange[] }) => string
  /** Proposals refused by the guardrails are logged too. */
  onRefused: (summary: string, problems: string[]) => void
  /** When limit tests ran, so a ride summary can say whether one was on. */
  testWindows: { label: string; from: number; to: number | null }[]
}

// ---------------------------------------------------------------- helpers

const round = (n: number, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null)

/** Motor controllers in bus order. */
export function motorDevices(): DeviceConfig[] {
  const { devices, order } = useConfig.getState()
  return order.map((k) => devices[k]).filter((d): d is DeviceConfig => !!d)
}

export function guardContext(): GuardContext {
  return {
    devices: motorDevices().map((d) => ({ key: d.key, id: aiId(d.target), name: d.name, target: d.target, mcconf: d.mcconf, appconf: d.appconf })),
    profile: useProfile.getState().profile,
    vehicle: useSettings.getState().vehicle,
  }
}

function unitOf(p: ParamDef): string {
  const u = displaySpec(p).unit
  return u || (/erpm/i.test(p.name) && (p.typeId === CFG.DOUBLE || p.typeId === CFG.INT) ? 'ERPM' : '')
}

/** "60 A", "Off", "FOC (option 2)" */
function shown(p: ParamDef, v: number | string | undefined): string {
  if (v === undefined) return '—'
  if (typeof v === 'string') return v
  if (p.typeId === CFG.ENUM) return `${optionLabel(p.name, v, p.enums[v])} (option ${v})`
  if (p.typeId === CFG.BOOL) return v ? 'On (1)' : 'Off (0)'
  if (p.typeId === CFG.BITFIELD) return `${v}`
  const s = displaySpec(p)
  const u = unitOf(p)
  return `${formatNumber(toDisplay(p, v), s.decimals + 1)}${u ? ` ${u}` : ''}`
}

function findParam(d: DeviceConfig, name: string): { kind: ConfigKind; p: ParamDef } | null {
  for (const kind of ['mcconf', 'appconf'] as const) {
    const p = d[kind].defs?.params[name]
    if (p) return { kind, p }
  }
  return null
}

function deviceById(id: string): DeviceConfig | null {
  const want = id.trim().toLowerCase()
  return motorDevices().find((d) => aiId(d.target) === want) ?? null
}

const SETTINGS_STATE: Record<string, string> = {
  ready: 'readable and writable',
  readonly: 'read-only: Ohmic has no settings layout for this firmware, so nothing can be changed',
  idle: 'not read yet',
  loading: 'being read',
  unsupported: 'not available',
  error: 'could not be read',
}

const KEY_MOTOR = [
  'motor_type',
  'l_current_max',
  'l_current_min',
  'l_in_current_max',
  'l_in_current_min',
  'l_abs_current_max',
  'l_current_max_scale',
  'l_current_min_scale',
  'l_max_erpm',
  'l_min_erpm',
  'l_erpm_start',
  'l_max_duty',
  'l_watt_max',
  'l_watt_min',
  'l_min_vin',
  'l_max_vin',
  'l_battery_cut_start',
  'l_battery_cut_end',
  'l_battery_regen_cut_start',
  'l_battery_regen_cut_end',
  'l_temp_fet_start',
  'l_temp_fet_end',
  'l_temp_motor_start',
  'l_temp_motor_end',
  'l_temp_accel_dec',
  'foc_fw_current_max',
  'foc_motor_r',
  'foc_motor_l',
  'foc_motor_flux_linkage',
  'm_motor_temp_sens_type',
  'si_motor_poles',
  'si_gear_ratio',
  'si_wheel_diameter',
  'si_battery_type',
  'si_battery_cells',
  'si_battery_ah',
]
const KEY_APP = [
  'app_to_use',
  'app_adc_conf.ctrl_type',
  'app_adc_conf.ramp_time_pos',
  'app_adc_conf.ramp_time_neg',
  'app_adc_conf.throttle_exp',
  'app_adc_conf.throttle_exp_brake',
  'app_adc_conf.throttle_exp_mode',
  'app_adc_conf.tc',
  'app_ppm_conf.ctrl_type',
  'app_ppm_conf.ramp_time_pos',
  'app_ppm_conf.ramp_time_neg',
  'app_ppm_conf.throttle_exp',
]

function keyValues(d: DeviceConfig, kind: ConfigKind, names: string[]): Record<string, string> {
  const k = d[kind]
  const out: Record<string, string> = {}
  if (!k.defs || !k.device) return out
  for (const n of names) {
    const p = k.defs.params[n]
    if (!p || k.device[n] === undefined) continue
    let text = shown(p, k.device[n])
    const def = k.defaults?.[n]
    if (def !== undefined && /^l_temp_/.test(n) && !sameOnWire(p, def, k.device[n])) text += ` (default ${shown(p, def)})`
    out[n] = text
  }
  return out
}

function profileView(p: VehicleProfile) {
  const known: Record<string, string | number> = {}
  const unknown: string[] = []
  for (const f of PROFILE_FIELDS) {
    const v = p[f]
    if (v === null || v === undefined) unknown.push(f)
    else known[f] = typeof v === 'number' && PROFILE_RULES[f].unit ? `${v} ${PROFILE_RULES[f].unit}` : v
  }
  return { known, unknown }
}

const json = (v: unknown) => JSON.stringify(v)
const notShared = (what: string): ToolResult => ({
  content: `The rider turned off sharing ${what} with the assistant (More › Settings › AI Tune). Work without it, or ask them.`,
  label: `Skipped ${what}: not shared`,
})

// ---------------------------------------------------------------- tools

function deviceSnapshot(): ToolResult {
  const s = useSession.getState()
  const settings = useSettings.getState()
  const profile = useProfile.getState().profile
  const modes = useRideModes.getState()
  if (s.status !== 'connected') {
    return {
      content: json({
        connected: false,
        note: 'No controller is connected. Ask the rider to connect (Connect tab) before tuning; you can still talk about their goals and the vehicle profile.',
        vehicle_profile: profileView(profile),
      }),
      label: 'Checked the connection: no controller',
    }
  }
  const controllers = motorDevices().map((d) => {
    const flux = Number(d.mcconf.device?.foc_motor_flux_linkage)
    const poles = Number(d.mcconf.device?.si_motor_poles)
    const kv = kvFromFlux(flux, poles)
    return {
      id: aiId(d.target),
      name: d.name,
      hardware: d.fw.hwName,
      firmware: `${d.fw.major}.${String(d.fw.minor).padStart(2, '0')}`,
      settings: SETTINGS_STATE[d.mcconf.status] ?? d.mcconf.status,
      motor_settings: keyValues(d, 'mcconf', KEY_MOTOR),
      app_settings: keyValues(d, 'appconf', KEY_APP),
      kv_estimate: kv ? `${Math.round(kv)} rpm/V (from flux linkage)` : null,
    }
  })
  const others = s.devices
    .filter((d) => !d.motor)
    .map((d) => ({ id: aiId(d.target), kind: deviceKind(d), name: d.fw?.hwName ?? 'unknown', type: d.fw ? hwTypeLabel(d.fw.hwType) : null }))
  const limit = packLimitA(profile)
  const v = settings.vehicle
  return {
    content: json({
      connected: true,
      demo: s.transportKind === 'mock',
      connection: s.transportKind === 'serial' ? 'USB' : s.transportKind === 'ble' ? 'Bluetooth' : 'Ohmic demo scooter (simulated)',
      controllers,
      other_can_devices: others,
      vehicle_profile: profileView(profile),
      pack_limit_a: limit ? `${round(limit.amps, 1)} A (${limit.from})` : 'unknown: battery current can’t be raised until the rider gives cells in parallel and their rating, or the BMS limit',
      pack_charge_limit_a: packChargeLimitA(profile),
      app_vehicle_setup: {
        wheel_mm: v.wheelDiameterMm,
        motor_poles: v.motorPoles,
        gear_ratio: v.gearRatio,
        cells_series: v.batteryCells,
        chemistry: v.batteryChemistry,
        pack_ah: v.batteryAh,
      },
      ride_mode: modes.activeId ? (modes.modes.find((m) => m.id === modes.activeId)?.name ?? 'custom') : null,
      limit_test_running: modes.test ? modes.test.label : null,
      sharing: { live_data: settings.ai.shareLive, ride_logs: settings.ai.shareRides, fault_history: settings.ai.shareFaults },
      rider_units: settings.units,
    }),
    label: 'Read your controller’s setup',
  }
}

function searchParams(query: string, scope: 'motor' | 'app' | 'both'): ToolResult {
  const d = motorDevices().find((x) => x.mcconf.defs) ?? null
  if (!d) return { content: 'No controller settings are loaded yet.', isError: true, label: 'Looked up settings: none loaded' }
  const words = query.toLowerCase().split(/[^a-z0-9_.]+/).filter((w) => w.length > 1)
  if (!words.length) return { content: 'Give at least one word to search for.', isError: true, label: 'Looked up settings' }
  const kinds: ConfigKind[] = scope === 'motor' ? ['mcconf'] : scope === 'app' ? ['appconf'] : ['mcconf', 'appconf']
  const hits: { score: number; row: Record<string, unknown> }[] = []
  for (const kind of kinds) {
    const k = d[kind]
    if (!k.defs) continue
    for (const p of Object.values(k.defs.params)) {
      const name = p.name.toLowerCase()
      const label = p.label.toLowerCase()
      const help = p.help.toLowerCase()
      let score = 0
      for (const w of words) score += (name.includes(w) ? 3 : 0) + (label.includes(w) ? 2 : 0) + (help.includes(w) ? 1 : 0)
      if (!score) continue
      const s = displaySpec(p)
      hits.push({
        score,
        row: {
          name: p.name,
          label: p.label,
          kind: kind === 'mcconf' ? 'motor' : 'app',
          value: k.device ? shown(p, k.device[p.name]) : null,
          range: p.typeId === CFG.DOUBLE || p.typeId === CFG.INT ? `${formatNumber(s.min, s.decimals)} to ${formatNumber(s.max, s.decimals)} ${unitOf(p)}`.trim() : undefined,
          ...(blockedReason(p.name) ? { off_limits: true } : {}),
        },
      })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  return {
    content: json({ controller: aiId(d.target), results: hits.slice(0, 15).map((h) => h.row) }),
    label: `Looked up settings for “${query}”`,
  }
}

function getParams(names: string[], controller: string): ToolResult {
  if (names.length === 0 || names.length > 30) return { content: 'Ask for 1 to 30 settings at a time.', isError: true, label: 'Read settings' }
  const d = deviceById(controller)
  if (!d) return { content: `There is no controller "${controller}". Use an id from get_device_snapshot.`, isError: true, label: 'Read settings' }
  const rows = names.map((n) => {
    const f = findParam(d, n)
    if (!f) return { name: n, error: 'not a setting on this firmware' }
    const k = d[f.kind]
    const p = f.p
    const s = displaySpec(p)
    const numeric = p.typeId === CFG.DOUBLE || p.typeId === CFG.INT
    const blocked = blockedReason(n)
    return {
      name: n,
      label: p.label,
      kind: f.kind === 'mcconf' ? 'motor' : 'app',
      value: k.device ? shown(p, k.device[n]) : null,
      ...(numeric
        ? {
            value_number: k.device ? round(toDisplay(p, Number(k.device[n])), s.decimals + 2) : null,
            unit: unitOf(p),
            min: round(s.min, s.decimals + 2),
            max: round(s.max, s.decimals + 2),
          }
        : {}),
      default: k.defaults?.[n] !== undefined ? shown(p, k.defaults[n]) : null,
      ...(p.typeId === CFG.ENUM ? { options: p.enums.map((e, i) => `${i}: ${optionLabel(p.name, i, e)}`) } : {}),
      ...(p.typeId === CFG.BOOL ? { options: ['0: Off', '1: On'] } : {}),
      help: p.help.length > 400 ? `${p.help.slice(0, 400)}…` : p.help,
      can_test_live: f.kind === 'mcconf' && (LIVE_LIMIT_PARAMS as readonly string[]).includes(n),
      ...(blocked ? { off_limits: blocked } : {}),
    }
  })
  return { content: json({ controller: aiId(d.target), settings: SETTINGS_STATE[d.mcconf.status], params: rows }), label: `Read ${names.length} setting${names.length === 1 ? '' : 's'}` }
}

const TELEMETRY_UNITS: Record<HistoryKey, string> = {
  speed: 'km/h',
  vIn: 'V',
  currentIn: 'A',
  power: 'W',
  currentMotor: 'A',
  duty: '%',
  erpm: 'ERPM',
  tempMotor: '°C',
  tempFet: '°C',
}

function liveTelemetry(seconds: number): ToolResult {
  if (!useSettings.getState().ai.shareLive) return notShared('live data')
  if (seconds < 1 || seconds > 60) return { content: 'seconds must be 1 to 60.', isError: true, label: 'Looked at live data' }
  const now = Date.now()
  const out: Record<string, unknown> = {}
  let rows = 0
  for (const key of Object.keys(TELEMETRY_UNITS) as HistoryKey[]) {
    const pts = history[key].filter((p) => p.t >= now - seconds * 1000)
    if (!pts.length) continue
    rows = Math.max(rows, pts.length)
    const vals = pts.map((p) => (key === 'duty' ? p.v * 100 : p.v))
    out[key] = {
      min: round(Math.min(...vals), 1),
      max: round(Math.max(...vals), 1),
      avg: round(vals.reduce((a, b) => a + b, 0) / vals.length, 1),
      unit: TELEMETRY_UNITS[key],
    }
  }
  if (!rows) return { content: `No live data in the last ${seconds} s: the controller isn’t connected, or data isn’t coming in.`, label: 'Looked at live data: none' }
  const dash = useTelemetry.getState().dash
  return {
    content: json({
      seconds,
      samples: rows,
      battery_now: dash ? { volts: round(dash.vIn, 1), per_cell: round(dash.cellV, 2), soc_pct: round(dash.soc, 0) } : null,
      faults_now: dash?.faults.map((f) => faultInfo(f.code).id) ?? [],
      stats: out,
      note: 'Speed is km/h; currents and power are the whole vehicle; temperatures are the hottest controller and motor.',
    }),
    label: `Looked at the last ${seconds} s of live data`,
  }
}

async function rideSummary(which: string, env: ToolEnv): Promise<ToolResult> {
  if (!useSettings.getState().ai.shareRides) return notShared('ride logs')
  const rides = await listRides()
  if (!rides.length) return { content: 'There are no ride logs yet. The rider can record one from the Ride screen or Ride logs.', label: 'Checked ride logs: none yet' }
  const list = rides.slice(0, 10).map((r) => ({
    id: r.id,
    title: rideTitle(r),
    started: new Date(r.startedAt).toISOString(),
    minutes: round(r.summary.durationS / 60, 1),
    km: round(r.summary.distanceKm, 2),
    source: r.source,
  }))
  const ride = which.trim().toLowerCase() === 'latest' ? rides[0] : rides.find((r) => r.id === which.trim())
  if (!ride) return { content: json({ error: `No ride with id "${which}".`, recent: list }), isError: true, label: 'Read a ride log' }
  const d = await loadRideData(ride.id)
  const s = d.rows ? summarize(d) : ride.summary
  const c = d.cols
  let vMax = -Infinity
  let maxDuty = 0
  const faultCodes = new Set<number>()
  for (let i = 0; i < d.rows; i++) {
    if (Number.isFinite(c.vIn[i])) vMax = Math.max(vMax, c.vIn[i])
    if (Number.isFinite(c.duty[i])) maxDuty = Math.max(maxDuty, Math.abs(c.duty[i]))
    if (c.fault[i] > 0) faultCodes.add(c.fault[i])
  }
  const end = ride.endedAt ?? ride.startedAt + s.durationS * 1000
  const test = env.testWindows.find((w) => w.from < end && (w.to === null || w.to > ride.startedAt))
  return {
    content: json({
      ride: { id: ride.id, title: rideTitle(ride), started: new Date(ride.startedAt).toISOString(), source: ride.source, demo: ride.demo },
      limit_test_during_ride: test ? test.label : null,
      minutes: round(s.durationS / 60, 1),
      moving_minutes: round(s.movingS / 60, 1),
      distance_km: round(s.distanceKm, 2),
      top_speed_kmh: round(s.maxSpeed, 1),
      avg_speed_kmh: s.avgSpeed === null ? null : round(s.avgSpeed, 1),
      wh_used: round(s.whUsed, 1),
      wh_regen: round(s.whCharged, 1),
      wh_per_km: s.whPerKm === null ? null : round(s.whPerKm, 1),
      peak_power_w: round(s.peakPower, 0),
      peak_regen_power_w: round(s.peakRegenPower, 0),
      peak_battery_current_a: round(s.maxCurrentIn, 1),
      peak_motor_current_a: round(s.maxCurrentMotor, 1),
      voltage_max_v: Number.isFinite(vMax) ? round(vMax, 1) : null,
      voltage_min_v: s.minVoltage === null ? null : round(s.minVoltage, 1),
      voltage_sag_v: Number.isFinite(vMax) && s.minVoltage !== null ? round(vMax - s.minVoltage, 1) : null,
      max_duty_pct: hasColumn(d, 'duty') ? round(maxDuty, 0) : null,
      duty_headroom_pct: hasColumn(d, 'duty') ? round(100 - maxDuty, 0) : null,
      max_temp_motor_c: s.maxTempMotor === null ? null : round(s.maxTempMotor, 0),
      max_temp_controller_c: s.maxTempFet === null ? null : round(s.maxTempFet, 0),
      battery_pct: s.startSoc !== null && s.endSoc !== null ? `${Math.round(s.startSoc)} → ${Math.round(s.endSoc)}` : null,
      faults: s.faults,
      fault_types: [...faultCodes].map((code) => faultInfo(code).id),
      recent: list,
    }),
    label: `Read the ride log “${rideTitle(ride)}”`,
  }
}

function faultHistory(limit: number): ToolResult {
  if (!useSettings.getState().ai.shareFaults) return notShared('fault history')
  if (limit < 1 || limit > 50) return { content: 'limit must be 1 to 50.', isError: true, label: 'Checked fault history' }
  const events = useFaults.getState().events.slice(0, limit)
  const logs = Object.entries(useFaults.getState().logs)
    .filter(([, l]) => l.log?.entries.length)
    .map(([target, l]) => ({ controller: target, entries: l.log!.entries.slice(0, 10).map((e) => ({ fault: e.name, current: e.current, voltage: e.voltage, duty: e.duty, rpm: e.rpm, temperature: e.temperature })) }))
  if (!events.length && !logs.length) return { content: 'No faults recorded.', label: 'Checked fault history: none' }
  return {
    content: json({
      events: events.map((e) => {
        const info = faultInfo(e.code)
        return {
          time: new Date(e.at).toISOString(),
          controller: e.deviceName,
          fault: info.id,
          meaning: info.help,
          lasted_s: e.endedAt ? round((e.endedAt - e.at) / 1000, 1) : null,
          conditions_before: {
            volts: round(e.snapshot.vIn, 1),
            motor_a: round(e.snapshot.currentMotor, 1),
            battery_a: round(e.snapshot.currentIn, 1),
            duty_pct: round(e.snapshot.duty * 100, 0),
            speed_kmh: round(e.snapshot.speed, 1),
            controller_c: round(e.snapshot.tempFet, 0),
            motor_c: round(e.snapshot.tempMotor, 0),
          },
        }
      }),
      controller_fault_logs: logs,
    }),
    label: `Checked fault history (${events.length} event${events.length === 1 ? '' : 's'})`,
  }
}

const CALC_INPUTS: Record<(typeof CALCULATIONS)[number], string[]> = {
  top_speed: ['volts', 'kv', 'wheel_mm', 'gear_ratio', 'duty_pct'],
  range: ['pack_wh', 'usable_pct', 'wh_per_km'],
  battery_current: ['motor_a', 'duty_pct'],
  power: ['volts', 'amps'],
  pack: ['series', 'parallel', 'cell_ah', 'cell_max_a', 'chemistry'],
}

function calculate(calc: (typeof CALCULATIONS)[number], inputs: { name: string; value: number }[]): ToolResult {
  const v: Record<string, number> = {}
  for (const i of inputs) v[i.name] = i.value
  const missing = CALC_INPUTS[calc].filter((n) => !Number.isFinite(v[n]))
  if (missing.length) return { content: `${calc} needs: ${missing.join(', ')}.`, isError: true, label: 'Calculated' }
  const negative = CALC_INPUTS[calc].filter((n) => n !== 'chemistry' && !(v[n] > 0))
  if (negative.length) return { content: `These must be above zero: ${negative.join(', ')}.`, isError: true, label: 'Calculated' }
  const units = useSettings.getState().units
  const sp = (kmh: number) => `${round(convertSpeed(kmh, units), 1)} ${unitLabels(units).speed}`
  switch (calc) {
    case 'top_speed': {
      const noLoad = topSpeedKmh({ volts: v.volts, kv: v.kv, wheelMm: v.wheel_mm, gearRatio: v.gear_ratio, maxDutyPct: v.duty_pct })
      return { content: json({ no_load: sp(noLoad), loaded_estimate: sp(noLoad * LOADED_SHARE) }), label: 'Worked out top speed' }
    }
    case 'range':
      if (v.usable_pct > 100) return { content: 'usable_pct must be at most 100.', isError: true, label: 'Calculated' }
      return { content: json({ range_km: round(rangeKm(v.pack_wh, v.usable_pct, v.wh_per_km), 1) }), label: 'Worked out range' }
    case 'battery_current':
      if (v.duty_pct > 100) return { content: 'duty_pct must be at most 100.', isError: true, label: 'Calculated' }
      return { content: json({ battery_a: round(batteryAmpsFromMotor(v.motor_a, v.duty_pct), 1) }), label: 'Worked out battery current' }
    case 'power': {
      const w = watts(v.volts, v.amps)
      return { content: json({ watts: round(w, 0), horsepower: round(horsepower(w), 2) }), label: 'Worked out power' }
    }
    case 'pack': {
      const chem: BatteryKind | undefined = (['liion', 'lifepo4', 'lead'] as const)[v.chemistry]
      if (!chem || !Number.isInteger(v.chemistry)) return { content: 'chemistry must be 0 (Li-ion), 1 (LiFePO4) or 2 (lead).', isError: true, label: 'Calculated' }
      const r = pack({ chemistry: chem, series: v.series, parallel: v.parallel, cellAh: v.cell_ah, cellMaxA: v.cell_max_a })
      return {
        content: json({ full_v: round(r.fullV, 1), nominal_v: round(r.nominalV, 1), empty_v: round(r.emptyV, 1), ah: round(r.ah, 1), wh: round(r.wh, 0), max_continuous_a: round(r.maxA, 1), max_power_w: round(r.maxPowerW, 0) }),
        label: 'Worked out the battery pack',
      }
    }
  }
}

async function updateProfile(fields: { field: ProfileField; value: string }[]): Promise<ToolResult> {
  if (!fields.length) return { content: 'Give at least one field.', isError: true, label: 'Vehicle profile' }
  const patch: Partial<VehicleProfile> = {}
  const errors: string[] = []
  for (const f of fields) {
    const r = parseProfileField(f.field, f.value)
    if ('error' in r) errors.push(r.error)
    else (patch as Record<string, unknown>)[f.field] = r.value
  }
  if (errors.length) return { content: `Nothing was saved. ${errors.join(' ')}`, isError: true, label: 'Vehicle profile: not saved' }
  await useProfile.getState().update(patch, true)
  const names = fields.map((f) => PROFILE_RULES[f.field].label.toLowerCase())
  return { content: json({ saved: patch, pack_limit_a: packLimitA(useProfile.getState().profile)?.amps ?? null }), label: `Saved to your vehicle profile: ${names.join(', ')}` }
}

function propose(input: { summary: string; risk_level: 'low' | 'medium' | 'high'; changes: ProposedChange[] }, env: ToolEnv): ToolResult {
  const result = checkProposal(input.changes, guardContext())
  if (!result.ok) {
    env.onRefused(input.summary, result.problems)
    return {
      content: `Ohmic’s safety checks refused this proposal, so the rider didn’t see it:\n${result.problems.map((p) => `- ${p}`).join('\n')}`,
      isError: true,
      label: 'A proposal was turned down by the safety checks',
    }
  }
  const id = env.onProposal({ summary: input.summary.trim(), risk: input.risk_level, changes: result.changes })
  const testable = result.changes.every((c) => c.live)
  return {
    content: json({
      shown_to_rider: true,
      proposal_id: id,
      changes: result.changes.map((c) => `${c.param} on ${c.deviceId}: ${c.shownFrom} → ${c.shownTo}`),
      can_run_as_test: testable,
      note: testable
        ? 'The rider can try this as a test mode (memory only) or apply it permanently. Nothing is applied yet.'
        : 'Some changes aren’t live limits, so the rider can only apply this permanently (backed up first). Nothing is applied yet.',
    }),
    label: 'Proposed changes',
  }
}

// ---------------------------------------------------------------- dispatch

/** Runs one tool call. Bad input comes back as an error the assistant can fix. */
export async function runTool(name: string, input: unknown, env: ToolEnv): Promise<ToolResult> {
  const def = TOOLS.find((t) => t.name === name)
  if (!def) return { content: `There is no tool called ${name}.`, isError: true, label: `Unknown tool ${name}` }
  const problem = schemaProblem(def.input_schema, input)
  if (problem) return { content: `Invalid input: ${problem}. Nothing was run; send the call again with valid input.`, isError: true, label: `Rejected a malformed ${name} call` }
  const i = input as Record<string, never>
  try {
    switch (name) {
      case 'get_device_snapshot':
        return deviceSnapshot()
      case 'search_params':
        return searchParams(i.query, i.scope)
      case 'get_params':
        return getParams(i.names, i.controller)
      case 'get_live_telemetry':
        return liveTelemetry(i.seconds)
      case 'get_ride_summary':
        return await rideSummary(i.ride, env)
      case 'get_fault_history':
        return faultHistory(i.limit)
      case 'calculate':
        return calculate(i.calculation, i.inputs)
      case 'propose_config_changes':
        return propose(input as Parameters<typeof propose>[0], env)
      case 'update_vehicle_profile':
        return await updateProfile(i.fields)
    }
  } catch (e) {
    return { content: `The tool failed: ${e instanceof Error ? e.message : String(e)}`, isError: true, label: `${name} failed` }
  }
  return { content: `There is no tool called ${name}.`, isError: true, label: `Unknown tool ${name}` }
}
