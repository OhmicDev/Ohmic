// Answers VESC protocol packets like real hardware.
//
// Layouts:
// - 'dual':    a motor controller on USB (local) plus a second one on CAN 2.
// - 'express': a VESC Express bridge (local, not a motor controller) with two
//              motor controllers on CAN 10 and 11, as when riding over Bluetooth.

import { SignatureMismatchError } from '../config/codec'
import { bootloaderUnpack, BOOTLOADER_OFFSET, MAX_BOOTLOADER_BYTES } from '../firmware/image'
import type { ConfigKind, ConfigValues } from '../config/types'
import { BufferReader, BufferWriter } from '../protocol/buffer'
import { COMM, HW_TYPE } from '../protocol/commands'
import { encodeBmsValues, type BmsValues } from '../protocol/bms'
import { CAN_MODE, decodeCanFrame, encodeCanFrame, type CanFrame } from '../protocol/can'
import { encodeImu, encodeImuCalibration } from '../protocol/imu'
import { encodeFwVersion, encodeValues, encodeValuesSelective, type FwVersion } from '../protocol/messages'
import {
  decodeDetectArgs,
  decodeReplCmd,
  decodeTempLimitsBody,
  encodeDecodedAdc,
  encodeDecodedPpm,
  encodeTempLimitsReply,
  TEMP_FIELDS,
  TEMP_KEYS,
} from '../protocol/setup'
import { decodeWriteNewAppData } from '../protocol/firmware'
import { decodePrint } from '../protocol/terminal'
import { MockConfigStore } from './mockConfig'
import { MockLisp } from './mockLisp'
import { MockScripts } from './mockScripts'
import { FAULT_LOG_LEN, runTerminal, type SimFaultRecord } from './mockTerminal'
import { VehicleSim } from './vehicleSim'

export type MockLayout = 'dual' | 'express'

/** A reply, optionally held back (the firmware sleeps 200 ms after a flash write). */
export type MockReply = Uint8Array | { data: Uint8Array; delayMs: number }

const CONFIG_CMDS: Record<number, { kind: ConfigKind; op: 'get' | 'default' | 'set' }> = {
  [COMM.GET_MCCONF]: { kind: 'mcconf', op: 'get' },
  [COMM.GET_MCCONF_DEFAULT]: { kind: 'mcconf', op: 'default' },
  [COMM.SET_MCCONF]: { kind: 'mcconf', op: 'set' },
  [COMM.GET_APPCONF]: { kind: 'appconf', op: 'get' },
  [COMM.GET_APPCONF_DEFAULT]: { kind: 'appconf', op: 'default' },
  [COMM.SET_APPCONF]: { kind: 'appconf', op: 'set' },
}

export const replyData = (r: MockReply): Uint8Array => (r instanceof Uint8Array ? r : r.data)

function print(text: string): Uint8Array {
  return Uint8Array.from([COMM.PRINT, ...new TextEncoder().encode(text)])
}

function lispPrint(text: string): Uint8Array {
  return Uint8Array.from([COMM.LISP_PRINT, ...new TextEncoder().encode(text)])
}

/** How long simulated FOC detection takes on one controller (s). */
export const MOCK_DETECT_S = 8

/** How long a simulated controller takes to install new firmware and start again (ms). */
export const MOCK_REBOOT_MS = 3000

export class MockDevice {
  readonly controllerId: number
  /** Which simulated motor this controller drives, or null for a non-motor module. */
  readonly motorIndex: number | null
  fw: FwVersion
  readonly config: MockConfigStore | null
  /** Faults since "power on", as the `faults` terminal command prints them. */
  readonly faultLog: SimFaultRecord[] = []
  readonly lisp: MockLisp
  /** The tune playing through the motor (demo), and when it ends (bus time). */
  tune: { entries: number[]; until: number } | null = null
  /** Demo: this motor's phase wires are swapped, so it turns backwards until inverted in settings. */
  wiredBackwards = false
  /** The update area (new firmware, then the bootloader), once erased. */
  updateArea: Uint8Array | null = null
  /** Demo: the version the next installed image is, since a real image doesn't say. Null keeps the version. */
  nextVersion: { major: number; minor: number } | null = null
  /** Restarting after a firmware update: silent until then (bus time). */
  rebootUntil = 0
  /** Firmware images the bootloader installed, newest last (tests look at them). */
  readonly installed: Uint8Array[] = []
  /** Stored script, QML screen and package settings. */
  readonly scripts: MockScripts
  private readonly bus: MockBus

