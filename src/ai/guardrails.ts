// Checks every change the AI proposes, in code, before the rider sees it, and
// again before it is applied. A proposal with any bad change is refused as a
// whole, with the reasons, so the assistant can fix it. Nothing is clamped.
//
//   - the parameter exists on that controller's firmware, and its settings are
//     readable and writable (unknown firmware is read-only)
//   - not on the blocklist (blocklist.ts)
//   - inside the parameter's range and what the wire format can carry
//   - battery current within what the pack and BMS deliver (unknown: no raise)
//   - regen current within what the pack takes back (unknown: no raise)
//   - temperature limits not raised above the controller's defaults
//   - battery cut-offs not below safe per-cell values; regen cut-offs not above full
//   - the config's own consistency rules (validate.ts)
//   - at most MAX_CHANGES changes, no duplicates

import type { Target } from '../client/VescClient'
import { sameOnWire } from '../config/codec'
import { displaySpec, formatNumber, fromDisplay, toDisplay } from '../config/display'
import { CFG, type ConfigKind, type ConfigValues, type ParamDef } from '../config/types'
import { validateConfig, validateValue } from '../config/validate'
import { BATTERY_KINDS } from '../lib/setupMath'
import type { VehicleSetup } from '../lib/vehicle'
import { describeValue } from '../pages/config/describe'
import type { KindState } from '../state/config'
import { LIVE_LIMIT_PARAMS, MAX_CHANGES } from './agentSpec'
import { blockedReason } from './blocklist'
import { packChargeLimitA, packLimitA, type VehicleProfile } from './profile'

/** The controller ids the assistant uses: "local", "can:2". */
export const aiId = (t: Target) => (t === 'local' ? 'local' : `can:${t}`)

export interface GuardDevice {
  /** Config store key. */
  key: string
  id: string
  name: string
  target: Target
  mcconf: KindState
  appconf: KindState
}

export interface GuardContext {
  /** Motor controllers, in bus order. */
  devices: GuardDevice[]
  profile: VehicleProfile
  vehicle: VehicleSetup
}

export interface ProposedChange {
  param: string
  target: string
  new_value: number
  reason: string
  tradeoff: string
}

export interface ResolvedChange {
  param: string
  label: string
  kind: ConfigKind
  deviceKey: string
  deviceId: string
  deviceName: string
  target: Target
  /** Stored units. */
  from: number
  to: number
  /** As the rider reads it ("30 A"). */
  shownFrom: string
  shownTo: string
  /** In the units the assistant used. */
  newValue: number
  reason: string
  tradeoff: string
  /** Can run as a test mode (sent to memory only). */
  live: boolean
}

export type GuardResult = { ok: true; changes: ResolvedChange[] } | { ok: false; problems: string[] }

/** Per-cell floors for cut-offs and ceilings for regen, by battery type (0 Li-ion, 1 LiFePO4, 2 lead). */
const SAFE_CUT = [
  { start: 3.2, end: 3.0 },
  { start: 2.7, end: 2.5 },
  { start: 1.85, end: 1.75 },
]
const TEMP_PARAMS = new Set(['l_temp_fet_start', 'l_temp_fet_end', 'l_temp_motor_start', 'l_temp_motor_end'])
const LIVE = new Set<string>(LIVE_LIMIT_PARAMS)

function kindOf(d: GuardDevice, param: string): { kind: ConfigKind; k: KindState } | null {
  for (const kind of ['mcconf', 'appconf'] as const) {
    const k = d[kind]
    if (k.defs?.params[param]) return { kind, k }
  }
  return null
}

/** Why this controller's settings can't be changed right now, or null. */
function notWritable(d: GuardDevice, k: KindState): string | null {
  switch (k.status) {
    case 'ready':
      return k.device ? null : `${d.name}: its settings haven’t been read yet.`
    case 'readonly':
      return `${d.name} runs firmware Ohmic only reads (unknown settings layout), so its settings can’t be changed.`
    case 'idle':
    case 'loading':
      return `${d.name}: still reading its settings. Try again in a moment.`
    default:
      return `${d.name}: its settings couldn’t be read, so they can’t be changed.`
  }
}

function shownNumber(p: ParamDef, v: number): string {
  const s = displaySpec(p)
  return `${formatNumber(toDisplay(p, v), s.decimals + 1)}${s.unit ? ` ${s.unit}` : ''}`
}

