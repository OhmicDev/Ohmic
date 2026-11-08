import { describe, expect, it } from 'vitest'
import { BufferWriter, toHex } from '../protocol/buffer'
import layouts from './__fixtures__/fw-layouts.json'
import { decodeConfig, encodeConfig, EncodeError, quantize, roundDouble, sameOnWire, SignatureMismatchError, wireRange, xmlDefaults } from './codec'
import { displaySpec, formatValue, fromDisplay, toDisplay } from './display'
import { fwKey, loadDefs, resolveDefs, SUPPORTED_FW } from './registry'
import { computeSignature } from './signature'
import { CFG, TX, type ConfigDefs, type ConfigKind, type ConfigValues, type ParamDef } from './types'
import { hasErrors, validateConfig, validateValue } from './validate'
import { detectKind, exportConfigXml, importConfigXml } from './xmlFile'

type Layout = { signature: number; fields: ([string, string] | [string, string, number])[] }
const FW = layouts as unknown as Record<string, Record<ConfigKind, Layout>>

const all = import.meta.glob<ConfigDefs>('./defs/*/*.json', { eager: true, import: 'default' })
const defsFor = (fw: string, kind: ConfigKind) => all[`./defs/${fw}/${kind}.json`]
const cases = Object.keys(FW).flatMap((fw) => (['mcconf', 'appconf'] as const).map((kind) => [fw, kind] as const))

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Our definition's wire token, in the same terms as the firmware fixture. */
function token(p: ParamDef): (string | number)[] {
  if (p.typeId === CFG.DOUBLE) {
    if (p.txId === TX.DOUBLE16) return ['f16', p.scale]
    if (p.txId === TX.DOUBLE32) return ['f32', p.scale]
    return ['f32auto']
  }
  if (p.typeId === CFG.INT) return [{ 1: 'u8', 2: 'i8', 3: 'u16', 4: 'i16', 5: 'u32', 6: 'i32' }[p.txId]!]
  return ['byte'] // enums, bools and bitfields: one byte either way
}

/** Random bytes laid out the way the firmware's own serializer would send them. */
function firmwareBlob(layout: Layout, rand: () => number): Uint8Array {
  const w = new BufferWriter().u32(layout.signature)
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  for (const [, t] of layout.fields) {
    switch (t) {
      case 'u8':
      case 'i8':
        w.u8(int(0, 255))
        break
      case 'f16':
      case 'i16':
      case 'u16':
        w.u16(int(0, 0xffff))
        break
      case 'f32':
      case 'i32':
      case 'u32':
        w.u32(int(0, 0xffffffff))
        break
      case 'f32auto': {
        // Any float the firmware can send: it zeroes anything below 1.5e-38 (exponent < 2)
        const bits = ((int(0, 1) << 31) | (int(2, 254) << 23) | int(0, 0x7fffff)) >>> 0
        w.u32(rand() < 0.1 ? 0 : bits)
        break
      }
      default:
        throw new Error(`unknown token ${t}`)
    }
  }
  return w.toUint8Array()
}

function randomValues(defs: ConfigDefs, rand: () => number): ConfigValues {
  const out: ConfigValues = {}
  for (const name of defs.order) {
    const p = defs.params[name]
    if (p.typeId === CFG.ENUM) out[name] = Math.floor(rand() * p.enums.length)
    else if (p.typeId === CFG.BOOL) out[name] = rand() < 0.5 ? 0 : 1
    else if (p.typeId === CFG.BITFIELD) out[name] = Math.floor(rand() * 2 ** Math.min(8, p.enums.length))
    else if (p.typeId === CFG.STRING) out[name] = 'x'.repeat(Math.floor(rand() * Math.max(1, p.maxLen)))
    else {
      let lo = p.min
      let hi = p.max
      const range = wireRange(p)
      if (range && p.typeId === CFG.DOUBLE && p.txId !== TX.DOUBLE32_AUTO) {
        lo = Math.max(lo, range[0] / p.scale)
        hi = Math.min(hi, range[1] / p.scale)
      } else if (range) {
        lo = Math.max(lo, range[0])
        hi = Math.min(hi, range[1])
      }
      const v = lo + rand() * (hi - lo)
      out[name] = p.typeId === CFG.INT ? Math.min(hi, Math.max(lo, Math.round(v))) : (quantize(p, v) as number)
    }
  }
  return out
}

describe('definitions match the firmware', () => {
  it('has the four supported releases', () => {
    expect(SUPPORTED_FW).toEqual(['6.02', '6.05', '6.06', '7.00'])
    expect(fwKey(6, 6)).toBe('6.06')
    expect(fwKey(7, 0)).toBe('7.00')
  })

  it.each(cases)('%s %s: signature equals the firmware constant', (fw, kind) => {
    const defs = defsFor(fw, kind)
    expect(defs.signature).toBe(FW[fw][kind].signature)
    expect(computeSignature(defs)).toBe(FW[fw][kind].signature)
  })

  it.each(cases)('%s %s: field order and wire types equal confgenerator.c', (fw, kind) => {
    const defs = defsFor(fw, kind)
    const ours = defs.order.map((n) => [n, ...token(defs.params[n])])
    const theirs = FW[fw][kind].fields.map(([n, t, s]) => {
      const isByte = (t === 'u8' || t === 'i8') && defs.params[n] && defs.params[n].typeId !== CFG.INT
      return [n, ...(isByte ? ['byte'] : s === undefined ? [t] : [t, s])]
    })
    expect(ours).toEqual(theirs)
  })
})

