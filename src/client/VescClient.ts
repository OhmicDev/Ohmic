// Typed command layer over a Transport.
//
// Requests run one at a time: a reply doesn't say which CAN device it came
// from, so overlapping requests could be matched to the wrong one. Jobs are
// queued by priority so user actions never wait behind telemetry polling.

import type { ConfigKind } from '../config/types'
import { BufferReader, BufferWriter } from '../protocol/buffer'
import { COMM, commandName } from '../protocol/commands'
import { decodeWriteReply, encodeEraseNewApp, encodeWriteNewAppData } from '../protocol/firmware'
import { decodeFwVersion, decodePingCan, decodeValues, type FwVersion, type Values } from '../protocol/messages'
import { decodeBmsValues, type BmsValues } from '../protocol/bms'
import { decodeCanFrame, encodeCanFrame, encodeSetCanMode, type CanFrame } from '../protocol/can'
import { decodeCustomXmlChunk, encodeCustomIndex, encodeCustomXmlRequest } from '../protocol/customConfig'
import { decodeImu, decodeImuCalibration, encodeImuCalibrationRequest, encodeImuRequest, IMU_MASK_MOTION, type ImuCalibration, type ImuData } from '../protocol/imu'
import {
  decodeLispReadReply,
  decodeLispStats,
  decodeLispWriteReply,
  encodeLispErase,
  encodeLispRead,
  encodeLispRunning,
  encodeLispWrite,
  type LispStats,
} from '../protocol/lisp'
import { encodePacket, PacketDecoder } from '../protocol/packet'
import {
  decodeDecodedAdc,
  decodeDecodedPpm,
  decodeTempLimits,
  encodeDetectArgs,
  encodeReplCmd,
  encodeSetCurrent,
  encodeSetDuty,
  encodeSetHandbrake,
  encodeSetPos,
  encodeSetRpm,
  encodeTempLimits,
  type DecodedAdc,
  type DecodedPpm,
  type DetectArgs,
  type TempLimits,
} from '../protocol/setup'
import { decodePrint, encodeTerminalCmd } from '../protocol/terminal'
import { Emitter, type Transport } from '../transport/types'

export type Target = 'local' | number

type Priority = 'high' | 'normal' | 'low'

interface RequestOptions {
  target?: Target
  timeoutMs?: number
  retries?: number
  priority?: Priority
}

export class TimeoutError extends Error {
  constructor(command: number, target: Target) {
    super(`No reply to ${commandName(command)}${target === 'local' ? '' : ` from CAN ${target}`}`)
    this.name = 'TimeoutError'
  }
}

/** The controller refused a config write because its layout differs (it prints a warning instead of replying). */
export class ConfigRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigRejectedError'
  }
}

const CONFIG_CMDS: Record<ConfigKind, { get: number; getDefault: number; set: number }> = {
  mcconf: { get: COMM.GET_MCCONF, getDefault: COMM.GET_MCCONF_DEFAULT, set: COMM.SET_MCCONF },
  appconf: { get: COMM.GET_APPCONF, getDefault: COMM.GET_APPCONF_DEFAULT, set: COMM.SET_APPCONF },
}

export class ClosedError extends Error {
  constructor() {
    super('Connection closed')
    this.name = 'ClosedError'
  }
}

interface Job {
  command: number
  payload: Uint8Array
  target: Target
  timeoutMs: number
  retriesLeft: number
  priority: number
  resolve: (r: BufferReader) => void
  reject: (e: Error) => void
}

const PRIORITY: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
const TIMEOUT_COOLDOWN_MS = 120

/** What the protocol log sees: every payload out and in, and requests that went unanswered. */
type ProtocolTap = (dir: 'tx' | 'rx' | 'timeout', payload: Uint8Array) => void

let tap: ProtocolTap | null = null

/** Watches all traffic (the developer protocol log). Null turns it off; nothing is recorded then. */
export function setProtocolTap(fn: ProtocolTap | null) {
  tap = fn
}

export class VescClient {
  readonly transport: Transport
  private readonly decoder: PacketDecoder
  private readonly unsolicited = new Emitter<Uint8Array>()
  private readonly offData: () => void
  private queue: Job[] = []
  private inflight: Job | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private cooldownUntil = 0
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(transport: Transport) {
    this.transport = transport
    this.decoder = new PacketDecoder((p) => this.onPacket(p))
    this.offData = transport.onData((bytes) => this.decoder.push(bytes))
  }

