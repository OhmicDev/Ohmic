// A small physics model of a dual-motor scooter on a looping test ride.
// It only exists so the app can be built, tested and demoed without hardware.

import { absInit, absStep, type AbsParams, type AbsState } from '../onboard/abs'
import { regenInit, regenStep, type RegenParams, type RegenState } from '../onboard/regen'
import { emptyImu, type ImuData } from '../protocol/imu'
import { emptyValues, type Values } from '../protocol/messages'

interface SimParams {
  cellsSeries: number
  cellsParallel: number
  cellAh: number
  cellResistance: number // ohm per cell
  motors: number
  motorPoles: number
  kv: number // rpm per volt
  motorResistance: number // ohm
  wheelDiameterM: number
  gearRatio: number
  massKg: number
  crr: number
  cda: number
  motorCurrentMax: number // A per motor
  motorCurrentBrake: number // A per motor (negative)
  batteryCurrentMax: number // A per controller
  batteryCurrentRegen: number // A per controller (negative)
  maxDuty: number
  ambientC: number
  startSoc: number // 0..1
}

const DEFAULT_SIM: SimParams = {
  cellsSeries: 13,
  cellsParallel: 4,
  cellAh: 3.5,
  cellResistance: 0.03,
  motors: 2,
  motorPoles: 30,
  kv: 17,
  motorResistance: 0.09,
  wheelDiameterM: 0.254,
  gearRatio: 1,
  massKg: 105,
  crr: 0.012,
  cda: 0.45,
  motorCurrentMax: 55,
  motorCurrentBrake: -40,
  batteryCurrentMax: 30,
  batteryCurrentRegen: -12,
  maxDuty: 0.95,
  ambientC: 22,
  startSoc: 0.9,
}

// [seconds, throttle (-1 brake .. 1 full), road grade]
const RIDE: [number, number, number][] = [
  [4, 0, 0],
  [7, 1, 0],
  [10, 0.45, 0],
  [8, 0.85, 0.06],
  [6, 0.4, 0],
  [4, -0.7, 0],
  [3, 0, 0],
  [6, 0.6, 0],
  [12, 0.55, 0],
  [5, 0, 0], // lets go and rolls (with regen on, the motors slow it)
  [6, -0.25, -0.04],
  [4, -1, 0],
  [3, 0, 0],
]
const RIDE_LENGTH = RIDE.reduce((s, [d]) => s + d, 0)

const LI_ION_OCV: [number, number][] = [
  [0, 3.0], [0.05, 3.3], [0.1, 3.45], [0.2, 3.55], [0.3, 3.62], [0.4, 3.68],
  [0.5, 3.74], [0.6, 3.8], [0.7, 3.88], [0.8, 3.96], [0.9, 4.05], [1, 4.15],
]

function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]
    if (x <= x1) {
      const [x0, y0] = table[i - 1]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return table[table.length - 1][1]
}

/** Limits each controller enforces; config writes change these. */
interface MotorLimits {
  /** Drive current, scale included (l_current_max x l_current_max_scale). */
  motorCurrentMax: number
  /** Braking current before its scale (l_current_min, negative). */
  motorCurrentBrake: number
  /** l_current_min_scale; ABS changes it live. */
  brakeScale: number
  batteryCurrentMax: number
  batteryCurrentRegen: number
  maxDuty: number
  /** Electrical RPM above which the motor stops pushing. */
  maxErpm: number
  /** Battery power per controller (W). */
  wattMax: number
}

/** Tyre grip on dry tarmac, and on the demo's wet patch. */
const GRIP_DRY = 0.9
const GRIP_WET = 0.2
/** The wheel and rotor's inertia, as mass at the tyre (kg). */
const WHEEL_MASS = 4

/** Bench control of a lifted wheel, as the motor control panel drives it. */
type BenchMode = 'current' | 'duty' | 'pos' | 'handbrake'