describe('codec', () => {
  it('rounds halves away from zero like VESC Tool', () => {
    expect([roundDouble(2.5), roundDouble(-2.5), roundDouble(0.29 * 100), roundDouble(-1.4)]).toEqual([3, -3, 29, -1])
  })

  it.each(cases)('%s %s: firmware bytes round-trip byte-for-byte', (fw, kind) => {
    const defs = defsFor(fw, kind)
    const rand = rng(fw.length * 1000 + kind.length)
    for (let i = 0; i < 25; i++) {
      const blob = firmwareBlob(FW[fw][kind], rand)
      const values = decodeConfig(defs, blob)
      expect(toHex(encodeConfig(defs, values))).toBe(toHex(blob))
    }
  })

  it.each(cases)('%s %s: random in-range values round-trip', (fw, kind) => {
    const defs = defsFor(fw, kind)
    const rand = rng(42)
    for (let i = 0; i < 25; i++) {
      const values = randomValues(defs, rand)
      for (const n of defs.order) expect(validateValue(defs.params[n], values[n]), n).toBeNull()
      const bytes = encodeConfig(defs, values)
      const back = decodeConfig(defs, bytes)
      for (const n of defs.order) expect(sameOnWire(defs.params[n], back[n], values[n]), n).toBe(true)
      expect(toHex(encodeConfig(defs, back))).toBe(toHex(bytes))
    }
  })

  it.each(cases)('%s %s: VESC Tool defaults encode and decode', (fw, kind) => {
    const defs = defsFor(fw, kind)
    const values = xmlDefaults(defs)
    const back = decodeConfig(defs, encodeConfig(defs, values))
    for (const n of defs.order) expect(sameOnWire(defs.params[n], back[n], values[n]), n).toBe(true)
  })

  it('rejects a blob from different firmware', () => {
    const a = defsFor('6.06', 'mcconf')
    const b = defsFor('7.00', 'mcconf')
    expect(() => decodeConfig(a, encodeConfig(b, xmlDefaults(b)))).toThrow(SignatureMismatchError)
  })

  it('refuses to encode values the wire cannot carry instead of clamping', () => {
    const defs = defsFor('6.06', 'mcconf')
    const p = defs.params.l_min_vin
    expect(p.txId).toBe(TX.DOUBLE16)
    const values = { ...xmlDefaults(defs), l_min_vin: 40000 / p.scale }
    expect(() => encodeConfig(defs, values)).toThrow(EncodeError)
    expect(() => encodeConfig(defs, { ...xmlDefaults(defs), l_current_max: Number.NaN })).toThrow(EncodeError)
  })

  it('treats values that store identically as equal', () => {
    const defs = defsFor('6.06', 'mcconf')
    const r = defs.params.foc_motor_r
    expect(sameOnWire(r, 0.0118, Math.fround(0.0118))).toBe(true)
    expect(sameOnWire(r, 0.0118, 0.0119)).toBe(false)
    const cut = defs.params.l_battery_cut_start // fixed point, ×10
    expect(sameOnWire(cut, 42.0, 42.04)).toBe(true)
    expect(sameOnWire(cut, 42.0, 42.06)).toBe(false)
  })
})

describe('display', () => {
  const defs = defsFor('6.06', 'mcconf')
  it('scales like VESC Tool', () => {
    const r = defs.params.foc_motor_r
    expect(displaySpec(r).unit).toBe('mΩ')
    expect(toDisplay(r, 0.0118)).toBeCloseTo(11.8)
    expect(fromDisplay(r, 11.8)).toBeCloseTo(0.0118)
    expect(formatValue(r, Math.fround(0.0118))).toBe('11.8 mΩ')
    expect(formatValue(defs.params.si_wheel_diameter, 0.254)).toBe('254 mm')
  })

  it('shows percentage fields relative to their limit', () => {
    const p = defs.params.l_current_max_scale
    expect(p.percent).toBe(true)
    expect(displaySpec(p)).toMatchObject({ unit: '%', min: 0, max: 100 })
    expect(formatValue(p, 0.8)).toBe('80 %')
    expect(fromDisplay(p, 80)).toBeCloseTo(0.8)
  })

  it('names enums, toggles and bit options', () => {
    expect(formatValue(defs.params.motor_type, 2)).toBe(defs.params.motor_type.enums[2])
    const bits = defs.params.foc_offsets_cal_mode
    expect(formatValue(bits, 0)).toBe('None')
    expect(formatValue(bits, 0b11)).toBe(bits.enums.slice(0, 2).join(', '))
  })
})