/** Battery chemistry index and cells in series for one controller. */
function battery(d: GuardDevice, ctx: GuardContext): { type: number; cells: number } {
  const mc = d.mcconf.device ?? {}
  const t = Number(mc.si_battery_type)
  const type = t >= 0 && t <= 2 ? t : ctx.vehicle.batteryChemistry === 'lifepo4' ? 1 : 0
  const fromCfg = Number(mc.si_battery_cells)
  const cells = fromCfg > 0 ? fromCfg : (ctx.profile.cells_series ?? ctx.vehicle.batteryCells)
  return { type, cells }
}

/** Rule checks for one change on one controller: null when fine. */
function ruleProblem(c: { param: string; from: number; to: number; p: ParamDef }, d: GuardDevice, k: KindState, ctx: GuardContext): string | null {
  const { param, from, to, p } = c
  if (TEMP_PARAMS.has(param) && to > from) {
    const def = Number(k.defaults?.[param] ?? from)
    if (to > def) return `${p.label} can’t be raised above the controller’s default of ${shownNumber(p, def)}.`
  }
  if ((param === 'l_battery_cut_start' || param === 'l_battery_cut_end') && to < from) {
    const b = battery(d, ctx)
    const per = param === 'l_battery_cut_start' ? SAFE_CUT[b.type].start : SAFE_CUT[b.type].end
    const floor = per * b.cells
    if (to < floor - 1e-6)
      return `${p.label} can’t go below ${formatNumber(floor, 2)} V (${b.cells} cells × ${per} V, the safe floor for ${BATTERY_KINDS[b.type]?.label ?? 'this battery'}).`
  }
  if ((param === 'l_battery_regen_cut_start' || param === 'l_battery_regen_cut_end') && to > from) {
    const b = battery(d, ctx)
    const full = BATTERY_KINDS[b.type]?.full ?? 4.2
    const ceiling = full * b.cells
    if (to > ceiling + 1e-6) return `${p.label} can’t go above a full pack: ${formatNumber(ceiling, 2)} V (${b.cells} cells × ${full} V).`
  }
  return null
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0)

/** Checks a proposal against the controllers and the vehicle profile. */
export function checkProposal(changes: ProposedChange[], ctx: GuardContext): GuardResult {
  const problems: string[] = []
  if (changes.length === 0) return { ok: false, problems: ['A proposal needs at least one change.'] }
  if (changes.length > MAX_CHANGES) return { ok: false, problems: [`At most ${MAX_CHANGES} changes per proposal; this one has ${changes.length}. Split it or keep the most useful.`] }
  if (!ctx.devices.length) return { ok: false, problems: ['No motor controller is connected.'] }

  const out: ResolvedChange[] = []
  const seen = new Set<string>()
  changes.forEach((c, i) => {
    const tag = `Change ${i + 1} (${c.param})`
    const blocked = blockedReason(c.param)
    if (blocked) return problems.push(`${tag}: off-limits. ${blocked}`)
    const target = c.target.trim().toLowerCase()
    const devices = target === 'all' ? ctx.devices : ctx.devices.filter((d) => d.id === target)
    if (!devices.length) return problems.push(`${tag}: there is no controller "${c.target}". Use an id from get_device_snapshot, or "all".`)
    if (!Number.isFinite(c.new_value)) return problems.push(`${tag}: new_value must be a number.`)

    for (const d of devices) {
      const found = kindOf(d, c.param)
      const anyDefs = d.mcconf.defs || d.appconf.defs
      if (!found) {
        const why = anyDefs ? null : notWritable(d, d.mcconf)
        problems.push(`${tag}: ${why ?? `${d.name}’s firmware has no setting called ${c.param}.`}`)
        continue
      }
      const { kind, k } = found
      const why = notWritable(d, k)
      if (why) {
        problems.push(`${tag}: ${why}`)
        continue
      }
      const p = k.defs!.params[c.param]
      if (p.typeId === CFG.STRING) {
        problems.push(`${tag}: text settings can’t be proposed.`)
        continue
      }
      const dupe = `${d.key}|${c.param}`
      if (seen.has(dupe)) {
        problems.push(`${tag}: ${c.param} is changed twice for ${d.name}.`)
        continue
      }
      seen.add(dupe)
      const to = fromDisplay(p, c.new_value)
      const bad = validateValue(p, to)
      if (bad) {
        problems.push(`${tag}: ${shownNumber(p, to)} isn’t allowed. ${bad}.`)
        continue
      }
      const from = Number(k.device![c.param])
      if (sameOnWire(p, to, from)) {
        problems.push(`${tag}: ${p.label} is already ${describeValue(p, from)} on ${d.name}.`)
        continue
      }
      const rule = ruleProblem({ param: c.param, from, to, p }, d, k, ctx)
      if (rule) {
        problems.push(`${tag}: ${rule}`)
        continue
      }
      out.push({
        param: c.param,
        label: p.label,
        kind,
        deviceKey: d.key,
        deviceId: d.id,
        deviceName: d.name,
        target: d.target,
        from,
        to,
        shownFrom: describeValue(p, from),
        shownTo: describeValue(p, to),
        newValue: c.new_value,
        reason: c.reason.trim(),
        tradeoff: c.tradeoff.trim(),
        live: kind === 'mcconf' && LIVE.has(c.param),
      })
    }
  })

  problems.push(...packProblems(out, ctx))
  problems.push(...consistencyProblems(out, ctx))
  return problems.length ? { ok: false, problems } : { ok: true, changes: out }
}