interface MotorState {
  limits: MotorLimits
  current: number
  batteryCurrent: number
  duty: number
  tempMotor: number
  tempFet: number
  ah: number
  ahCharged: number
  wh: number
  whCharged: number
  tacho: number
  tachoAbs: number
  /** Active fault code (0 = none) and the sim time it clears. */
  fault: number
  faultUntil: number
  /** This wheel's speed (m/s). Equal to the vehicle's unless it skids or is lifted. */
  wheel: number
  slipping: boolean
  /** Off the ground (a motor test or detection): spins freely. */
  lifted: boolean
  /** Commanded speed while lifted (ERPM, signed), and the sim time the command lapses. */
  test: { erpm: number; until: number; current?: number; brake?: boolean; bench?: { mode: BenchMode; value: number } } | null
  /** Sign of the last commanded spin, for the reported ERPM. */
  testSign: number
  /** Which way the wheel really turned on the last test: 1 forward, -1 backwards. */
  physicalSign: number
  /** FOC detection running: sim time it started and how long it takes. */
  detect: { start: number; dur: number } | null
  abs: { s: AbsState; p: AbsParams; beat: number } | null
  /** Rotor angle (degrees), as an encoder would report it. */
  pos: number
}

const DT = 0.01

export class VehicleSim {
  readonly p: SimParams
  speed = 0 // m/s
  soc: number
  vBat: number
  rideTime = 0
  /** Seconds simulated in total, parked or not. */
  time = 0
  /** Metres travelled since the sim started. */
  distanceM = 0
  /** Demo control: brake to a stop and stay there (so settings can be written). */
  parked = false
  /** Low grip until this sim time, so hard braking skids. */
  private wetUntil = 0
  /** The rider brakes hard until this sim time. */
  private hardBrakeUntil = 0
  private accel = 0
  private heading = 0
  private roll = 0
  private pitch = 0
  private rollRate = 0
  private pitchRate = 0
  private yawRate = 0
  private throttle = 0
  private lastMs: number | null = null
  private readonly motors: MotorState[]
  /** One-pedal regen, run by the throttle's controller (master) for itself and its followers. */
  private regen: { master: number; followers: number[]; s: RegenState; p: RegenParams; beat: number; amps: number | null } | null = null

  constructor() {
    this.p = { ...DEFAULT_SIM }
    this.soc = this.p.startSoc
    this.vBat = this.ocv()
    this.motors = Array.from({ length: this.p.motors }, (_, i) => ({
      limits: {
        motorCurrentMax: this.p.motorCurrentMax,
        motorCurrentBrake: this.p.motorCurrentBrake,
        brakeScale: 1,
        batteryCurrentMax: this.p.batteryCurrentMax,
        batteryCurrentRegen: this.p.batteryCurrentRegen,
        maxDuty: this.p.maxDuty,
        maxErpm: 1e9,
        wattMax: 1e9,
      },
      current: 0,
      batteryCurrent: 0,
      duty: 0,
      tempMotor: this.p.ambientC + 2 + i,
      tempFet: this.p.ambientC + 4 + i * 0.5,
      ah: 0,
      ahCharged: 0,
      wh: 0,
      whCharged: 0,
      tacho: 0,
      tachoAbs: 0,
      fault: 0,
      faultUntil: 0,
      wheel: 0,
      slipping: false,
      lifted: false,
      test: null,
      testSign: 1,
      physicalSign: 1,
      detect: null,
      abs: null,
      pos: (i * 137) % 360,
    }))
  }

  /** ERPM for a wheel speed (m/s). */
  erpmFor(speed: number): number {
    return (speed / (Math.PI * this.p.wheelDiameterM)) * 60 * this.p.gearRatio * (this.p.motorPoles / 2)
  }

  /**
   * Motor test with the wheel lifted: spin at this ERPM until the command lapses
   * (like the firmware's timeout). Only while the vehicle is stopped. erpm 0 releases.
   */
  setTest(motorIndex: number, erpm: number, seconds = 1, current?: number, physical = 1) {
    const m = this.motors[motorIndex]
    if (!m || m.detect) return
    if (erpm === 0 && current === undefined) {
      m.test = null
      return
    }
    if (this.speed > 0.3) return
    m.test = { erpm, until: this.time + seconds, current }
    m.lifted = true
    if (erpm !== 0) {
      m.testSign = erpm < 0 ? -1 : 1
      m.physicalSign = m.testSign * physical
    }
  }

  /**
   * COMM_SET_CURRENT_BRAKE on a lifted wheel: brake it with this current, limited
   * like the firmware by the braking limit and its live scale (which ABS changes).
   */
  setBrakeTest(motorIndex: number, amps: number, seconds = 1) {
    const m = this.motors[motorIndex]
    if (!m || m.detect || this.speed > 0.3) return
    if (amps === 0) {
      m.test = null
      return
    }
    m.test = { erpm: 0, until: this.time + seconds, current: -Math.abs(amps), brake: true }
    m.lifted = true
  }