describe('validation', () => {
  const defs = defsFor('6.06', 'mcconf')
  const base = xmlDefaults(defs)

  it('rejects out-of-range and wrong-type values with a reason', () => {
    const p = defs.params.l_current_max
    expect(validateValue(p, p.max + 1)).toMatch(/between/)
    expect(validateValue(p, p.max)).toBeNull()
    expect(validateValue(defs.params.si_motor_poles, 14.5)).toMatch(/whole/)
    expect(validateValue(defs.params.motor_type, 99)).toMatch(/options/)
    expect(validateValue(defs.params.m_invert_direction, 2)).toMatch(/on or off/)
    expect(validateValue(p, Number.NaN)).toMatch(/number/)
  })

  it('blocks a write that breaks a cross-field rule the user touched', () => {
    const issues = validateConfig(defs, { ...base, l_battery_cut_end: 50, l_battery_cut_start: 40 }, { base })
    expect(hasErrors(issues)).toBe(true)
    expect(issues.find((i) => i.param === 'l_battery_cut_start')?.message).toMatch(/below/)
  })

  it('only warns about values already on the controller', () => {
    const odd = { ...base, l_current_max: defs.params.l_current_max.max + 50 }
    const issues = validateConfig(defs, odd, { base: odd })
    expect(issues.find((i) => i.param === 'l_current_max')?.level).toBe('warning')
    expect(hasErrors(validateConfig(defs, odd, { base }))).toBe(true)
  })
})

describe('registry', () => {
  it('loads definitions lazily and matches signatures', async () => {
    const defs = await loadDefs('6.06', 'mcconf')
    expect(defs?.order.length).toBe(200)
    expect(loadDefs('9.99', 'mcconf')).toBeNull()

    const ok = await resolveDefs({ major: 6, minor: 6 }, 'mcconf', FW['6.06'].mcconf.signature)
    expect(ok.status).toBe('ok')
  })

  it('shows an unknown version read-only when its layout matches a known one', async () => {
    // 6.05 and 6.06 share the appconf layout
    const r = await resolveDefs({ major: 6, minor: 4 }, 'appconf', FW['6.06'].appconf.signature)
    expect(r.status).toBe('readonly')
    const bad = await resolveDefs({ major: 6, minor: 6 }, 'mcconf', 12345)
    expect(bad.status).toBe('unsupported')
  })
})

describe('VESC Tool XML files', () => {
  it.each(cases)('%s %s: export then import gives the same config', (fw, kind) => {
    const defs = defsFor(fw, kind)
    const values = randomValues(defs, rng(7))
    const xml = exportConfigXml(defs, values)
    expect(detectKind(xml)).toBe(kind)
    const back = importConfigXml(defs, xml)
    expect(back.configVersion).toBe(4)
    expect(back.unknown).toEqual([])
    expect(back.missing).toEqual([])
    for (const n of defs.order) expect(sameOnWire(defs.params[n], back.values[n], values[n]), n).toBe(true)
  })

  it('reads a VESC Tool style file and reports what it skipped', () => {
    const defs = defsFor('6.06', 'mcconf')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MCConfiguration>
    <ConfigVersion>4</ConfigVersion>
    <motor_brand>Flipsky</motor_brand>
    <l_current_max>60</l_current_max>
    <si_motor_poles>14.5</si_motor_poles>
    <l_max_erpm>1e+06</l_max_erpm>
    <foc_motor_r>0.0118</foc_motor_r>
    <m_invert_direction>1</m_invert_direction>
</MCConfiguration>`
    const r = importConfigXml(defs, xml)
    expect(r.unknown).toEqual(['motor_brand'])
    expect(r.values).toMatchObject({ l_current_max: 60, foc_motor_r: 0.0118, m_invert_direction: 1 })
    expect(r.values.l_max_erpm).toBe(1e6)
    expect(r.invalid).toEqual([{ name: 'si_motor_poles', text: '14.5', reason: '"14.5" is not a whole number' }])
    expect(r.missing.length).toBe(defs.order.length - Object.keys(r.values).length - r.invalid.length)
  })

  it('refuses a motor file when importing app settings', () => {
    const defs = defsFor('6.06', 'appconf')
    expect(() => importConfigXml(defs, '<MCConfiguration><ConfigVersion>4</ConfigVersion></MCConfiguration>')).toThrow(/motor configuration file/)
  })
})

describe('plain-language help', () => {
  it('only describes settings that exist in 6.06', async () => {
    const { CURATED, optionLabel } = await import('./help')
    const known = new Set([...defsFor('6.06', 'mcconf').order, ...defsFor('6.06', 'appconf').order])
    expect(Object.keys(CURATED).filter((n) => !known.has(n))).toEqual([])
    expect(optionLabel('si_battery_type', 1, 'BATTERY_TYPE_LIIRON_2_6__3_6')).toMatch(/LiFePO4/)
    expect(optionLabel('x', 0, 'SOME_C_NAME')).toBe('Some c name')
    expect(optionLabel('x', 0, 'Current')).toBe('Current')
  })
})