  /** Packets nobody asked for (prints, LispBM output, detection progress...). */
  private onUnsolicited(cb: (payload: Uint8Array) => void) {
    return this.unsolicited.on(cb)
  }

  /** Sends a command and resolves with a reader positioned after the reply's ID byte. */
  request(command: number, body: Uint8Array = new Uint8Array(), opts: RequestOptions = {}): Promise<BufferReader> {
    if (this.closed) return Promise.reject(new ClosedError())
    const target = opts.target ?? 'local'
    return new Promise((resolve, reject) => {
      const job: Job = {
        command,
        payload: frameFor(command, body, target),
        target,
        timeoutMs: opts.timeoutMs ?? 600,
        retriesLeft: opts.retries ?? 2,
        priority: PRIORITY[opts.priority ?? 'normal'],
        resolve,
        reject,
      }
      // Insert after jobs of the same or higher priority.
      const at = this.queue.findIndex((j) => j.priority > job.priority)
      if (at === -1) this.queue.push(job)
      else this.queue.splice(at, 0, job)
      this.pump()
    })
  }

  /** Fire-and-forget command (no reply expected), e.g. keep-alive. */
  async send(command: number, body: Uint8Array = new Uint8Array(), target: Target = 'local') {
    if (this.closed) throw new ClosedError()
    const payload = frameFor(command, body, target)
    tap?.('tx', payload)
    await this.transport.write(encodePacket(payload))
  }

  async getFwVersion(opts?: RequestOptions): Promise<FwVersion> {
    return decodeFwVersion(await this.request(COMM.FW_VERSION, undefined, { retries: 3, ...opts }))
  }

  async getValues(opts?: RequestOptions): Promise<Values> {
    return decodeValues(await this.request(COMM.GET_VALUES, undefined, opts))
  }

  /** IDs of other devices on the CAN bus. The firmware scans all IDs, so allow time. */
  async pingCan(opts?: RequestOptions): Promise<number[]> {
    return decodePingCan(await this.request(COMM.PING_CAN, undefined, { timeoutMs: 3000, retries: 0, ...opts }))
  }

  /** Raw config body as the controller sent it: u32 signature, then the fields. */
  async getConfig(kind: ConfigKind, opts: RequestOptions & { defaults?: boolean } = {}): Promise<Uint8Array> {
    const { defaults, ...rest } = opts
    const cmd = defaults ? CONFIG_CMDS[kind].getDefault : CONFIG_CMDS[kind].get
    // A few hundred bytes; over BLE and CAN that's many small chunks.
    const r = await this.request(cmd, undefined, { timeoutMs: 2000, retries: 2, ...rest })
    return r.rest()
  }

  /**
   * Writes a config body (signature + fields). The controller stores it to flash
   * and replies with just the command id. If the layout doesn't match it prints a
   * warning and never replies, so watch for that instead of waiting out the timeout.
   * Not retried: a lost reply is settled by reading the config back.
   */
  async setConfig(kind: ConfigKind, body: Uint8Array, opts: RequestOptions = {}): Promise<void> {
    let off = () => {}
    const rejected = new Promise<never>((_, reject) => {
      off = this.onUnsolicited((p) => {
        if (p[0] !== COMM.PRINT) return
        const text = new TextDecoder().decode(p.subarray(1))
        if (/could not set (mc|app)conf/i.test(text)) reject(new ConfigRejectedError(text.replace(/^warning:\s*/i, '').trim()))
      })
    })
    try {
      await Promise.race([this.request(CONFIG_CMDS[kind].set, body, { timeoutMs: 4000, retries: 0, priority: 'high', ...opts }), rejected])
    } finally {
      off()
    }
  }

  /** Angles, acceleration and rotation from the controller's IMU. */
  async getImu(opts: RequestOptions & { mask?: number } = {}): Promise<ImuData> {
    const { mask = IMU_MASK_MOTION, ...rest } = opts
    return decodeImu(await this.request(COMM.GET_IMU_DATA, encodeImuRequest(mask), rest)).data
  }