  constructor(bus: MockBus, motorIndex: number | null, controllerId: number, fw: FwVersion) {
    this.bus = bus
    this.motorIndex = motorIndex
    this.controllerId = controllerId
    this.fw = fw
    this.config = motorIndex === null ? null : new MockConfigStore(controllerId)
    if (this.config) this.applyToSim(this.config.values.mcconf)
    const sim = bus.sim
    const i = motorIndex ?? 0
    this.scripts = new MockScripts({
      now: () => bus.now(),
      canErase: () => true,
      reading: (fn) => {
        sim.advanceTo(bus.now())
        if (fn === 'get-speed') return sim.speed
        if (fn === 'get-vin') return sim.vBat
        if (motorIndex === null) return null
        const v = sim.valuesFor(motorIndex, controllerId)
        const map: Record<string, number> = {
          'get-rpm': v.rpm,
          'get-current': v.currentMotor,
          'get-current-in': v.currentIn,
          'get-temp-fet': v.tempFet,
          'get-duty': v.dutyNow,
        }
        return fn in map ? map[fn] : null
      },
    })
    this.lisp = new MockLisp({
      now: () => bus.now(),
      startAbs: (p) => {
        sim.advanceTo(bus.now())
        sim.startAbs(i, p)
      },
      stopAbs: () => {
        sim.advanceTo(bus.now())
        sim.stopAbs(i)
      },
      absStatus: () => {
        sim.advanceTo(bus.now())
        return sim.absFor(i)
      },
      playTune: (entries) => {
        let ms = 0
        for (let k = 0; k + 3 < entries.length; k += 4) ms += entries[k + 1] + entries[k + 2]
        this.tune = { entries, until: bus.now() + ms }
      },
      stopTune: () => {
        this.tune = null
      },
      startRegen: (p) => {
        sim.advanceTo(bus.now())
        const followers = p.followers.map((id) => bus.motorIndexForId(id)).filter((m): m is number => m !== null)
        sim.startRegen(i, followers, p)
      },
      stopRegen: () => {
        sim.advanceTo(bus.now())
        sim.stopRegen(i)
      },
      regenStatus: () => {
        sim.advanceTo(bus.now())
        return sim.regenFor(i)
      },
    })
  }

  private applyToSim(mc: ConfigValues) {
    if (this.motorIndex === null) return
    const n = (k: string) => mc[k] as number
    this.bus.sim.setLimits(this.motorIndex, {
      motorCurrentMax: n('l_current_max') * n('l_current_max_scale'),
      motorCurrentBrake: n('l_current_min'),
      brakeScale: n('l_current_min_scale'),
      batteryCurrentMax: n('l_in_current_max'),
      batteryCurrentRegen: n('l_in_current_min'),
      maxDuty: n('l_max_duty'),
      maxErpm: n('l_max_erpm'),
      wattMax: n('l_watt_max'),
    })
  }

  /** COMM_SET_MCCONF_TEMP: changes the live limits only (a reconnect to the demo starts fresh, like a power cycle). */
  private setTempLimits(body: Uint8Array): MockReply[] {
    const l = decodeTempLimitsBody(body)
    const mc = { ...this.config!.values.mcconf }
    for (const k of TEMP_KEYS) {
      if (!Number.isFinite(l[k])) continue
      mc[TEMP_FIELDS[k]] = k === 'currentMinScale' || k === 'currentMaxScale' ? Math.min(1, Math.max(0, l[k])) : l[k]
    }
    this.config!.values.mcconf = mc
    this.applyToSim(mc)
    return l.ack ? [Uint8Array.of(COMM.SET_MCCONF_TEMP)] : []
  }

