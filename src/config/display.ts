// How a setting is shown and typed, following VESC Tool's editors
// (parameditdouble.cpp / parameditint.cpp):
//   shown = stored × editorScale, limits = min/max × editorScale, step in shown units.
//   Percentage fields show stored × 100 / max(|max|, |min|).

import { CFG, type ConfigValue, type ParamDef } from './types'

export interface DisplaySpec {
  /** shown = stored × factor */
  factor: number
  min: number
  max: number
  step: number
  decimals: number
  unit: string
}

export function isNumeric(p: ParamDef): boolean {
  return p.typeId === CFG.DOUBLE || p.typeId === CFG.INT
}

export function displaySpec(p: ParamDef): DisplaySpec {
  if (p.percent) {
    const ref = Math.max(Math.abs(p.max), Math.abs(p.min)) || 1
    const factor = 100 / ref
    return { factor, min: p.min * factor, max: p.max * factor, step: 1, decimals: 1, unit: '%' }
  }
  const factor = isNumeric(p) ? p.editorScale || 1 : 1
  const decimals = p.typeId === CFG.DOUBLE ? Math.max(0, p.decimals) : 0
  return { factor, min: p.min * factor, max: p.max * factor, step: p.step || 1, decimals, unit: p.unit }
}

export function toDisplay(p: ParamDef, v: number): number {
  return v * displaySpec(p).factor
}

/** Converts a typed value back to stored units. Whole-number fields snap off float noise only. */
export function fromDisplay(p: ParamDef, shown: number): number {
  const v = shown / displaySpec(p).factor
  if (p.typeId !== CFG.DOUBLE) {
    const r = Math.round(v)
    if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(r))) return r
  }
  return v
}

/** Rounds to the shown decimals and drops trailing zeros: 55.00 → "55", 11.80 → "11.8". */
export function formatNumber(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return String(n)
  const s = n.toFixed(Math.min(Math.max(decimals, 0), 12))
  const trimmed = s.includes('.') ? s.replace(/\.?0+$/, '') : s
  return trimmed === '-0' ? '0' : trimmed
}

export function bitNames(p: ParamDef, v: number): string[] {
  return p.enums.filter((_n, i) => (v >> i) & 1)
}

/** A stored value as a person would read it: enum label, On/Off, or number with unit. */
export function formatValue(p: ParamDef, v: ConfigValue | undefined, withUnit = true): string {
  if (v === undefined) return '—'
  if (typeof v === 'string') return v === '' ? '(empty)' : v
  switch (p.typeId) {
    case CFG.ENUM:
      return p.enums[v] ?? `Option ${v}`
    case CFG.BOOL:
      return v ? 'On' : 'Off'
    case CFG.BITFIELD: {
      const names = bitNames(p, v)
      return names.length ? names.join(', ') : 'None'
    }
  }
  const spec = displaySpec(p)
  const text = formatNumber(v * spec.factor, spec.decimals)
  return withUnit && spec.unit ? `${text} ${spec.unit}` : text
}