  /**
   * Bench control with the wheel lifted: COMM_SET_CURRENT (amps, signed), _DUTY
   * (fraction, signed), _POS (degrees) or _HANDBRAKE (amps). Lapses like the
   * firmware's timeout unless repeated. Only while the vehicle is stopped.
   */
  setBench(motorIndex: number, mode: BenchMode, value: number, seconds = 1) {
    const m = this.motors[motorIndex]
    if (!m || m.detect || this.speed > 0.3 || !Number.isFinite(value)) return
    m.test = { erpm: 0, until: this.time + seconds, bench: { mode, value } }
    m.lifted = true
  }

  /** COMM_ALIVE: keeps a motor test going for another timeout period. */
  keepAlive(motorIndex: number) {
    const m = this.motors[motorIndex]
    if (m?.test) m.test.until = this.time + 1
  }

  /** Which way the wheel really turned during the last test (demo only: real wheels are watched). */
  physicalDirection(motorIndex: number): number {
    return this.motors[motorIndex]?.physicalSign ?? 1
  }

  /** FOC detection: buzz (resistance, inductance), then spin up (flux), then turn slowly (hall sensors). */
  startDetection(motorIndex: number, seconds: number) {
    const m = this.motors[motorIndex]
    if (!m || this.speed > 0.3) return
    m.detect = { start: this.time, dur: seconds }
    m.lifted = true
    m.testSign = 1
  }

  detecting(motorIndex: number): boolean {
    return !!this.motors[motorIndex]?.detect
  }

  /** Demo control: a hand on the throttle and brake (0..1), or null to follow the scripted ride. */
  handInput: { throttle: number; brake: number } | null = null

  /** The rider's throttle and brake (0..1), as the input wires would carry them. */
  inputs(): { throttle: number; brake: number } {
    if (this.handInput) return this.handInput
    return { throttle: Math.max(0, this.throttle), brake: Math.max(0, -this.throttle) }
  }

  startAbs(motorIndex: number, p: AbsParams) {
    const m = this.motors[motorIndex]
    if (!m) return
    if (m.abs) m.limits.brakeScale = m.abs.s.base
    m.abs = { s: absInit(m.limits.brakeScale), p, beat: 0 }
  }

  stopAbs(motorIndex: number) {
    const m = this.motors[motorIndex]
    if (!m?.abs) return
    m.limits.brakeScale = m.abs.s.base
    m.abs = null
  }

  absFor(motorIndex: number) {
    const a = this.motors[motorIndex]?.abs
    return a ? { on: true, interventions: a.s.interventions, beat: a.beat } : null
  }

  startRegen(master: number, followers: number[], p: RegenParams) {
    if (!this.motors[master]) return
    this.regen = { master, followers: followers.filter((f) => f !== master && !!this.motors[f]), s: regenInit(), p, beat: 0, amps: null }
  }

  stopRegen(master: number) {
    if (this.regen?.master === master) this.regen = null
  }

  /** Regen as the master's status check reports it, or null when not running there. */
  regenFor(master: number) {
    const r = this.regen
    return r && r.master === master ? { on: true, engagements: r.s.engagements, beat: r.beat, active: r.s.active } : null
  }

  /** Demo control: a wet road and a full brake, to see ABS work. False when too slow to show anything. */
  skidTest(): boolean {
    if (this.speed < 4 || this.parked) return false
    this.wetUntil = this.time + 3.5
    this.hardBrakeUntil = this.time + 2.5
    return true
  }

  limitsFor(motorIndex: number): MotorLimits {
    return { ...(this.motors[motorIndex] ?? this.motors[0]).limits }
  }

  setLimits(motorIndex: number, limits: Partial<MotorLimits>) {
    const m = this.motors[motorIndex]
    if (m) m.limits = { ...m.limits, ...limits }
  }

  /**
   * Makes a controller report a fault for a while. Like the firmware, the motor
   * output switches off until it clears. Returns false if that fault was already active.
   */
  injectFault(motorIndex: number, code: number, seconds: number): boolean {
    const m = this.motors[motorIndex]
    if (!m) return false
    const fresh = m.fault !== code
    m.fault = code
    m.faultUntil = this.time + seconds
    return fresh
  }