  private getTempLimits(): MockReply[] {
    const mc = this.config!.values.mcconf
    const l = Object.fromEntries(TEMP_KEYS.map((k) => [k, Number(mc[TEMP_FIELDS[k]])])) as unknown as Parameters<typeof encodeTempLimitsReply>[0]
    const wheel = { motorPoles: Number(mc.si_motor_poles), gearRatio: Number(mc.si_gear_ratio), wheelDiameter: Number(mc.si_wheel_diameter) }
    return [Uint8Array.from([COMM.GET_MCCONF_TEMP, ...encodeTempLimitsReply(l, wheel)])]
  }

  /** What FOC detection finds on the demo motors, applied and stored like the firmware does. */
  detect(args: ReturnType<typeof decodeDetectArgs>): number {
    const store = this.config!
    const r = 0.0912 + (this.controllerId % 3) * 0.0011
    const l = 0.0001485
    const flux = 0.02178
    const iMax = Math.min(MOCK_HW_CURRENT, Math.round(Math.sqrt(args.maxPowerLoss / r) * 10) / 10)
    const hall = [255, 41, 108, 75, 175, 9, 142, 255]
    store.values.mcconf = {
      ...store.values.mcconf,
      motor_type: 2,
      foc_motor_r: r,
      foc_motor_l: l,
      foc_motor_ld_lq_diff: 0,
      foc_motor_flux_linkage: flux,
      foc_current_kp: Number((l * 1000).toFixed(4)),
      foc_current_ki: Number((r * 1000).toFixed(2)),
      foc_observer_gain: Math.round(1000 / (flux * flux)), // stored ×1M, like the firmware
      foc_sensor_mode: 2,
      ...Object.fromEntries(hall.map((v, k) => [`foc_hall_table__${k}`, v])),
      l_current_max: iMax,
      l_current_min: -iMax,
      l_in_current_max: args.maxCurrentIn,
      l_in_current_min: args.minCurrentIn,
      foc_openloop_rpm: args.openloopErpm,
      foc_sl_erpm: args.sensorlessErpm,
    }
    store.writes++
    this.applyToSim(store.values.mcconf)
    if (this.motorIndex !== null) this.bus.sim.startDetection(this.motorIndex, this.bus.detectSeconds)
    return 1 // hall sensors found
  }

  private handleConfig(cmd: number, body: Uint8Array): MockReply[] {
    const { kind, op } = CONFIG_CMDS[cmd]
    const store = this.config!
    if (op !== 'set') return [Uint8Array.from([cmd, ...store.get(kind, op === 'default')])]
    try {
      const next = store.set(kind, body)
      if (kind === 'mcconf') this.applyToSim(next)
      return [{ data: Uint8Array.of(cmd), delayMs: 200 }]
    } catch (e) {
      if (e instanceof SignatureMismatchError) return [print(`Warning: Could not set ${kind} due to wrong signature`)]
      return [] // a truncated body: the firmware reads garbage; we just ignore it
    }
  }

  /**
   * Demo control: makes this controller report a fault for a while. Like the
   * firmware, a fault that starts while none is active goes into the fault log.
   */
  injectFault(code: number, seconds = 2.5): boolean {
    const motor = this.motorIndex
    if (motor === null) return false
    const sim = this.bus.sim
    sim.advanceTo(this.bus.now())
    const before = sim.faultFor(motor)
    const v = sim.valuesFor(motor, this.controllerId)
    sim.injectFault(motor, code, seconds)
    if (before === 0) {
      this.faultLog.push({
        code,
        motor: 1,
        current: v.currentMotor,
        currentFiltered: v.currentMotor * 0.92,
        voltage: v.vIn,
        duty: v.dutyNow,
        rpm: v.rpm,
        tacho: v.tachometer,
        cyclesRunning: Math.round(sim.time * 20_000),
        temperature: v.tempFet,
      })
      if (this.faultLog.length >= FAULT_LOG_LEN) this.faultLog.length = 0
    }
    return true
  }

