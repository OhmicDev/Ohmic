// Checks a config before it is written. Out-of-range values are rejected with a
// reason, never clamped. Fields the user did not touch are only warned about:
// they are already on the controller that way.

import { sameOnWire, wireInt, wireRange } from './codec'
import { displaySpec, formatNumber } from './display'
import { CFG, TX, type ConfigDefs, type ConfigKind, type ConfigValue, type ConfigValues, type ParamDef } from './types'

export interface Issue {
  param: string
  level: 'error' | 'warning'
  message: string
}

function shown(p: ParamDef, v: number): string {
  const s = displaySpec(p)
  return `${formatNumber(v * s.factor, s.decimals)}${s.unit ? ` ${s.unit}` : ''}`
}

/** Returns why a single value can't be used, or null if it's fine. */
export function validateValue(p: ParamDef, v: ConfigValue | undefined): string | null {
  if (v === undefined) return 'Missing value'
  if (p.typeId === CFG.STRING) {
    if (typeof v !== 'string') return 'Expected text'
    if (v.includes('\0')) return 'Text cannot contain a NUL character'
    if (p.maxLen > 0 && new TextEncoder().encode(v).length > p.maxLen) return `At most ${p.maxLen} characters`
    return null
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'Expected a number'

  switch (p.typeId) {
    case CFG.ENUM:
      return Number.isInteger(v) && v >= 0 && v < p.enums.length ? null : 'Pick one of the listed options'
    case CFG.BOOL:
      return v === 0 || v === 1 ? null : 'Must be on or off'
    case CFG.BITFIELD:
      return Number.isInteger(v) && v >= 0 && v < 2 ** Math.min(p.enums.length, 8) ? null : 'Unknown option bits set'
  }

  if (p.typeId === CFG.INT && !Number.isInteger(v)) return 'Must be a whole number'
  const eps = 1e-9 * Math.max(1, Math.abs(p.min), Math.abs(p.max))
  if (v < p.min - eps || v > p.max + eps) return `Must be between ${shown(p, p.min)} and ${shown(p, p.max)}`

  if (p.typeId === CFG.DOUBLE && p.txId === TX.DOUBLE32_AUTO) return null
  const i = wireInt(p, v)
  const range = wireRange(p)
  if (i === null || !range) return 'This setting type is not supported'
  if (i < range[0] || i > range[1]) return 'Too large for the controller to store'
  return null
}

interface Rule {
  kind: ConfigKind
  fields: string[]
  level: 'error' | 'warning'
  /** Returns the problem, or null. Values are in stored units. */
  check: (v: (name: string) => number) => string | null
}

const RULES: Rule[] = [
  {
    kind: 'mcconf',
    fields: ['l_battery_cut_start', 'l_battery_cut_end'],
    level: 'error',
    check: (v) =>
      v('l_battery_cut_end') < v('l_battery_cut_start') ? null : 'Battery cut-off end must be below cut-off start',
  },
  {
    kind: 'mcconf',
    fields: ['l_min_vin', 'l_max_vin'],
    level: 'error',
    check: (v) => (v('l_min_vin') < v('l_max_vin') ? null : 'Minimum input voltage must be below the maximum'),
  },
  {
    kind: 'mcconf',
    fields: ['l_battery_cut_end', 'l_min_vin'],
    level: 'warning',
    check: (v) =>
      v('l_battery_cut_end') >= v('l_min_vin')
        ? null
        : 'Cut-off ends below the minimum input voltage, so the controller will fault before it finishes cutting power',
  },
  {
    kind: 'mcconf',
    fields: ['l_battery_regen_cut_start', 'l_battery_regen_cut_end'],
    level: 'error',
    check: (v) =>
      v('l_battery_regen_cut_start') < v('l_battery_regen_cut_end')
        ? null
        : 'Regen cut-off start must be below regen cut-off end',
  },
  {
    kind: 'mcconf',
    fields: ['l_temp_fet_start', 'l_temp_fet_end'],
    level: 'error',
    check: (v) =>
      v('l_temp_fet_start') < v('l_temp_fet_end') ? null : 'MOSFET temperature limit start must be below its end',
  },
  {
    kind: 'mcconf',
    fields: ['l_temp_motor_start', 'l_temp_motor_end'],
    level: 'error',
    check: (v) =>
      v('l_temp_motor_start') < v('l_temp_motor_end') ? null : 'Motor temperature limit start must be below its end',
  },
  {
    kind: 'mcconf',
    fields: ['l_abs_current_max', 'l_current_max', 'l_current_min'],
    level: 'warning',
    check: (v) =>
      v('l_abs_current_max') >= Math.max(v('l_current_max'), -v('l_current_min'))
        ? null
        : 'Absolute maximum current is below the motor current limits, which causes over-current faults',
  },
]

export interface ValidateOptions {
  /** Values currently on the controller; fields equal to these are "untouched". */
  base?: ConfigValues
}

export function validateConfig(defs: ConfigDefs, values: ConfigValues, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = []
  const touched = (name: string) => !opts.base || !sameOnWire(defs.params[name], values[name], opts.base[name])

  for (const name of defs.order) {
    const p = defs.params[name]
    const problem = validateValue(p, values[name])
    if (!problem) continue
    // A value the wire can't carry is always fatal; a pre-existing range issue is not ours to block.
    const fatal = touched(name) || problem.startsWith('Too large') || problem.startsWith('Expected') || problem === 'Missing value'
    issues.push({
      param: name,
      level: fatal ? 'error' : 'warning',
      message: fatal ? problem : `${problem}. It is already like this on the controller and will be left as is.`,
    })
  }

  for (const rule of RULES) {
    if (rule.kind !== defs.kind || !rule.fields.every((f) => f in defs.params)) continue
    if (rule.fields.some((f) => typeof values[f] !== 'number')) continue
    const msg = rule.check((f) => values[f] as number)
    if (!msg) continue
    issues.push({ param: rule.fields[0], level: rule.fields.some(touched) ? rule.level : 'warning', message: msg })
  }
  return issues
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error')