  faultFor(motorIndex: number): number {
    return this.motors[motorIndex]?.fault ?? 0
  }

  private ocv(): number {
    return interp(LI_ION_OCV, this.soc) * this.p.cellsSeries
  }

  private packResistance(): number {
    return (this.p.cellResistance * this.p.cellsSeries) / this.p.cellsParallel
  }

  /** Advances the simulation to wall-clock time `nowMs` (large gaps are capped). */
  advanceTo(nowMs: number) {
    if (this.lastMs === null) {
      this.lastMs = nowMs
      return
    }
    const elapsed = Math.min((nowMs - this.lastMs) / 1000, 2)
    this.lastMs = nowMs
    const steps = Math.floor(elapsed / DT)
    for (let i = 0; i < steps; i++) this.step(DT)
  }

  step(dt: number) {
    const p = this.p
    this.time += dt
    let target = 0
    let grade = 0
    if (this.parked) {
      target = this.speed > 0.3 ? -0.6 : 0
    } else {
      this.rideTime += dt
      // Scripted rider input with a little wobble.
      let t = this.rideTime % RIDE_LENGTH
      for (const [d, thr, g] of RIDE) {
        if (t < d) {
          target = thr
          grade = g
          break
        }
        t -= d
      }
      if (target > 0) target = Math.min(1, target + Math.sin(this.rideTime * 1.7) * 0.04)
      if (this.time < this.hardBrakeUntil) target = -1
    }
    this.throttle += (target - this.throttle) * Math.min(1, dt / 0.35)

    const wheelCirc = Math.PI * p.wheelDiameterM
    const vBat = this.vBat
    const kt = 60 / (2 * Math.PI * p.kv) // Nm per amp
    const g = 9.81
    const load = (p.massKg * g) / p.motors
    const mu = this.time < this.wetUntil ? GRIP_WET : GRIP_DRY

    let totalBattery = 0
    let force = 0

    // Regen on the throttle's controller, 100 times a second like the on-controller loop.
    const regen = this.regen
    if (regen) {
      const input = this.inputs()
      const erpm = this.erpmFor(this.motors[regen.master].wheel)
      regen.amps = regenStep(regen.s, regen.p, { throttle: input.throttle, lever: input.brake, erpm, outputDisabled: false })
      regen.beat = (regen.beat + 1) % 100_000
    }

    this.motors.forEach((m, i) => {
      const lim = m.limits
      if (m.fault && this.time >= m.faultUntil) m.fault = 0
      if (m.detect) {
        const t = (this.time - m.detect.start) / m.detect.dur
        if (t >= 1) {
          m.detect = null
          m.test = null
        } else {
          const [erpm, current] = t < 0.3 ? [0, 4 + 4 * Math.sign(Math.sin(this.time * 60))] : t < 0.75 ? [4200, undefined] : [900, undefined]
          m.test = { erpm, until: this.time + 0.1, current }
          m.lifted = true
        }
      }
      if (m.test && this.time >= m.test.until) m.test = null
      const motorRpm = (m.wheel / wheelCirc) * 60 * p.gearRatio
      const backEmf = motorRpm / p.kv
      const erpm = motorRpm * (p.motorPoles / 2)
      const spread = 1 + (i === 0 ? 0.015 : -0.015)

      let im: number
      const bench = m.lifted ? m.test?.bench : undefined
      if (bench) {
        im = this.benchStep(m, bench, dt, kt, vBat)
      } else if (m.lifted && m.test?.brake) {
        // Wheel in the air, braked: decelerates fast, since there's little to slow down.
        const limit = Math.abs(lim.motorCurrentBrake) * lim.brakeScale // the limit is stored negative
        im = m.wheel > 0.05 ? -Math.min(Math.abs(m.test.current ?? 0), limit) : 0
        const fBrake = (kt * im * p.gearRatio) / (p.wheelDiameterM / 2)
        m.wheel = Math.max(0, m.wheel + (fBrake / WHEEL_MASS) * dt)
      } else if (m.lifted) {
        // Wheel in the air: follow the test command, else coast down.
        const want = m.test ? Math.abs(m.test.erpm) : 0
        const wantSpeed = (want / (p.motorPoles / 2) / p.gearRatio / 60) * wheelCirc
        im = m.test?.current ?? (m.test ? Math.max(0.5, Math.min(6, (wantSpeed - m.wheel) * 4)) : 0)
        m.wheel = m.test ? m.wheel + (wantSpeed - m.wheel) * Math.min(1, dt / 0.35) : Math.max(0, m.wheel - 4 * dt)
        if (!m.test && m.wheel <= 0.05) {
          m.lifted = false
          m.wheel = this.speed
        }
      } else {
        const regenAmps = regen && regen.amps !== null && (i === regen.master || regen.followers.includes(i)) ? regen.amps : null
        im =
          regenAmps !== null
            ? m.wheel > 0.3
              ? -Math.min(regenAmps, Math.abs(lim.motorCurrentBrake) * lim.brakeScale) * spread
              : 0
            : this.throttle >= 0
              ? this.throttle * lim.motorCurrentMax * spread
              : m.wheel > 0.3
                ? -this.throttle * lim.motorCurrentBrake * lim.brakeScale * spread
                : 0
        // Duty cycle limit: can't push more current once back-EMF nears pack voltage.
        if (im > 0) {
          const imDutyLimit = Math.max(0, (lim.maxDuty * vBat - backEmf) / p.motorResistance)
          im = Math.min(im, imDutyLimit)
          // Speed limit (max ERPM): the push fades out over the last 5 %.
          if (erpm > lim.maxErpm * 0.95) im *= Math.max(0, Math.min(1, (lim.maxErpm - erpm) / (0.05 * lim.maxErpm)))
        }
      }

      const batteryMax = Math.min(lim.batteryCurrentMax, lim.wattMax / Math.max(1, vBat))
      let ib = (im * backEmf + im * im * p.motorResistance) / vBat
      for (let k = 0; k < 3; k++) {
        if (ib > batteryMax) im *= batteryMax / ib
        else if (ib < lim.batteryCurrentRegen) im *= lim.batteryCurrentRegen / ib
        else break
        ib = (im * backEmf + im * im * p.motorResistance) / vBat
      }

      // Real controllers ramp current rather than jumping. A fault switches the output off at once.
      im = m.fault ? 0 : m.current + (im - m.current) * Math.min(1, dt / 0.04)
      ib = (im * backEmf + im * im * p.motorResistance) / vBat
      const duty = Math.max(-lim.maxDuty, Math.min(lim.maxDuty, (backEmf + im * p.motorResistance) / vBat))
      m.current = im
      m.batteryCurrent = ib
      m.duty = m.fault || (im === 0 && m.wheel < 0.05) ? 0 : duty
      totalBattery += ib

      // Tyre: grips up to mu x load, then slides with a little less.
      if (!m.lifted) {
        const fMotor = (kt * im * p.gearRatio) / (p.wheelDiameterM / 2)
        if (!m.slipping && Math.abs(fMotor) > mu * load) m.slipping = true
        if (m.slipping) {
          const rel = m.wheel - this.speed
          const fr = mu * 0.8 * load * (rel > 0.01 ? 1 : rel < -0.01 ? -1 : Math.sign(fMotor))
          force += fr
          m.wheel = Math.max(0, m.wheel + ((fMotor - fr) / WHEEL_MASS) * dt)
          if (Math.abs(m.wheel - this.speed) < 0.15 && Math.abs(fMotor) <= mu * load) m.slipping = false
        } else {
          force += fMotor
        }
      }

      // ABS on this controller: 100 times a second, like the on-controller loop.
      if (m.abs) {
        lim.brakeScale = absStep(m.abs.s, m.abs.p, erpm, im, lim.brakeScale)
        m.abs.beat = (m.abs.beat + 1) % 100_000
      }

      // Energy counters (per controller, like the firmware).
      const ah = (ib * dt) / 3600
      if (ah >= 0) {
        m.ah += ah
        m.wh += ah * vBat
      } else {
        m.ahCharged -= ah
        m.whCharged -= ah * vBat
      }

      // Rotor angle, for position readouts (position control moves it itself).
      if (bench?.mode !== 'pos') m.pos = (((m.pos + (motorRpm / 60) * 360 * dt * (m.lifted ? m.testSign : 1)) % 360) + 360) % 360

      // Tachometer: 6 counts per electrical revolution.
      const counts = (erpm / 60) * dt * 6 * (m.lifted ? m.testSign : 1)
      m.tacho += counts
      m.tachoAbs += Math.abs(counts)

      // Heat: simple first-order models.
      const motorLoss = im * im * p.motorResistance * 1.4
      m.tempMotor += dt * (motorLoss / 1200 - (m.tempMotor - p.ambientC) / 500)
      const fetLoss = im * im * 0.01 + 2
      m.tempFet += dt * (fetLoss / 150 - (m.tempFet - p.ambientC) / 120)
    })

    // Road load and motion.
    const rolling = this.speed > 0.05 ? p.crr * p.massKg * g : 0
    const aero = 0.5 * 1.2 * p.cda * this.speed * this.speed
    const slope = p.massKg * g * grade
    const accel = (force - rolling - aero - slope) / p.massKg
    this.speed = Math.max(0, this.speed + accel * dt)
    this.distanceM += this.speed * dt
    // Parked: the rider holds the brake lever / puts a foot down below walking pace.
    if (this.parked && this.speed <= 0.3) this.speed = Math.max(0, this.speed - 1.5 * dt)
    for (const m of this.motors) if (!m.slipping && !m.lifted) m.wheel = this.speed
    // Battery.
    const packAh = p.cellAh * p.cellsParallel
    this.soc = Math.max(0, Math.min(1, this.soc - (totalBattery * dt) / 3600 / packAh))
    // Filtered so the duty limit and voltage sag don't feed back into an oscillation.
    const vTarget = this.ocv() - totalBattery * this.packResistance()
    this.vBat += (vTarget - this.vBat) * Math.min(1, dt / 0.08)

    // Orientation for the IMU: lean into gentle scripted turns, pitch with the road.
    const turn = this.speed > 0.5 && !this.parked ? 0.22 * Math.sin(this.time * 0.19) + 0.08 * Math.sin(this.time * 0.53) : 0
    const roll = this.roll + (Math.atan((this.speed * turn) / g) - this.roll) * Math.min(1, dt / 0.3)
    const pitch = this.pitch + (Math.atan(grade) - this.pitch) * Math.min(1, dt / 0.6)
    this.rollRate = (roll - this.roll) / dt
    this.pitchRate = (pitch - this.pitch) / dt
    this.roll = roll
    this.pitch = pitch
    this.yawRate = turn
    this.heading = Math.atan2(Math.sin(this.heading + turn * dt), Math.cos(this.heading + turn * dt))
    this.accel = accel
  }