  /** The invert-direction setting flips which way commands turn the motor. */
  private direction(): number {
    return Number(this.config?.values.mcconf.m_invert_direction) === 1 ? -1 : 1
  }

  private terminal(line: string): MockReply[] {
    const motor = this.motorIndex
    const sim = this.bus.sim
    sim.advanceTo(this.bus.now())
    const lines = runTerminal(line, {
      motor: motor !== null,
      hwName: this.fw.hwName,
      uuid: this.fw.uuid,
      fwMajor: this.fw.major,
      fwMinor: this.fw.minor,
      uptimeSec: this.bus.uptimeSec(),
      odometerM: 412_380 + sim.distanceM,
      values: motor === null ? null : sim.valuesFor(motor, this.controllerId),
      faultLog: this.faultLog,
    })
    return lines.map(print)
  }

  /** The bootloader's turn: install the image if its header and CRC check out, then start again. */
  private jumpToBootloader() {
    const image = this.updateArea ? bootloaderUnpack(this.updateArea.subarray(0, BOOTLOADER_OFFSET)) : null
    this.rebootUntil = this.bus.now() + MOCK_REBOOT_MS
    if (this.motorIndex !== null) this.bus.sim.setTest(this.motorIndex, 0)
    if (image) {
      this.installed.push(image)
      const v = this.nextVersion
      this.nextVersion = null
      if (v && (v.major !== this.fw.major || v.minor !== this.fw.minor)) {
        this.fw = { ...this.fw, major: v.major, minor: v.minor }
        void this.config?.reflash(`${v.major}.${String(v.minor).padStart(2, '0')}`).then(() => {
          if (this.config) this.applyToSim(this.config.values.mcconf)
        })
      }
    }
    this.bus.rebooted(this)
  }

  private handleUpdate(cmd: number, payload: Uint8Array): MockReply[] {
    const sim = this.bus.sim
    sim.advanceTo(this.bus.now())
    const fresh = () => new Uint8Array(BOOTLOADER_OFFSET + MAX_BOOTLOADER_BYTES).fill(0xff)
    if (cmd === COMM.ERASE_NEW_APP) {
      const size = new BufferReader(payload, 1).u32()
      // The firmware won't erase while the motor runs or for an image that can't fit.
      if (sim.speed > 0.3 || size === 0 || size > 1_048_576) return [Uint8Array.of(cmd, 0)]
      const area = this.updateArea ?? fresh()
      area.fill(0xff, 0, BOOTLOADER_OFFSET)
      this.updateArea = area
      return [{ data: Uint8Array.of(cmd, 1), delayMs: 700 }]
    }
    if (cmd === COMM.ERASE_BOOTLOADER) {
      const area = this.updateArea ?? fresh()
      area.fill(0xff, BOOTLOADER_OFFSET)
      this.updateArea = area
      return [{ data: Uint8Array.of(cmd, 1), delayMs: 300 }]
    }
    if (cmd === COMM.WRITE_NEW_APP_DATA) {
      const { offset, data } = decodeWriteNewAppData(payload.subarray(1))
      const area = this.updateArea
      const ok = !!area && offset + data.length <= area.length
      if (ok) area.set(data, offset)
      return [Uint8Array.from([cmd, ok ? 1 : 0, ...new BufferWriter().u32(offset).toUint8Array()])]
    }
    this.jumpToBootloader()
    return []
  }