  /**
   * Sends a terminal command. There's no reply: the output arrives as COMM_PRINT
   * packets (see onPrint). The firmware runs one terminal command at a time and
   * drops any that arrive while another is still running.
   */
  terminal(line: string, target: Target = 'local') {
    return this.send(COMM.TERMINAL_CMD, encodeTerminalCmd(line), target)
  }

  /** Text the firmware prints: terminal output and warnings. */
  onPrint(cb: (text: string) => void) {
    return this.onUnsolicited((p) => {
      if (p[0] === COMM.PRINT) cb(decodePrint(p.subarray(1)))
    })
  }

  sendAlive(target: Target = 'local') {
    return this.send(COMM.ALIVE, undefined, target)
  }

  /** The live (possibly temporary) limits. */
  async getTempLimits(opts?: RequestOptions) {
    return decodeTempLimits(await this.request(COMM.GET_MCCONF_TEMP, undefined, opts))
  }

  /** Changes the live limits without saving them; the controller confirms with a one-byte reply. */
  async setTempLimits(limits: TempLimits, opts?: RequestOptions) {
    await this.request(COMM.SET_MCCONF_TEMP, encodeTempLimits(limits, { ack: true }), opts)
  }

  async getDecodedAdc(opts?: RequestOptions): Promise<DecodedAdc> {
    return decodeDecodedAdc(await this.request(COMM.GET_DECODED_ADC, undefined, opts))
  }

  async getDecodedPpm(opts?: RequestOptions): Promise<DecodedPpm> {
    return decodeDecodedPpm(await this.request(COMM.GET_DECODED_PPM, undefined, opts))
  }

  /** Holds an electrical RPM until the next command or the controller's timeout (about a second). */
  setRpm(erpm: number, target: Target = 'local') {
    return this.send(COMM.SET_RPM, encodeSetRpm(erpm), target)
  }

  /** Sets motor current; 0 lets the motor coast. */
  setCurrent(amps: number, target: Target = 'local') {
    return this.send(COMM.SET_CURRENT, encodeSetCurrent(amps), target)
  }

  /** Brakes the motor with this current (A, positive). Limited by the controller's braking settings. */
  setCurrentBrake(amps: number, target: Target = 'local') {
    return this.send(COMM.SET_CURRENT_BRAKE, encodeSetCurrent(Math.abs(amps)), target)
  }

  /** Holds a duty cycle (-1..1) until the next command or the controller's timeout. */
  setDuty(duty: number, target: Target = 'local') {
    return this.send(COMM.SET_DUTY, encodeSetDuty(duty), target)
  }

  /** Turns the rotor to this angle (degrees) and holds it there. */
  setPos(deg: number, target: Target = 'local') {
    return this.send(COMM.SET_POS, encodeSetPos(deg), target)
  }

  /** Holds the motor still with this current (A), even at standstill. */
  setHandbrake(amps: number, target: Target = 'local') {
    return this.send(COMM.SET_HANDBRAKE, encodeSetHandbrake(Math.abs(amps)), target)
  }

  /**
   * Runs FOC detection and returns the firmware's result code. It takes tens of
   * seconds (minutes with CAN), so it isn't queued: polling carries on meanwhile and
   * the reply is picked out of the incoming packets by its ID.
   */
  async detectApplyAllFoc(args: DetectArgs, target: Target = 'local', timeoutMs = 200_000): Promise<number> {
    const reply = this.waitForPacket(COMM.DETECT_APPLY_ALL_FOC, timeoutMs)
    await this.send(COMM.DETECT_APPLY_ALL_FOC, encodeDetectArgs(args), target)
    return (await reply).i16()
  }