  /** One step of a lifted wheel under bench control. Returns the motor current (A, signed). */
  private benchStep(m: MotorState, b: { mode: BenchMode; value: number }, dt: number, kt: number, vBat: number): number {
    const p = this.p
    const lim = m.limits
    const wheelCirc = Math.PI * p.wheelDiameterM
    const maxI = lim.motorCurrentMax
    const clampI = (i: number) => Math.max(-maxI, Math.min(maxI, i))
    const w = m.wheel * m.testSign // signed wheel speed (m/s)
    const rpm = (w / wheelCirc) * 60 * p.gearRatio
    const emf = rpm / p.kv

    if (b.mode === 'pos') {
      // Turns the shortest way to the angle at up to two turns a second, then holds.
      const err = ((((b.value - m.pos) % 360) + 540) % 360) - 180
      const move = Math.max(-720 * dt, Math.min(720 * dt, err))
      m.pos = (((m.pos + move) % 360) + 360) % 360
      const ws = (move / dt / 360) * (wheelCirc / p.gearRatio)
      m.wheel = Math.abs(ws)
      if (ws !== 0) m.testSign = ws < 0 ? -1 : 1
      return clampI(err * 0.15 + Math.sign(err) * 0.8)
    }

    let im: number
    if (b.mode === 'current') {
      im = clampI(b.value)
      // The push fades as back-EMF nears the pack voltage, and near the speed limit.
      if (im !== 0 && (w === 0 || Math.sign(im) === Math.sign(w))) {
        const headroom = Math.max(0, (lim.maxDuty * vBat - Math.abs(emf)) / p.motorResistance)
        im = Math.sign(im) * Math.min(Math.abs(im), headroom)
        const erpm = Math.abs(rpm) * (p.motorPoles / 2)
        if (erpm > lim.maxErpm * 0.95) im *= Math.max(0, Math.min(1, (lim.maxErpm - erpm) / (0.05 * lim.maxErpm)))
      }
    } else if (b.mode === 'duty') {
      const duty = Math.max(-lim.maxDuty, Math.min(lim.maxDuty, b.value))
      im = clampI((duty * vBat - emf) / p.motorResistance)
    } else {
      // Handbrake: stops the wheel, then holds it with current.
      if (Math.abs(w) <= 0.02) {
        m.wheel = 0
        return Math.min(Math.abs(b.value), maxI)
      }
      im = -Math.sign(w) * Math.min(Math.abs(b.value), maxI)
    }

    // Bearings and air: a free wheel coasts down slowly.
    const drag = Math.sign(w) * Math.min(Math.abs(w) / dt, 0.4 + 0.015 * w * w)
    const force = (kt * im * p.gearRatio) / (p.wheelDiameterM / 2)
    let next = w + (force / WHEEL_MASS - drag) * dt
    if (b.mode === 'handbrake' && Math.sign(next) !== Math.sign(w)) next = 0
    m.wheel = Math.abs(next)
    if (next !== 0) m.testSign = next < 0 ? -1 : 1
    return im
  }

