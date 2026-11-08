// Reads and writes config blobs exactly like VESC Tool (ConfigParams::serialize /
// deSerialize), which is what the firmware's confgenerator.c expects:
// u32 signature, then every field in SerOrder.

import { BufferReader, BufferWriter } from '../protocol/buffer'
import { CFG, TX, type ConfigDefs, type ConfigValue, type ConfigValues, type ParamDef } from './types'

export class SignatureMismatchError extends Error {
  readonly expected: number
  readonly got: number
  constructor(expected: number, got: number) {
    super(`Config signature ${got} does not match the definitions (${expected})`)
    this.name = 'SignatureMismatchError'
    this.expected = expected
    this.got = got
  }
}

export class EncodeError extends Error {
  readonly param: string
  constructor(param: string, message: string) {
    super(`${param}: ${message}`)
    this.name = 'EncodeError'
    this.param = param
  }
}

/** VESC Tool's roundDouble: halves away from zero. */
export function roundDouble(x: number): number {
  return x < 0 ? Math.ceil(x - 0.5) : Math.floor(x + 0.5)
}

const INT_RANGES: Record<number, [number, number]> = {
  [TX.UINT8]: [0, 0xff],
  [TX.INT8]: [-0x80, 0x7f],
  [TX.UINT16]: [0, 0xffff],
  [TX.INT16]: [-0x8000, 0x7fff],
  [TX.UINT32]: [0, 0xffffffff],
  [TX.INT32]: [-0x80000000, 0x7fffffff],
  [TX.DOUBLE16]: [-0x8000, 0x7fff],
  [TX.DOUBLE32]: [-0x80000000, 0x7fffffff],
}

/** The integer that goes on the wire for scaled and integer fields, or null for floats and strings. */
export function wireInt(p: ParamDef, v: number): number | null {
  if (p.typeId === CFG.DOUBLE) {
    if (p.txId === TX.DOUBLE16 || p.txId === TX.DOUBLE32) return roundDouble(v * p.scale)
    return null
  }
  if (p.typeId === CFG.STRING) return null
  return v
}

/** Range the wire format can carry for this field, as wire integers. */
export function wireRange(p: ParamDef): [number, number] | null {
  if (p.typeId === CFG.ENUM || p.typeId === CFG.BOOL) return INT_RANGES[TX.INT8]
  if (p.typeId === CFG.BITFIELD) return INT_RANGES[TX.UINT8]
  return INT_RANGES[p.txId] ?? null
}

/**
 * Value as the controller will hold it once written: float32 precision for floats,
 * the fixed-point grid for scaled fields. Two values that quantize the same are
 * the same setting.
 */
export function quantize(p: ParamDef, v: ConfigValue): ConfigValue {
  if (typeof v !== 'number') return v
  if (p.typeId === CFG.DOUBLE) {
    if (p.txId === TX.DOUBLE32_AUTO) return Math.abs(v) < 1.5e-38 ? 0 : Math.fround(v)
    const i = wireInt(p, v)
    return i === null ? v : i / p.scale
  }
  return v
}

/** True when both values put the same bytes on the wire. */
export function sameOnWire(p: ParamDef, a: ConfigValue | undefined, b: ConfigValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a === 'string') return a === b
  return quantize(p, a) === quantize(p, b)
}

function readField(r: BufferReader, p: ParamDef): ConfigValue {
  switch (p.typeId) {
    case CFG.DOUBLE:
      switch (p.txId) {
        case TX.DOUBLE16:
          return r.i16() / p.scale
        case TX.DOUBLE32:
          return r.i32() / p.scale
        case TX.DOUBLE32_AUTO:
          return r.f32auto()
      }
      break
    case CFG.INT:
      switch (p.txId) {
        case TX.UINT8:
          return r.u8()
        case TX.INT8:
          return r.i8()
        case TX.UINT16:
          return r.u16()
        case TX.INT16:
          return r.i16()
        case TX.UINT32:
          return r.u32()
        case TX.INT32:
          return r.i32()
      }
      break
    case CFG.STRING:
      return r.cstring()
    case CFG.ENUM:
    case CFG.BOOL:
      return r.i8()
    case CFG.BITFIELD:
      return r.u8()
  }
  throw new Error(`${p.name}: unsupported type ${p.typeId}/${p.txId}`)
}

/** Decodes a GET_MCCONF / GET_APPCONF body (after the command id). */
export function decodeConfig(defs: ConfigDefs, input: BufferReader | Uint8Array): ConfigValues {
  const r = input instanceof BufferReader ? input : new BufferReader(input)
  const sig = r.u32()
  if (sig !== defs.signature) throw new SignatureMismatchError(defs.signature, sig)
  const out: ConfigValues = {}
  for (const name of defs.order) out[name] = readField(r, defs.params[name])
  return out
}

/** Reads just the signature from a config body, without decoding the rest. */
export function peekSignature(body: Uint8Array): number {
  return new BufferReader(body).u32()
}

function writeField(w: BufferWriter, p: ParamDef, v: ConfigValue | undefined) {
  if (v === undefined) throw new EncodeError(p.name, 'missing value')
  if (p.typeId === CFG.STRING) {
    if (typeof v !== 'string') throw new EncodeError(p.name, 'expected text')
    w.cstring(v)
    return
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EncodeError(p.name, 'expected a number')

  if (p.typeId === CFG.DOUBLE && p.txId === TX.DOUBLE32_AUTO) {
    if (Math.abs(v) > 3.4028234663852886e38) throw new EncodeError(p.name, 'too large for a float')
    w.f32auto(v)
    return
  }

  const i = wireInt(p, v)!
  if (!Number.isInteger(i)) throw new EncodeError(p.name, 'expected a whole number')
  const range = wireRange(p)
  if (!range) throw new EncodeError(p.name, `unsupported type ${p.typeId}/${p.txId}`)
  // Never clamp: a value the wire can't carry is a bug upstream (validation should have caught it).
  if (i < range[0] || i > range[1]) throw new EncodeError(p.name, `${v} does not fit the controller's storage`)

  switch (p.typeId === CFG.DOUBLE ? p.txId : p.typeId === CFG.INT ? p.txId : TX.INT8) {
    case TX.UINT8:
    case TX.INT8:
      w.u8(i)
      return
    case TX.UINT16:
    case TX.INT16:
    case TX.DOUBLE16:
      w.i16(i)
      return
    case TX.UINT32:
      w.u32(i)
      return
    case TX.INT32:
    case TX.DOUBLE32:
      w.i32(i)
      return
  }
  throw new EncodeError(p.name, `unsupported type ${p.typeId}/${p.txId}`)
}

/** Builds a SET_MCCONF / SET_APPCONF body (without the command id). */
export function encodeConfig(defs: ConfigDefs, values: ConfigValues): Uint8Array {
  const w = new BufferWriter().u32(defs.signature)
  for (const name of defs.order) writeField(w, defs.params[name], values[name])
  return w.toUint8Array()
}

/** VESC Tool's own defaults from the XML. The controller's defaults can differ per hardware. */
export function xmlDefaults(defs: ConfigDefs): ConfigValues {
  const out: ConfigValues = {}
  for (const name of defs.order) out[name] = defs.params[name].def
  return out
}
