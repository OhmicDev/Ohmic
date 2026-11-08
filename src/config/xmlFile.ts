// VESC Tool's "Save/Load motor (or app) configuration" XML files
// (ConfigParams::getXML / setXML):
//   <MCConfiguration><ConfigVersion>4</ConfigVersion><name>value</name>…</MCConfiguration>
// Ints, enums, bools and bitfields are whole numbers; doubles are decimals.
// VESC Tool ignores names it doesn't know and keeps its value for names that are missing.

import { escapeXml, parseXml, XmlError, type XmlElement } from '../lib/xml'
import { quantize, wireInt } from './codec'
import { validateValue } from './validate'
import { CFG, TX, type ConfigDefs, type ConfigKind, type ConfigValue, type ConfigValues, type ParamDef } from './types'

export const VT_CONFIG_VERSION = 4

export const XML_ROOT: Record<ConfigKind, string> = {
  mcconf: 'MCConfiguration',
  appconf: 'APPConfiguration',
}

/** Shortest decimal that reads back as the same float32. */
function float32Text(v: number): string {
  const f = Math.fround(v)
  for (let p = 1; p <= 9; p++) {
    const n = Number(f.toPrecision(p))
    if (Math.fround(n) === f) return String(n)
  }
  return String(f)
}

/** Text for one value. More digits than VESC Tool writes (it keeps 6), so nothing is lost. */
export function valueText(p: ParamDef, v: ConfigValue): string {
  if (typeof v === 'string') return v
  if (p.typeId !== CFG.DOUBLE) return String(Math.trunc(v))
  if (p.txId === TX.DOUBLE32_AUTO) return float32Text(quantize(p, v) as number)
  const i = wireInt(p, v)
  return String(i === null ? v : i / p.scale)
}

export function exportConfigXml(defs: ConfigDefs, values: ConfigValues): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<${XML_ROOT[defs.kind]}>`]
  lines.push(`    <ConfigVersion>${VT_CONFIG_VERSION}</ConfigVersion>`)
  for (const name of defs.order) {
    const v = values[name]
    if (v === undefined) continue
    lines.push(`    <${name}>${escapeXml(valueText(defs.params[name], v))}</${name}>`)
  }
  lines.push(`</${XML_ROOT[defs.kind]}>`, '')
  return lines.join('\n')
}

function rootOf(xml: string): XmlElement {
  const doc = parseXml(xml)
  const root = doc.children[0]
  if (!root) throw new XmlError('The file is empty')
  return root
}

/** Which config a VESC Tool XML file holds, or null if it isn't one. */
export function detectKind(xml: string): ConfigKind | null {
  try {
    const name = rootOf(xml).name
    return name === XML_ROOT.mcconf ? 'mcconf' : name === XML_ROOT.appconf ? 'appconf' : null
  } catch {
    return null
  }
}

export interface ImportResult {
  /** Only the fields found in the file, parsed and checked. */
  values: ConfigValues
  configVersion: number | null
  /** Names in the file this firmware doesn't have; skipped. */
  unknown: string[]
  /** Fields the file has but whose value can't be used; skipped. */
  invalid: { name: string; text: string; reason: string }[]
  /** Fields this firmware has but the file doesn't; they keep their current value. */
  missing: string[]
}

function parseValue(p: ParamDef, raw: string): ConfigValue | string {
  if (p.typeId === CFG.STRING) return raw
  const text = raw.trim()
  if (text === '') return 'empty value'
  const n = Number(text)
  if (!Number.isFinite(n)) return `"${text}" is not a number`
  if (p.typeId !== CFG.DOUBLE && !Number.isInteger(n)) return `"${text}" is not a whole number`
  return n
}

export function importConfigXml(defs: ConfigDefs, xml: string): ImportResult {
  const root = rootOf(xml)
  const expected = XML_ROOT[defs.kind]
  if (root.name !== expected) {
    const other = root.name === XML_ROOT.mcconf ? 'motor' : root.name === XML_ROOT.appconf ? 'app' : null
    throw new XmlError(
      other ? `This is a ${other} configuration file, not ${defs.kind === 'mcconf' ? 'motor' : 'app'} configuration` : `Not a VESC Tool configuration file (found <${root.name}>)`,
    )
  }

  const out: ImportResult = { values: {}, configVersion: null, unknown: [], invalid: [], missing: [] }
  for (const el of root.children) {
    if (el.name === 'ConfigVersion') {
      const v = Number(el.text.trim())
      out.configVersion = Number.isFinite(v) ? v : null
      continue
    }
    const p = defs.params[el.name]
    if (!p) {
      out.unknown.push(el.name)
      continue
    }
    const parsed = parseValue(p, el.text)
    if (typeof parsed === 'string' && p.typeId !== CFG.STRING) {
      out.invalid.push({ name: el.name, text: el.text, reason: parsed })
      continue
    }
    const problem = validateValue(p, parsed)
    if (problem) {
      out.invalid.push({ name: el.name, text: el.text, reason: problem })
      continue
    }
    out.values[el.name] = parsed
  }
  out.missing = defs.order.filter((n) => !(n in out.values) && !out.invalid.some((i) => i.name === n))
  return out
}