  handle(payload: Uint8Array): MockReply[] {
    const r = new BufferReader(payload)
    const cmd = r.u8()
    if (this.bus.now() < this.rebootUntil) return [] // restarting
    if (cmd === COMM.FW_VERSION) {
      return [encodeFwVersion({ ...this.fw, customConfigCount: this.scripts.customConfigCount(), qmlApp: this.scripts.hasQml() ? 1 : 0 })]
    }
    if (cmd === COMM.TERMINAL_CMD) return this.terminal(decodePrint(payload.subarray(1)))
    const scripted = this.scripts.handle(cmd, payload.subarray(1))
    if (scripted) return scripted
    const motor = this.motorIndex
    if (motor === null) return [] // modules ignore motor commands
    if (cmd === COMM.ERASE_NEW_APP || cmd === COMM.WRITE_NEW_APP_DATA || cmd === COMM.ERASE_BOOTLOADER || cmd === COMM.JUMP_TO_BOOTLOADER) {
      return this.handleUpdate(cmd, payload)
    }
    if (cmd in CONFIG_CMDS) return this.handleConfig(cmd, payload.subarray(1))
    const sim = this.bus.sim
    switch (cmd) {
      case COMM.SET_MCCONF_TEMP:
        return this.setTempLimits(payload.subarray(1))
      case COMM.GET_MCCONF_TEMP:
        return this.getTempLimits()
      case COMM.DETECT_APPLY_ALL_FOC: {
        sim.advanceTo(this.bus.now())
        const args = decodeDetectArgs(payload.subarray(1))
        if (sim.speed > 0.3) return [{ data: Uint8Array.of(COMM.DETECT_APPLY_ALL_FOC, 0xff, 0x9c + 4), delayMs: 300 }] // -100 + fault 4 (absolute overcurrent)
        let code = this.detect(args)
        let seconds = this.bus.detectSeconds
        if (args.detectCan) {
          for (const d of this.bus.remotes.values()) {
            if (!d.config) continue
            code = Math.min(code, d.detect(args))
            seconds += this.bus.detectSeconds / 4
          }
        }
        const reply = new Uint8Array([COMM.DETECT_APPLY_ALL_FOC, (code >> 8) & 0xff, code & 0xff])
        return [{ data: reply, delayMs: seconds * 1000 }]
      }
      case COMM.GET_DECODED_ADC: {
        sim.advanceTo(this.bus.now())
        const { throttle, brake } = sim.inputs()
        return [
          Uint8Array.from([
            COMM.GET_DECODED_ADC,
            ...encodeDecodedAdc({ level: throttle, voltage: 0.84 + throttle * 2.21, level2: brake, voltage2: 0.88 + brake * 2.17 }),
          ]),
        ]
      }
      case COMM.GET_DECODED_PPM: {
        sim.advanceTo(this.bus.now())
        const { throttle, brake } = sim.inputs()
        const level = throttle - brake
        return [Uint8Array.from([COMM.GET_DECODED_PPM, ...encodeDecodedPpm({ level, pulseMs: 1.5 + level * 0.5 })])]
      }
      case COMM.SET_RPM: {
        sim.advanceTo(this.bus.now())
        const erpm = r.i32()
        const inverted = Number(this.config!.values.mcconf.m_invert_direction) === 1
        // The wheel's real direction: wiring and the invert setting both flip it. The reported ERPM doesn't change.
        sim.setTest(motor, erpm, 1, undefined, (this.wiredBackwards ? -1 : 1) * (inverted ? -1 : 1))
        return []
      }
      case COMM.SET_CURRENT: {
        sim.advanceTo(this.bus.now())
        const amps = r.i32() / 1000
        if (amps === 0) sim.setTest(motor, 0)
        else sim.setBench(motor, 'current', amps * this.direction())
        return []
      }
      case COMM.SET_DUTY:
        sim.advanceTo(this.bus.now())
        sim.setBench(motor, 'duty', (r.i32() / 100_000) * this.direction())
        return []
      case COMM.SET_POS:
        sim.advanceTo(this.bus.now())
        sim.setBench(motor, 'pos', r.i32() / 1_000_000)
        return []
      case COMM.SET_HANDBRAKE:
        sim.advanceTo(this.bus.now())
        sim.setBench(motor, 'handbrake', r.i32() / 1000)
        return []
      case COMM.SET_CURRENT_BRAKE: {
        sim.advanceTo(this.bus.now())
        sim.setBrakeTest(motor, r.i32() / 1000)
        return []
      }
      case COMM.ALIVE:
        sim.advanceTo(this.bus.now())
        sim.keepAlive(motor)
        return []
      case COMM.LISP_REPL_CMD: {
        const out = this.lisp.eval(decodeReplCmd(payload.subarray(1)))
        return out ? out.map(lispPrint) : []
      }
      case COMM.GET_VALUES:
        sim.advanceTo(this.bus.now())
        return [encodeValues(sim.valuesFor(motor, this.controllerId))]
      case COMM.GET_VALUES_SELECTIVE: {
        sim.advanceTo(this.bus.now())
        const mask = r.u32()
        return [encodeValuesSelective(sim.valuesFor(motor, this.controllerId), mask)]
      }
      case COMM.GET_IMU_DATA: {
        sim.advanceTo(this.bus.now())
        return [encodeImu(sim.imu(), r.u16(), this.controllerId)]
      }
      case COMM.GET_IMU_CALIBRATION: {
        // The firmware samples the IMU at rest for a couple of seconds. The demo board sits a little crooked.
        const yaw = r.f32(1e3)
        const k = this.controllerId % 3
        const cal = [1.7 + k * 0.2, -0.6, yaw, 0.012, -0.008, 0.021 + k * 0.001, -0.41, 0.27, 0.06]
        return [{ data: encodeImuCalibration(cal), delayMs: 2200 }]
      }
      case COMM.BMS_GET_VALUES:
        return [Uint8Array.from([COMM.BMS_GET_VALUES, ...encodeBmsValues(this.bus.bmsValues())])]
      case COMM.SET_CAN_MODE: {
        if (this !== this.bus.local) return []
        r.u8() // store: the demo forgets on reconnect either way
        const ack = r.u8()
        const mode = r.u8()
        this.bus.canMode = mode
        if (this.config) this.config.values.appconf = { ...this.config.values.appconf, can_mode: mode }
        return ack ? [Uint8Array.of(COMM.SET_CAN_MODE)] : []
      }
      case COMM.CAN_FWD_FRAME: {
        if (this !== this.bus.local) return []
        this.bus.transmit(decodeCanFrame(new BufferReader(payload, 1)))
        return []
      }
      default:
        // Real firmware ignores commands it doesn't handle (ALIVE included); so do we.
        return []
    }
  }
}

