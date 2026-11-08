// Shapes of the config definitions generated from VESC Tool's parameter XML.
// The numeric ids match VESC Tool's CFG_T and VESC_TX_T enums (datatypes.h);
// they are kept as numbers because the config signature is computed from them.

export type ConfigKind = 'mcconf' | 'appconf'

export const CFG = {
  UNDEFINED: 0,
  DOUBLE: 1,
  INT: 2,
  STRING: 3,
  ENUM: 4,
  BOOL: 5,
  BITFIELD: 6,
} as const

export const TX = {
  UNDEFINED: 0,
  UINT8: 1,
  INT8: 2,
  UINT16: 3,
  INT16: 4,
  UINT32: 5,
  INT32: 6,
  DOUBLE16: 7,
  DOUBLE32: 8,
  DOUBLE32_AUTO: 9,
} as const

export interface ParamDef {
  name: string
  /** Display name (VESC Tool's longName). */
  label: string
  typeId: number
  txId: number
  /** Fixed-point scale for DOUBLE16 / DOUBLE32. */
  scale: number
  /** Limits and step in stored units. */
  min: number
  max: number
  step: number
  decimals: number
  /** Display = stored × editorScale (or × 100 when `percent`). */
  editorScale: number
  percent: boolean
  unit: string
  enums: string[]
  maxLen: number
  /** VESC Tool's default; the controller's own defaults can differ per hardware. */
  def: number | string
  /** Plain-text version of VESC Tool's description. */
  help: string
  cDefine: string
}

export interface ConfigSubgroup {
  name: string
  /** Parameter names, plus `::sep::Label` separators as in VESC Tool. */
  items: string[]
}

export interface ConfigGroup {
  name: string
  subgroups: ConfigSubgroup[]
}

export interface ConfigDefs {
  kind: ConfigKind
  /** Firmware version these definitions are for, e.g. "6.06". */
  fw: string
  /** Matches MCCONF_SIGNATURE / APPCONF_SIGNATURE in the firmware build. */
  signature: number
  /** Serialization order: exactly the fields the firmware sends, in order. */
  order: string[]
  params: Record<string, ParamDef>
  groups: ConfigGroup[]
}

export type ConfigValue = number | string
export type ConfigValues = Record<string, ConfigValue>

export const SEPARATOR = '::sep::'
