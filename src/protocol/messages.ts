// Encoders/decoders for individual messages. Layouts follow bldc comm/commands.c.
// Decoders take a reader positioned just after the packet ID byte.

import { BufferReader, BufferWriter, toHex } from './buffer'
import { COMM } from './commands'

// ---------------------------------------------------------------- FW_VERSION

export interface FwVersion {
  major: number
  minor: number
  hwName: string
  uuid: string
  pairingDone: boolean
  testVersion: number
  hwType: number
  customConfigCount: number
  hasPhaseFilters: boolean
  qmlHw: number
  qmlApp: number
  nrfFlags: number
  fwName: string
  hwCrc: number | null
}

export function decodeFwVersion(r: BufferReader): FwVersion {
  const fw: FwVersion = {
    major: r.u8(),
    minor: r.u8(),
    hwName: r.cstring(),
    uuid: '',
    pairingDone: false,
    testVersion: 0,
    hwType: 0,
    customConfigCount: 0,
    hasPhaseFilters: false,
    qmlHw: 0,
    qmlApp: 0,
    nrfFlags: 0,
    fwName: '',
    hwCrc: null,
  }
  // Older firmware sends fewer fields; read what is there.
  if (r.has(12)) fw.uuid = toHex(r.bytes(12))
  if (r.has(1)) fw.pairingDone = r.u8() !== 0
  if (r.has(1)) fw.testVersion = r.u8()
  if (r.has(1)) fw.hwType = r.u8()
  if (r.has(1)) fw.customConfigCount = r.u8()
  if (r.has(1)) fw.hasPhaseFilters = r.u8() !== 0
  if (r.has(1)) fw.qmlHw = r.u8()
  if (r.has(1)) fw.qmlApp = r.u8()
  if (r.has(1)) fw.nrfFlags = r.u8()
  if (r.has(1)) {
    try {
      fw.fwName = r.cstring()
    } catch {
      return fw
    }
  }
  if (r.has(4)) fw.hwCrc = r.u32()
  return fw
}

export function encodeFwVersion(fw: FwVersion): Uint8Array {
  const w = new BufferWriter().u8(COMM.FW_VERSION).u8(fw.major).u8(fw.minor).cstring(fw.hwName)
  const uuid = fw.uuid.padEnd(24, '0').slice(0, 24)
  for (let i = 0; i < 12; i++) w.u8(parseInt(uuid.slice(i * 2, i * 2 + 2), 16))
  w.u8(fw.pairingDone ? 1 : 0)
    .u8(fw.testVersion)
    .u8(fw.hwType)
    .u8(fw.customConfigCount)
    .u8(fw.hasPhaseFilters ? 1 : 0)
    .u8(fw.qmlHw)
    .u8(fw.qmlApp)
    .u8(fw.nrfFlags)
    .cstring(fw.fwName)
    .u32(fw.hwCrc ?? 0)
  return w.toUint8Array()
}

export function fwVersionString(fw: Pick<FwVersion, 'major' | 'minor' | 'testVersion'>): string {
  return `${fw.major}.${String(fw.minor).padStart(2, '0')}${fw.testVersion ? ` beta ${fw.testVersion}` : ''}`
}

// ---------------------------------------------------------------- GET_VALUES

export interface Values {
  tempFet: number // °C
  tempMotor: number // °C
  currentMotor: number // A (average since last read)
  currentIn: number // A, battery side
  id: number // A
  iq: number // A
  dutyNow: number // -1..1
  rpm: number // electrical RPM (ERPM)
  vIn: number // V
  ampHours: number
  ampHoursCharged: number
  wattHours: number
  wattHoursCharged: number
  tachometer: number
  tachometerAbs: number
  fault: number
  pidPos: number // degrees
  controllerId: number
  tempMos1: number
  tempMos2: number
  tempMos3: number
  vd: number
  vq: number
  status: number // bit0 = input timeout, bit1 = kill switch active
}

// One entry per mask bit, in firmware order.
type FieldCodec = {
  read: (r: BufferReader, v: Values) => void
  write: (w: BufferWriter, v: Values) => void
  size: number
}