  /** What the controller's IMU reports (radians, g, degrees per second). */
  imu(): ImuData {
    const g = 9.81
    const d = emptyImu()
    const moving = this.speed > 0.3
    // Road buzz on the accelerometer and gyro while rolling.
    const buzz = (f: number, a: number) => (moving ? a * Math.sin(this.time * f) : 0)
    const lateral = (this.speed * this.yawRate) / g
    d.roll = this.roll
    d.pitch = this.pitch
    d.yaw = this.heading
    d.accX = this.accel / g + Math.sin(this.pitch) + buzz(31, 0.015)
    d.accY = lateral * Math.cos(this.roll) - Math.sin(this.roll) * Math.cos(this.pitch) + buzz(43, 0.012)
    d.accZ = Math.cos(this.pitch) * Math.cos(this.roll) + lateral * Math.sin(this.roll) + buzz(47, 0.03) + buzz(83, 0.015)
    const deg = 180 / Math.PI
    d.gyroX = this.rollRate * deg + buzz(57, 0.6)
    d.gyroY = this.pitchRate * deg + buzz(61, 0.5)
    d.gyroZ = this.yawRate * deg + buzz(37, 0.3)
    d.magX = 0.2 * Math.cos(this.heading)
    d.magY = -0.2 * Math.sin(this.heading)
    d.magZ = -0.42
    // Quaternion from roll, pitch, yaw (ZYX order).
    const [cr, sr] = [Math.cos(this.roll / 2), Math.sin(this.roll / 2)]
    const [cp, sp] = [Math.cos(this.pitch / 2), Math.sin(this.pitch / 2)]
    const [cy, sy] = [Math.cos(this.heading / 2), Math.sin(this.heading / 2)]
    d.q0 = cr * cp * cy + sr * sp * sy
    d.q1 = sr * cp * cy - cr * sp * sy
    d.q2 = cr * sp * cy + sr * cp * sy
    d.q3 = cr * cp * sy - sr * sp * cy
    return d
  }