  /** Waits for an unsolicited packet with this ID. */
  private waitForPacket(command: number, timeoutMs: number): Promise<BufferReader> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new TimeoutError(command, 'local'))
      }, timeoutMs)
      const off = this.unsolicited.on((p) => {
        if (p[0] !== command) return
        clearTimeout(timer)
        off()
        resolve(new BufferReader(p, 1))
      })
    })
  }

  /** Erases the update area for an image this big. Takes a few seconds; never retried. */
  async eraseNewApp(bytes: number, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.ERASE_NEW_APP, encodeEraseNewApp(bytes), { target, timeoutMs: 20_000, retries: 0, priority: 'high' })
    return r.u8() === 1
  }

  /** Erases the bootloader, before writing a new one. */
  async eraseBootloader(target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.ERASE_BOOTLOADER, undefined, { target, timeoutMs: 20_000, retries: 0, priority: 'high' })
    return r.u8() === 1
  }

  /**
   * Writes one chunk of the update area. Retried on a lost reply: writing the same
   * bytes to the same place again is harmless. False if the controller refused it.
   */
  async writeNewAppData(offset: number, data: Uint8Array, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.WRITE_NEW_APP_DATA, encodeWriteNewAppData(offset, data), { target, timeoutMs: 3000, retries: 2, priority: 'high' })
    return wroteAt(decodeWriteReply(r), offset)
  }

  /** Restarts into the bootloader, which checks and installs the new image. There's no reply. */
  jumpToBootloader(target: Target = 'local') {
    return this.send(COMM.JUMP_TO_BOOTLOADER, undefined, target)
  }

  /** Evaluates a LispBM expression. Output and results arrive as COMM_LISP_PRINT (see onLispPrint). */
  lispRepl(code: string, target: Target = 'local') {
    return this.send(COMM.LISP_REPL_CMD, encodeReplCmd(code), target)
  }

  onLispPrint(cb: (text: string) => void) {
    return this.onUnsolicited((p) => {
      if (p[0] === COMM.LISP_PRINT) cb(decodePrint(p.subarray(1)))
    })
  }

  /** Stops the script engine and erases its storage for a script this big. */
  async lispErase(size: number, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.LISP_ERASE_CODE, encodeLispErase(size), { target, timeoutMs: 8000, retries: 0, priority: 'high' })
    return r.i8() > 0
  }

  /** Writes one chunk of script storage. Rewriting the same bytes is harmless, so a lost reply is retried (5 tries, like VESC Tool). */
  async lispWrite(offset: number, data: Uint8Array, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.LISP_WRITE_CODE, encodeLispWrite(offset, data), { target, timeoutMs: 1000, retries: 4, priority: 'high' })
    return wroteAt(decodeLispWriteReply(r), offset)
  }

  async lispRead(len: number, offset: number, target: Target = 'local') {
    return decodeLispReadReply(await this.request(COMM.LISP_READ_CODE, encodeLispRead(len, offset), { target, timeoutMs: 1500, retries: 2 }))
  }

  /** Starts (true) or stops the stored script. */
  async lispSetRunning(running: boolean, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.LISP_SET_RUNNING, encodeLispRunning(running), { target, timeoutMs: 3000, retries: 1, priority: 'high' })
    return !r.has(1) || r.u8() > 0
  }

  /** CPU and memory use plus numeric globals. No reply comes while no script runs, so the wait is short: a long one would hold up live data. */
  async lispStats(opts: RequestOptions = {}): Promise<LispStats> {
    return decodeLispStats(await this.request(COMM.LISP_GET_STATS, Uint8Array.of(1), { timeoutMs: 700, retries: 0, priority: 'low', ...opts }))
  }

  async qmlErase(size: number, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.QMLUI_ERASE, encodeLispErase(size), { target, timeoutMs: 8000, retries: 0, priority: 'high' })
    return r.i8() > 0
  }

  async qmlWrite(offset: number, data: Uint8Array, target: Target = 'local'): Promise<boolean> {
    const r = await this.request(COMM.QMLUI_WRITE, encodeLispWrite(offset, data), { target, timeoutMs: 1000, retries: 4, priority: 'high' })
    return wroteAt(decodeLispWriteReply(r), offset)
  }

  async customConfigXmlChunk(index: number, len: number, offset: number, target: Target = 'local') {
    const r = await this.request(COMM.GET_CUSTOM_CONFIG_XML, encodeCustomXmlRequest(index, len, offset), { target, timeoutMs: 1500, retries: 2 })
    return decodeCustomXmlChunk(r)
  }

  async getCustomConfig(index: number, opts: RequestOptions & { defaults?: boolean } = {}): Promise<Uint8Array> {
    const cmd = opts.defaults ? COMM.GET_CUSTOM_CONFIG_DEFAULT : COMM.GET_CUSTOM_CONFIG
    const r = await this.request(cmd, encodeCustomIndex(index), { timeoutMs: 1500, retries: 2, ...opts })
    r.i8()
    return r.rest()
  }

  async setCustomConfig(index: number, body: Uint8Array, opts: RequestOptions = {}): Promise<void> {
    await this.request(COMM.SET_CUSTOM_CONFIG, encodeCustomIndex(index, body), { timeoutMs: 3000, retries: 0, priority: 'high', ...opts })
  }

  async bmsValues(opts: RequestOptions = {}): Promise<BmsValues> {
    return decodeBmsValues(await this.request(COMM.BMS_GET_VALUES, undefined, { timeoutMs: 800, retries: 0, priority: 'low', ...opts }))
  }

  /** The firmware samples the IMU for a while (keep the board still and level); yaw is the mounting yaw in degrees. */
  async imuCalibration(yawDeg: number, target: Target = 'local'): Promise<ImuCalibration> {
    const r = await this.request(COMM.GET_IMU_CALIBRATION, encodeImuCalibrationRequest(yawDeg), { target, timeoutMs: 15_000, retries: 0, priority: 'high' })
    return decodeImuCalibration(r)
  }

  /** Sends one raw frame on the CAN bus of the controller on the cable. */
  sendCanFrame(frame: CanFrame) {
    return this.send(COMM.CAN_FWD_FRAME, encodeCanFrame(frame))
  }

  /** Frames the controller passes on in comm-bridge CAN mode. */
  onCanFrame(cb: (frame: CanFrame) => void) {
    return this.onUnsolicited((p) => {
      if (p[0] !== COMM.CAN_FWD_FRAME) return
      try {
        cb(decodeCanFrame(new BufferReader(p, 1)))
      } catch {
        // A short frame; skip it.
      }
    })
  }

  /** Changes the CAN mode of the controller on the cable. With store false it lasts until the next power cycle. */
  async setCanMode(mode: number, store = false): Promise<void> {
    await this.request(COMM.SET_CAN_MODE, encodeSetCanMode(mode, store, true), { timeoutMs: 1500, retries: 1, priority: 'high' })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.offData()
    if (this.timer) clearTimeout(this.timer)
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer)
    const err = new ClosedError()
    this.inflight?.reject(err)
    this.inflight = null
    for (const j of this.queue) j.reject(err)
    this.queue = []
  }

  private pump() {
    if (this.inflight || this.closed) return
    // After a timeout, wait out the cooldown so a late reply can't be
    // credited to the next request (possibly for another CAN device).
    const wait = this.cooldownUntil - Date.now()
    if (wait > 0) {
      if (!this.cooldownTimer) {
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = null
          this.pump()
        }, wait)
      }
      return
    }
    const job = this.queue.shift()
    if (!job) return
    this.inflight = job
    tap?.('tx', job.payload)
    this.transport.write(encodePacket(job.payload)).catch((e: unknown) => {
      this.finish(job)
      job.reject(e instanceof Error ? e : new Error(String(e)))
    })
    this.timer = setTimeout(() => this.onTimeout(job), job.timeoutMs)
  }

  private onTimeout(job: Job) {
    if (this.inflight !== job) return
    tap?.('timeout', job.payload)
    this.cooldownUntil = Date.now() + TIMEOUT_COOLDOWN_MS
    if (job.retriesLeft > 0) {
      job.retriesLeft--
      this.inflight = null
      this.queue.unshift(job)
      this.pump()
      return
    }
    this.finish(job)
    job.reject(new TimeoutError(job.command, job.target))
  }

  private finish(job: Job) {
    if (this.inflight === job) {
      this.inflight = null
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
    }
    queueMicrotask(() => this.pump())
  }

  private onPacket(payload: Uint8Array) {
    tap?.('rx', payload)
    const job = this.inflight
    if (job && payload[0] === job.command) {
      this.finish(job)
      job.resolve(new BufferReader(payload, 1))
      return
    }
    this.unsolicited.emit(payload)
  }
}

/** A write was taken: the controller said ok and, if it echoed an offset (firmware 5.3 and newer), it's the one sent. */
function wroteAt(reply: { ok: boolean; offset: number | null }, offset: number): boolean {
  return reply.ok && (reply.offset === null || reply.offset === offset)
}

function frameFor(command: number, body: Uint8Array, target: Target): Uint8Array {
  const w = new BufferWriter()
  if (target !== 'local') w.u8(COMM.FORWARD_CAN).u8(target)
  return w.u8(command).raw(body).toUint8Array()
}