function fw(hwName: string, uuid: string, hwType: number = HW_TYPE.VESC): FwVersion {
  return {
    major: 6,
    minor: 6,
    hwName,
    uuid,
    pairingDone: false,
    testVersion: 0,
    hwType,
    customConfigCount: 0,
    hasPhaseFilters: false,
    qmlHw: 0,
    qmlApp: 0,
    nrfFlags: 0,
    fwName: '',
    hwCrc: 0,
  }
}

const MOCK_HW_CURRENT = 100

export class MockBus {
  readonly sim: VehicleSim
  readonly now: () => number
  readonly local: MockDevice
  readonly remotes = new Map<number, MockDevice>()
  /** How long one motor detection takes, in seconds (tests shorten it). */
  detectSeconds = MOCK_DETECT_S
  /** CAN mode of the controller on the cable (RAM). In comm-bridge mode it passes frames to the app instead of handling them. */
  canMode: number = CAN_MODE.VESC
  /** Frames the app sent on the bus (tests look at them). */
  readonly sentFrames: CanFrame[] = []
  private readonly bootedAt: number
  private framesUntil = 0
  private pendingFrames: CanFrame[] = []

  constructor(opts: { now?: () => number; sim?: VehicleSim; layout?: MockLayout } = {}) {
    this.now = opts.now ?? (() => performance.now())
    this.sim = opts.sim ?? new VehicleSim()
    // As if the scooter was switched on a little before the app connected.
    this.bootedAt = this.now() - 41_000
    if (opts.layout === 'express') {
      this.local = new MockDevice(this, null, 254, fw('VESC Express T', '5e1a0000000000000000e001', HW_TYPE.CUSTOM_MODULE))
      this.remotes.set(10, new MockDevice(this, 0, 10, fw('SIM_75_100', '5e1a00000000000000000010')))
      this.remotes.set(11, new MockDevice(this, 1, 11, fw('SIM_75_100', '5e1a00000000000000000011')))
    } else {
      this.local = new MockDevice(this, 0, 1, fw('SIM_75_100', '5e1a00000000000000000001'))
      this.remotes.set(2, new MockDevice(this, 1, 2, fw('SIM_75_100', '5e1a00000000000000000002')))
    }
    // The second motor's phase wires are swapped, so the direction wizard has something to fix.
    const second = [...this.remotes.values()].find((d) => d.motorIndex === 1)
    if (second) second.wiredBackwards = true
    // The throttle and brake lever are wired to the first motor controller (ADC, brake on ADC2),
    // which drives the other over CAN.
    const master = this.devices().find((d) => d.motorIndex === 0)
    if (master?.config) master.config.values.appconf = { ...master.config.values.appconf, app_to_use: 5, 'app_adc_conf.ctrl_type': 8, 'app_adc_conf.multi_esc': 1 }
  }

