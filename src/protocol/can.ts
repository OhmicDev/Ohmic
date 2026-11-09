// Raw CAN frames through the controller (bldc comm/commands.c, comm_can.c).
//
// COMM_CAN_FWD_FRAME [u32 id][u8 extended][data ≤ 8] sends a frame on the bus.
// In "comm bridge" CAN mode the controller also sends every frame it receives to
// the app the same way, but then stops handling VESC CAN traffic itself.
// COMM_SET_CAN_MODE [u8 store][u8 ack][u8 mode] changes the mode, in RAM when store is 0.
//
// VESC's own frames use 29-bit ids: (packet type << 8) | sender's controller id.

import { BufferReader, BufferWriter } from './buffer'

export const CAN_MODE = { VESC: 0, UAVCAN: 1, COMM_BRIDGE: 2, UNUSED: 3, VESC_UAVCAN: 4 } as const

export interface CanFrame {
  id: number
  extended: boolean
  data: Uint8Array
}

export function encodeCanFrame(f: CanFrame): Uint8Array {
  return new BufferWriter().u32(f.id).u8(f.extended ? 1 : 0).raw(f.data).toUint8Array()
}

export function decodeCanFrame(r: BufferReader): CanFrame {
  const id = r.u32()
  const extended = r.u8() !== 0
  return { id, extended, data: r.rest().slice(0, 8) }
}

export function encodeSetCanMode(mode: number, store: boolean, ack: boolean): Uint8Array {
  return Uint8Array.of(store ? 1 : 0, ack ? 1 : 0, mode)
}

/** VESC CAN packet types (CAN_PACKET_ID in datatypes.h) the monitor names. */
const CAN_PACKET: Record<number, string> = {
  0: 'SET_DUTY',
  1: 'SET_CURRENT',
  2: 'SET_CURRENT_BRAKE',
  3: 'SET_RPM',
  4: 'SET_POS',
  5: 'FILL_RX_BUFFER',
  6: 'FILL_RX_BUFFER_LONG',
  7: 'PROCESS_RX_BUFFER',
  8: 'PROCESS_SHORT_BUFFER',
  9: 'STATUS',
  10: 'SET_CURRENT_REL',
  11: 'SET_CURRENT_BRAKE_REL',
  12: 'SET_CURRENT_HANDBRAKE',
  13: 'SET_CURRENT_HANDBRAKE_REL',
  14: 'STATUS_2',
  15: 'STATUS_3',
  16: 'STATUS_4',
  17: 'PING',
  18: 'PONG',
  19: 'DETECT_APPLY_ALL_FOC',
  20: 'DETECT_APPLY_ALL_FOC_RES',
  21: 'CONF_CURRENT_LIMITS',
  22: 'CONF_STORE_CURRENT_LIMITS',
  23: 'CONF_CURRENT_LIMITS_IN',
  24: 'CONF_STORE_CURRENT_LIMITS_IN',
  25: 'CONF_FOC_ERPMS',
  26: 'CONF_STORE_FOC_ERPMS',
  27: 'STATUS_5',
  29: 'CONF_BATTERY_CUT',
  30: 'CONF_STORE_BATTERY_CUT',
  31: 'SHUTDOWN',
  38: 'BMS_V_TOT',
  39: 'BMS_I',
  40: 'BMS_AH_WH',
  41: 'BMS_V_CELL',
  42: 'BMS_BAL',
  43: 'BMS_TEMPS',
  44: 'BMS_HUM',
  45: 'BMS_SOC_SOH_TEMP_STAT',
  46: 'PSW_STAT',
  47: 'PSW_SWITCH',
  57: 'NOTIFY_BOOT',
  58: 'STATUS_6',
  59: 'GNSS_TIME',
  60: 'GNSS_LAT',
  61: 'GNSS_LON',
  62: 'GNSS_ALT_SPEED_HDOP',
  63: 'UPDATE_BAUD',
}

/** Packet types that make a motor do something. Sending these by hand needs a confirmation. */
export const MOTOR_COMMAND_PACKETS = new Set([0, 1, 2, 3, 4, 10, 11, 12, 13, 19, 31])

/**
 * Packet types that change a controller's settings or the bus itself (current limits, ERPM limits,
 * battery cut-off, power switch, bus speed). By hand they'd skip the review, backup and read-back.
 */
export const SETTING_PACKETS = new Set([21, 22, 23, 24, 25, 26, 29, 30, 47, 63])

export interface VescCanInfo {
  sender: number
  type: number
  name: string | null
  /** Plain-language reading of the status messages. */
  text: string | null
}

/** Reads a frame as VESC CAN traffic. Null for 11-bit frames, which VESC doesn't use. */
export function describeVescFrame(f: CanFrame): VescCanInfo | null {
  if (!f.extended) return null
  const sender = f.id & 0xff
  const type = (f.id >>> 8) & 0xffff
  const name = CAN_PACKET[type] ?? null
  let text: string | null = null
  const r = new BufferReader(f.data)
  try {
    switch (type) {
      case 9:
        text = `${r.i32()} ERPM · ${(r.i16() / 10).toFixed(1)} A · duty ${((r.i16() / 1000) * 100).toFixed(1)} %`
        break
      case 14:
        text = `${(r.i32() / 1e4).toFixed(3)} Ah used · ${(r.i32() / 1e4).toFixed(3)} Ah charged`
        break
      case 15:
        text = `${(r.i32() / 1e4).toFixed(2)} Wh used · ${(r.i32() / 1e4).toFixed(2)} Wh charged`
        break
      case 16:
        text = `MOSFET ${(r.i16() / 10).toFixed(1)} °C · motor ${(r.i16() / 10).toFixed(1)} °C · battery ${(r.i16() / 10).toFixed(1)} A`
        break
      case 27:
        text = `tacho ${r.i32()} · ${(r.i16() / 10).toFixed(1)} V`
        break
      case 18:
        text = 'answer to a ping'
        break
      case 17:
        text = 'ping'
        break
    }
  } catch {
    text = null
  }
  return { sender, type, name, text }
}

/** "1a2b" or "1a 2b" or "0x1a,0x2b" → bytes. Null if it isn't hex, or more than 8 bytes. */
export function parseHexBytes(text: string): Uint8Array | null {
  const clean = text.trim().replace(/0x/gi, '').replace(/[\s,:]+/g, ' ')
  if (!clean) return new Uint8Array()
  const parts = clean.includes(' ') ? clean.split(' ') : (clean.match(/.{1,2}/g) ?? [])
  if (parts.some((p) => !/^[0-9a-f]{1,2}$/i.test(p))) return null
  if (parts.length > 8) return null
  return Uint8Array.from(parts.map((p) => parseInt(p, 16)))
}

/** "0x0901" or "2305" → a CAN id, null if it doesn't fit the frame type. */
export function parseCanId(text: string, extended: boolean): number | null {
  const t = text.trim()
  if (!t) return null
  const n = /^0x[0-9a-f]+$/i.test(t) ? parseInt(t.slice(2), 16) : /^\d+$/.test(t) ? Number(t) : NaN
  if (!Number.isInteger(n) || n < 0) return null
  return n <= (extended ? 0x1fffffff : 0x7ff) ? n : null
}
