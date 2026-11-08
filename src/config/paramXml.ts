// Turns VESC Tool's parameter XML (<ConfigParams>) into config definitions.
// Used at build time for the motor and app settings (scripts/gen-config-defs.ts),
// and in the browser for the settings a package brings (custom configs).

import { computeSignature } from './signature.ts'
import type { ConfigDefs, ConfigGroup, ConfigKind, ParamDef } from './types.ts'
import { child, childText, decodeEntities, parseXml, type XmlElement } from '../lib/xml.ts'

const CFG_DOUBLE = 1
const CFG_STRING = 3
const SEP = '::sep::'

/** VESC Tool help is Qt rich text. Keep the words and paragraph breaks. */
function htmlToText(html: string): string {
  if (!/<[a-z!/][\s\S]*>/i.test(html)) return html.trim()
  let s = html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function num(el: XmlElement, name: string, fallback: number): number {
  const t = childText(el, name)
  if (t === undefined || t.trim() === '') return fallback
  const n = Number(t.trim())
  return Number.isFinite(n) ? n : fallback
}

/** Field defaults match ConfigParam::reset() in VESC Tool. */
function readParam(el: XmlElement): ParamDef {
  const typeId = num(el, 'type', 0)
  const isDouble = typeId === CFG_DOUBLE
  return {
    name: el.name,
    label: (childText(el, 'longName') ?? 'none').trim(),
    typeId,
    txId: num(el, 'vTx', 0),
    scale: num(el, 'vTxDoubleScale', 1),
    min: isDouble ? num(el, 'minDouble', 0) : num(el, 'minInt', 0),
    max: isDouble ? num(el, 'maxDouble', 99) : num(el, 'maxInt', 99),
    step: isDouble ? num(el, 'stepDouble', 1) : num(el, 'stepInt', 1),
    decimals: num(el, 'editorDecimalsDouble', 2),
    editorScale: num(el, 'editorScale', 1),
    percent: num(el, 'editAsPercentage', 0) !== 0,
    unit: (childText(el, 'suffix') ?? '').trim(),
    enums: el.children.filter((c) => c.name === 'enumNames').map((c) => c.text),
    maxLen: num(el, 'maxLen', 0),
    def: typeId === CFG_STRING ? (childText(el, 'valString') ?? '') : isDouble ? num(el, 'valDouble', 0) : num(el, 'valInt', 0),
    help: htmlToText(childText(el, 'description') ?? ''),
    cDefine: (childText(el, 'cDefine') ?? '').trim(),
  }
}

export function convertParamXml(xml: string, kind: ConfigKind, fw: string): ConfigDefs {
  const root = child(parseXml(xml), 'ConfigParams')
  if (!root) throw new Error('No <ConfigParams>')
  const paramsEl = child(root, 'Params')
  const serEl = child(root, 'SerOrder')
  if (!paramsEl || !serEl) throw new Error('Missing <Params> or <SerOrder>')

  const order = serEl.children.filter((c) => c.name === 'ser').map((c) => c.text.trim())
  const all = new Map(paramsEl.children.map((p) => [p.name, readParam(p)]))
  const params: Record<string, ParamDef> = {}
  for (const name of order) {
    const p = all.get(name)
    if (!p) throw new Error(`${kind} ${fw}: serialized field ${name} has no definition`)
    params[name] = p
  }

  const groups: ConfigGroup[] = []
  for (const g of child(root, 'Grouping')?.children ?? []) {
    if (g.name !== 'group') continue
    const group: ConfigGroup = { name: (childText(g, 'groupName') ?? '').trim(), subgroups: [] }
    for (const sg of g.children) {
      if (sg.name !== 'subgroup') continue
      const items = (child(sg, 'subgroupParams')?.children ?? [])
        .filter((c) => c.name === 'param')
        .map((c) => c.text.trim())
        // Only settings the controller actually stores; VESC Tool-only notes are left out.
        .filter((n) => n.startsWith(SEP) || n in params)
      if (items.some((n) => !n.startsWith(SEP))) group.subgroups.push({ name: (childText(sg, 'subgroupName') ?? '').trim(), items })
    }
    if (group.subgroups.length) groups.push(group)
  }

  return { kind, fw, signature: computeSignature({ order, params }), order, params, groups }
}