/** Battery and regen current across all controllers, against what the pack can do. */
function packProblems(out: ResolvedChange[], ctx: GuardContext): string[] {
  const problems: string[] = []
  const after = (param: string, d: GuardDevice) => {
    const c = out.find((x) => x.param === param && x.deviceKey === d.key)
    return c ? c.to : Number(d.mcconf.device?.[param] ?? 0)
  }
  const ready = ctx.devices.filter((d) => d.mcconf.status === 'ready' && d.mcconf.device)

  const raised = out.filter((c) => c.param === 'l_in_current_max' && c.to > c.from)
  if (raised.length) {
    const limit = packLimitA(ctx.profile)
    const total = sum(ready.map((d) => after('l_in_current_max', d)))
    if (!limit) {
      problems.push(
        'Battery current can’t be raised above its current value until the pack’s limit is known: ask the rider for cells in parallel and their continuous rating, or the BMS’s discharge limit, and save it with update_vehicle_profile.',
      )
    } else if (total > limit.amps + 0.05) {
      problems.push(
        `Battery current would total ${formatNumber(total, 1)} A across ${ready.length === 1 ? 'the controller' : `${ready.length} controllers`}, more than the pack can deliver: ${formatNumber(limit.amps, 1)} A (${limit.from}).`,
      )
    }
  }

  const regen = out.filter((c) => c.param === 'l_in_current_min' && c.to < c.from)
  if (regen.length) {
    const limit = packChargeLimitA(ctx.profile)
    const total = -sum(ready.map((d) => after('l_in_current_min', d)))
    if (limit === null) {
      problems.push(
        'Regen current into the battery can’t be raised until the pack’s charge limit is known: ask for cells in parallel and each cell’s maximum charge current.',
      )
    } else if (total > limit + 0.05) {
      problems.push(`Regen current would total ${formatNumber(total, 1)} A, more than the pack takes: ${formatNumber(limit, 1)} A.`)
    }
  }
  return problems
}

/** The config's own rules (cut-off order, temperature start below end...), on the values after the change. */
function consistencyProblems(out: ResolvedChange[], ctx: GuardContext): string[] {
  const problems: string[] = []
  const groups = new Map<string, ResolvedChange[]>()
  for (const c of out) {
    const g = `${c.deviceKey}|${c.kind}`
    groups.set(g, [...(groups.get(g) ?? []), c])
  }
  for (const list of groups.values()) {
    const d = ctx.devices.find((x) => x.key === list[0].deviceKey)!
    const k = d[list[0].kind]
    const after: ConfigValues = { ...k.device! }
    for (const c of list) after[c.param] = c.to
    // Anything the change would newly get wrong is refused, warnings included
    // (e.g. motor current above the absolute limit); what's already so is left alone.
    const key = (i: { param: string; message: string }) => `${i.param}|${i.message}`
    const already = new Set(validateConfig(k.defs!, k.device!, { base: k.device! }).map(key))
    for (const issue of validateConfig(k.defs!, after, { base: k.device! })) {
      if (!already.has(key(issue))) problems.push(`${d.name}: ${issue.message}.`)
    }
  }
  return problems
}
