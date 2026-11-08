import { bitNames, formatValue } from '../../config/display'
import { optionLabel } from '../../config/help'
import { CFG, type ConfigValue, type ParamDef } from '../../config/types'

/** A value as words, with friendlier enum names. */
export function describeValue(p: ParamDef, v: ConfigValue | undefined): string {
  if (typeof v === 'number' && p.typeId === CFG.ENUM) return optionLabel(p.name, v, p.enums[v])
  if (typeof v === 'number' && p.typeId === CFG.BITFIELD) return bitNames(p, v).join(', ') || 'None'
  return formatValue(p, v)
}