  /** Telemetry as one controller would report it. */
  valuesFor(motorIndex: number, controllerId: number): Values {
    const m = this.motors[motorIndex] ?? this.motors[0]
    const p = this.p
    const motorRpm = (m.wheel / (Math.PI * p.wheelDiameterM)) * 60 * p.gearRatio * (m.lifted ? m.testSign : 1)
    const v = emptyValues()
    v.tempFet = m.tempFet
    v.tempMotor = m.tempMotor
    v.currentMotor = m.current
    v.currentIn = m.batteryCurrent
    v.id = this.speed > 8 ? -Math.min(4, (this.speed - 8) * 0.8) : 0
    v.iq = m.current
    v.dutyNow = m.duty
    v.rpm = motorRpm * (p.motorPoles / 2)
    v.vIn = this.vBat
    v.ampHours = m.ah
    v.ampHoursCharged = m.ahCharged
    v.wattHours = m.wh
    v.wattHoursCharged = m.whCharged
    v.tachometer = Math.round(m.tacho)
    v.tachometerAbs = Math.round(m.tachoAbs)
    v.fault = m.fault
    v.pidPos = m.pos
    v.controllerId = controllerId
    v.tempMos1 = m.tempFet
    v.tempMos2 = m.tempFet + 0.4
    v.tempMos3 = m.tempFet - 0.3
    v.vd = v.id * p.motorResistance
    v.vq = m.duty * this.vBat * 0.95
    v.status = 0
    return v
  }
}