  /** Told when the controller on the cable restarts, so the link drops like USB does. */
  onLocalReboot: ((ms: number) => void) | null = null

  rebooted(device: MockDevice) {
    if (device === this.local) this.onLocalReboot?.(MOCK_REBOOT_MS)
  }

  uptimeSec(): number {
    return (this.now() - this.bootedAt) / 1000
  }

  /** The simulated motor driven by the controller with this CAN ID, or null. */
  motorIndexForId(id: number): number | null {
    return this.devices().find((d) => d.controllerId === id)?.motorIndex ?? null
  }

  /** Every controller with settings, local first. */
  devices(): MockDevice[] {
    return [this.local, ...this.remotes.values()]
  }

  handle(payload: Uint8Array): MockReply[] {
    if (payload.length === 0) return []
    const extra = this.unsolicited()
    const bridged = this.canMode === CAN_MODE.COMM_BRIDGE
    let replies: MockReply[]
    if (payload[0] === COMM.FORWARD_CAN) {
      // In comm-bridge mode the controller no longer reads VESC CAN replies, so forwarding gets nothing back.
      const target = bridged ? undefined : this.remotes.get(payload[1])
      replies = target ? target.handle(payload.subarray(2)) : []
    } else if (payload[0] === COMM.PING_CAN) {
      replies = [Uint8Array.from([COMM.PING_CAN, ...(bridged ? [] : [...this.remotes.keys()].sort((a, b) => a - b))])]
    } else {
      replies = this.local.handle(payload)
    }
    return [...replies, ...extra]
  }

  /** A frame the app put on the bus. A VESC ping to a controller here gets its pong. */
  transmit(f: CanFrame) {
    this.sentFrames.push(f)
    const type = (f.id >>> 8) & 0xffff
    const to = f.id & 0xff
    const dev = this.remotes.get(to)
    if (f.extended && type === 17 && dev) this.pendingFrames.push({ id: (18 << 8) | to, extended: true, data: Uint8Array.of(to, dev.fw.hwType) })
  }