const FIELDS: FieldCodec[] = [
  { size: 2, read: (r, v) => (v.tempFet = r.f16(1e1)), write: (w, v) => w.f16(v.tempFet, 1e1) },
  { size: 2, read: (r, v) => (v.tempMotor = r.f16(1e1)), write: (w, v) => w.f16(v.tempMotor, 1e1) },
  { size: 4, read: (r, v) => (v.currentMotor = r.f32(1e2)), write: (w, v) => w.f32(v.currentMotor, 1e2) },
  { size: 4, read: (r, v) => (v.currentIn = r.f32(1e2)), write: (w, v) => w.f32(v.currentIn, 1e2) },
  { size: 4, read: (r, v) => (v.id = r.f32(1e2)), write: (w, v) => w.f32(v.id, 1e2) },
  { size: 4, read: (r, v) => (v.iq = r.f32(1e2)), write: (w, v) => w.f32(v.iq, 1e2) },
  { size: 2, read: (r, v) => (v.dutyNow = r.f16(1e3)), write: (w, v) => w.f16(v.dutyNow, 1e3) },
  { size: 4, read: (r, v) => (v.rpm = r.f32(1e0)), write: (w, v) => w.f32(v.rpm, 1e0) },
  { size: 2, read: (r, v) => (v.vIn = r.f16(1e1)), write: (w, v) => w.f16(v.vIn, 1e1) },
  { size: 4, read: (r, v) => (v.ampHours = r.f32(1e4)), write: (w, v) => w.f32(v.ampHours, 1e4) },
  { size: 4, read: (r, v) => (v.ampHoursCharged = r.f32(1e4)), write: (w, v) => w.f32(v.ampHoursCharged, 1e4) },
  { size: 4, read: (r, v) => (v.wattHours = r.f32(1e4)), write: (w, v) => w.f32(v.wattHours, 1e4) },
  { size: 4, read: (r, v) => (v.wattHoursCharged = r.f32(1e4)), write: (w, v) => w.f32(v.wattHoursCharged, 1e4) },
  { size: 4, read: (r, v) => (v.tachometer = r.i32()), write: (w, v) => w.i32(v.tachometer) },
  { size: 4, read: (r, v) => (v.tachometerAbs = r.i32()), write: (w, v) => w.i32(v.tachometerAbs) },
  { size: 1, read: (r, v) => (v.fault = r.u8()), write: (w, v) => w.u8(v.fault) },
  { size: 4, read: (r, v) => (v.pidPos = r.f32(1e6)), write: (w, v) => w.f32(v.pidPos, 1e6) },
  { size: 1, read: (r, v) => (v.controllerId = r.u8()), write: (w, v) => w.u8(v.controllerId) },
  {
    size: 6,
    read: (r, v) => {
      v.tempMos1 = r.f16(1e1)
      v.tempMos2 = r.f16(1e1)
      v.tempMos3 = r.f16(1e1)
    },
    write: (w, v) => w.f16(v.tempMos1, 1e1).f16(v.tempMos2, 1e1).f16(v.tempMos3, 1e1),
  },
  { size: 4, read: (r, v) => (v.vd = r.f32(1e3)), write: (w, v) => w.f32(v.vd, 1e3) },
  { size: 4, read: (r, v) => (v.vq = r.f32(1e3)), write: (w, v) => w.f32(v.vq, 1e3) },
  { size: 1, read: (r, v) => (v.status = r.u8()), write: (w, v) => w.u8(v.status) },
]

export const VALUES_FIELD_COUNT = FIELDS.length
export const ALL_VALUES_MASK = 0xffffffff

export function emptyValues(): Values {
  return {
    tempFet: 0, tempMotor: 0, currentMotor: 0, currentIn: 0, id: 0, iq: 0, dutyNow: 0, rpm: 0, vIn: 0,
    ampHours: 0, ampHoursCharged: 0, wattHours: 0, wattHoursCharged: 0, tachometer: 0, tachometerAbs: 0,
    fault: 0, pidPos: 0, controllerId: 0, tempMos1: 0, tempMos2: 0, tempMos3: 0, vd: 0, vq: 0, status: 0,
  }
}

/** Decodes the fields present in `mask`. Stops quietly if older firmware sends fewer fields. */
function decodeFields(r: BufferReader, mask: number): Values {
  const v = emptyValues()
  for (let bit = 0; bit < FIELDS.length; bit++) {
    if (!(mask & (1 << bit))) continue
    const f = FIELDS[bit]
    if (!r.has(f.size)) break
    f.read(r, v)
  }
  return v
}

/** Reply to COMM_GET_VALUES (no mask in the reply). */
export function decodeValues(r: BufferReader): Values {
  return decodeFields(r, ALL_VALUES_MASK)
}

/** Reply to COMM_GET_VALUES_SELECTIVE: the mask is echoed first. */
export function decodeValuesSelective(r: BufferReader): { mask: number; values: Values } {
  const mask = r.u32()
  return { mask, values: decodeFields(r, mask) }
}

export function encodeValues(v: Values): Uint8Array {
  const w = new BufferWriter().u8(COMM.GET_VALUES)
  for (const f of FIELDS) f.write(w, v)
  return w.toUint8Array()
}

export function encodeValuesSelective(v: Values, mask: number): Uint8Array {
  const w = new BufferWriter().u8(COMM.GET_VALUES_SELECTIVE).u32(mask)
  FIELDS.forEach((f, bit) => {
    if (mask & (1 << bit)) f.write(w, v)
  })
  return w.toUint8Array()
}

// ---------------------------------------------------------------- PING_CAN

/** Reply: one byte per CAN ID that answered. */
export function decodePingCan(r: BufferReader): number[] {
  const ids: number[] = []
  while (r.has(1)) ids.push(r.u8())
  return ids
}