  /** Script output and, in comm-bridge mode, the CAN traffic since the last packet. */
  private unsolicited(): MockReply[] {
    const out: MockReply[] = []
    for (const d of this.devices()) out.push(...d.scripts.pump())
    const now = this.now()
    if (this.canMode !== CAN_MODE.COMM_BRIDGE) {
      this.framesUntil = now
      this.pendingFrames = []
      return out
    }
    const frames = this.pendingFrames
    this.pendingFrames = []
    // Each controller on CAN sends its status messages; 10 Hz here so the demo link keeps up.
    const STEP = 100
    let t = Math.max(this.framesUntil, now - 1000)
    for (; t + STEP <= now; t += STEP) {
      this.sim.advanceTo(t)
      const slow = Math.floor(t / STEP) % 10 === 0
      for (const d of this.remotes.values()) {
        if (d.motorIndex === null) continue
        const v = this.sim.valuesFor(d.motorIndex, d.controllerId)
        const id = (type: number) => (type << 8) | d.controllerId
        const w = () => new BufferWriter()
        const r10 = (x: number) => Math.round(x * 10)
        frames.push({ id: id(9), extended: true, data: w().i32(Math.round(v.rpm)).i16(r10(v.currentMotor)).i16(Math.round(v.dutyNow * 1000)).toUint8Array() })
        frames.push({ id: id(16), extended: true, data: w().i16(r10(v.tempFet)).i16(r10(v.tempMotor)).i16(r10(v.currentIn)).i16(0).toUint8Array() })
        frames.push({ id: id(27), extended: true, data: w().i32(v.tachometer).i16(r10(v.vIn)).toUint8Array() })
        if (slow) {
          frames.push({ id: id(14), extended: true, data: w().i32(Math.round(v.ampHours * 1e4)).i32(Math.round(v.ampHoursCharged * 1e4)).toUint8Array() })
          frames.push({ id: id(15), extended: true, data: w().i32(Math.round(v.wattHours * 1e4)).i32(Math.round(v.wattHoursCharged * 1e4)).toUint8Array() })
        }
      }
    }
    this.framesUntil = t
    for (const f of frames) out.push(Uint8Array.from([COMM.CAN_FWD_FRAME, ...encodeCanFrame(f)]))
    return out
  }

  /** What a VESC BMS on this scooter's CAN bus reports, as the controllers pass it on. */
  bmsValues(): BmsValues {
    const sim = this.sim
    sim.advanceTo(this.now())
    const n = sim.p.cellsSeries
    const motors = this.devices().filter((d) => d.motorIndex !== null)
    const values = motors.map((d) => sim.valuesFor(d.motorIndex!, d.controllerId))
    const current = values.reduce((a, v) => a + v.currentIn, 0)
    const avg = sim.vBat / n
    // Fixed small differences between cells, as a real pack has; cell 8 is the weak one.
    const offsets = Array.from({ length: n }, (_, i) => (((i * 37) % 11) - 5) * 0.0021 + (i === 7 ? -0.009 : 0))
    const mean = offsets.reduce((a, b) => a + b, 0) / n
    const cells = offsets.map((o) => Math.round((avg + o - mean) * 1000) / 1000)
    const min = Math.min(...cells)
    const resting = Math.abs(current) < 1
    const warm = 24 + Math.min(18, Math.abs(current) * 0.35)
    const temps = [warm, warm + 0.8, warm - 0.5, warm + 0.3]
    return {
      vTotal: sim.vBat,
      vCharge: 0,
      current,
      currentIc: current * 1.004,
      ahCount: values.reduce((a, v) => a + v.ampHours, 0),
      whCount: values.reduce((a, v) => a + v.wattHours, 0),
      cells,
      balancing: cells.map((c) => resting && c - min > 0.008),
      temps,
      tempIc: warm + 3.5,
      tempHumSensor: 23.4,
      humidity: 41,
      tempCellsHighest: Math.max(...temps),
      soc: sim.soc,
      soh: 0.97,
      canId: 255,
      ahChargeTotal: 182.4,
      whChargeTotal: 8790,
      ahDischargeTotal: 190.1,
      whDischargeTotal: 9025,
      pressure: null,
      dataVersion: 1,
      status: resting ? 'Idle' : 'Discharging',
    }
  }
}
