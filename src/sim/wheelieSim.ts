// A scooter and its rider seen from the side, for trying the auto-wheelie
// program without risking anyone: the rear wheel, a body (scooter and rider
// together) that pivots on the rear axle, both hub motors, the throttle app,
// the brakes and the IMU. It runs the real LispBM program (wheelie.lisp) in the
// LispBM runner, with the firmware's functions provided here.
//
// The physics is a cart and an inverted pendulum. Driving the rear wheel
// pushes the scooter forward and twists the body nose-up; gravity pulls the
// nose down, more the further the centre of mass sits ahead of the rear axle.
// Leaning back moves the centre of mass back, so holding the same angle takes
// less push, and so less acceleration: that's how the rider sets the speed.

import { Interp, LispError, NIL, T, toNum, type Closure, type Env, type Val } from '../onboard/lispbm'

const G = 9.81
const DEG = Math.PI / 180

export interface Scooter {
  /** kg: scooter and rider. */
  mass: number
  /** kg m²: the pair's pitch inertia about their centre of mass. */
  inertia: number
  /** m: centre of mass above the rear axle, rider standing upright. */
  comHeight: number
  /** m: centre of mass ahead of the rear axle, rider standing upright. */
  comAhead: number
  /** m: from axle to axle. */
  wheelbase: number
  wheelRadius: number
  /** kg m²: each wheel's spin inertia (hub motor and tyre). */
  wheelInertia: number
  /** Nm per A of motor current. */
  kt: number
  /** A: each motor's current limit. */
  motorMax: number
  /** m/s: where the motors run out of voltage. */
  topSpeed: number
  /** Motor poles, for ERPM. */
  poles: number
  /** deg: how far the deck tips nose-up when the rider stands on it (rear suspension). */
  sag: number
  /** V at rest, and the battery's resistance. */
  batteryVolts: number
  batteryOhms: number
  /** s: the throttle app's ramp from nothing to full, and back. */
  rampUp: number
  rampDown: number
  /** s: how long a controller keeps a command it was sent before letting go. */
  commandTimeout: number
}

/** A dual-motor 10-inch scooter with a 85 kg rider. */
export const SCOOTER: Scooter = {
  mass: 110,
  inertia: 15,
  comHeight: 0.85,
  comAhead: 0.4,
  wheelbase: 1.1,
  wheelRadius: 0.127,
  wheelInertia: 0.08,
  kt: 0.6,
  motorMax: 55,
  topSpeed: 12,
  poles: 30,
  sag: 1.5,
  batteryVolts: 50,
  batteryOhms: 0.08,
  rampUp: 0.3,
  rampDown: 0.1,
  commandTimeout: 0.25,
}

/** m/s of wheel speed per ERPM. */
export const metersPerErpm = (s: Scooter) => (2 * Math.PI * s.wheelRadius) / 60 / (s.poles / 2)

export interface Rider {
  /** 0..1. */
  throttle: number
  /** m: the centre of mass moved forward (+) or back (-) by leaning. */
  lean: number
  /** Nm of brake torque on each wheel. */
  rearBrake: number
  frontBrake: number
  /** deg: the scooter leaning to one side, and deg/s turning. */
  roll: number
  yawRate: number
  /** Standing on the deck (it sags under the rider). */
  onBoard: boolean
}

export interface Faults {
  /** The IMU keeps sending its last reading. */
  imuFrozen?: boolean
  /** No IMU: zeros. */
  imuMissing?: boolean
  /** The other controller stops reporting over CAN. */
  canQuiet?: boolean
  /** The rear wheel breaks traction. */
  rearSpin?: boolean
  /** A controller fault code. */
  faultCode?: number
  /** °C. */
  fetTemp?: number
  /** s the wheelie loop is held up once (a stuck thread). */
  stall?: number
}

/** Which controller drives which wheel: -1 the one running the program, an ID for one on CAN, -2 none. */
export interface Wiring {
  rear: number
  front: number
}

type Wheel = 'rear' | 'front'

interface Command {
  kind: 'current' | 'brake'
  amps: number
  at: number
}

interface Motor {
  /** What the program last told it, kept until the controller's command timeout. */
  cmd: Command | null
  /** The throttle app's ramped current. */
  app: number
  /** A, signed: negative while braking. */
  amps: number
  /** Nm on the wheel, forward positive. */
  torque: number
  /** A from the battery. */
  ampsIn: number
}

interface LispThread {
  name: string
  cond: Val
  body: Val[]
  env: Env
  nextAt: number
  stalled: boolean
}

export interface Sample {
  t: number
  /** deg, nose up from riding level. */
  pitch: number
  /** m/s. */
  speed: number
  rearAmps: number
  frontAmps: number
  state: number
  throttle: number
  lean: number
  /** deg: the pitch the program believes. */
  seen: number
}

/** A seeded random source, so runs repeat exactly. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type M3 = number[][]
type V3 = [number, number, number]
const rotX = (a: number): M3 => [
  [1, 0, 0],
  [0, Math.cos(a), -Math.sin(a)],
  [0, Math.sin(a), Math.cos(a)],
]
const rotY = (a: number): M3 => [
  [Math.cos(a), 0, Math.sin(a)],
  [0, 1, 0],
  [-Math.sin(a), 0, Math.cos(a)],
]
const rotZ = (a: number): M3 => [
  [Math.cos(a), -Math.sin(a), 0],
  [Math.sin(a), Math.cos(a), 0],
  [0, 0, 1],
]
export const mul = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]))
export const apply = (m: M3, v: V3): V3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V3
const transpose = (m: M3): M3 => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]])

/**
 * How the IMU sits in the scooter: a rotation taking the scooter's axes
 * (forward, left, up) into the IMU's, from turns (deg) about up, then forward,
 * then left.
 */
export function mounting(yawDeg: number, rollDeg: number, pitchDeg: number): M3 {
  return transpose(mul(rotZ(yawDeg * DEG), mul(rotX(rollDeg * DEG), rotY(pitchDeg * DEG))))
}

export interface WheelieSimOptions {
  scooter?: Scooter
  wiring?: Wiring
  /** The IMU's mounting; level and facing forward if left out. */
  mount?: M3
  /** deg/s the gyro reads at rest. */
  gyroBias?: V3
  /** m/s to start at. */
  speed?: number
  seed?: number
}

export class WheelieSim {
  readonly scooter: Scooter
  readonly wiring: Wiring
  readonly lisp: Interp
  readonly rider: Rider = { throttle: 0, lean: 0, rearBrake: 0, frontBrake: 0, roll: 0, yawRate: 0, onBoard: true }
  readonly faults: Faults = {}

  t = 0
  /** m/s forward. */
  v = 0
  /** rad, nose up from both wheels down. */
  theta = 0
  /** rad/s. */
  omega = 0
  /** m/s: the front wheel's surface speed (its own while in the air). */
  vf = 0
  grounded = true
  /** Held still by hand (for calibrating): nothing moves until it's put down. */
  held = false
  /** Set when the nose went past where anyone could hold on. */
  loopedOut = false
  /** deg/s the nose was falling when the front wheel touched down, for each landing. */
  readonly landings: number[] = []
  /** Seconds the throttle app was disabled for, set by app-disable-output. */
  private appOffUntil = 0
  private appWasOff = false
  readonly motors: Record<Wheel, Motor> = {
    rear: { cmd: null, app: 0, amps: 0, torque: 0, ampsIn: 0 },
    front: { cmd: null, app: 0, amps: 0, torque: 0, ampsIn: 0 },
  }
  private rearSlip = 0
  private accel = 0
  private peak = 0
  private rollPrev = 0
  private rollRate = 0
  private canQuietSince: number | null = null
  private frozen: { gyro: V3; acc: V3 } | null = null
  private readonly mount: M3
  private readonly gyroBias: V3
  private readonly rand: () => number
  private threads: LispThread[] = []
  private sleepAsked: number | null = null
  /** Tones played: frequency and when. */
  readonly tones: { t: number; hz: number }[] = []
  /** Custom app data the program sent. */
  readonly sent: { t: number; data: Uint8Array }[] = []
  /** Every 10 ms. */
  readonly log: Sample[] = []
  /** The most eval steps one run of a thread's loop took. */
  maxSteps = 0

  constructor(opts: WheelieSimOptions = {}) {
    this.scooter = opts.scooter ?? SCOOTER
    this.wiring = opts.wiring ?? { rear: -1, front: 1 }
    this.mount = opts.mount ?? mounting(0, 0, 0)
    this.gyroBias = opts.gyroBias ?? [0, 0, 0]
    this.rand = random(opts.seed ?? 1)
    this.v = this.vf = opts.speed ?? 0
    this.lisp = new Interp({ host: this.host() })
  }

  /** Loads a program, as the controller does with its stored script at power-up. */
  load(program: string) {
    this.lisp.run(program)
  }

  /** One console command. */
  repl(code: string): Val {
    return this.lisp.run(code)
  }

  /** deg, nose up from riding level, as the scooter is. */
  get pitchDeg() {
    return this.theta / DEG
  }

  get kmh() {
    return this.v * 3.6
  }

  /** A global of the program, as a number. */
  num(name: string) {
    return this.lisp.num(name)
  }

  /** The front wheel lifted by hand, for calibrating. */
  pose(pitchDeg: number) {
    this.theta = pitchDeg * DEG
    this.omega = 0
    this.v = 0
    this.accel = 0
    this.grounded = pitchDeg <= 0
    this.held = pitchDeg > 0
  }

  /** Runs time forward: physics every millisecond, the program's threads as they ask. */
  advance(seconds: number, each?: (sim: WheelieSim) => void) {
    const dt = 0.001
    const end = this.t + seconds - dt / 2
    while (this.t < end) {
      each?.(this)
      this.physics(dt)
      this.t += dt
      this.runThreads()
      if (Math.round(this.t * 1000) % 10 === 0) this.sample()
    }
  }

  /** Runs until the test is true or the time is up; returns whether it came true. */
  until(test: (sim: WheelieSim) => boolean, maxSeconds: number, each?: (sim: WheelieSim) => void): boolean {
    const end = this.t + maxSeconds
    while (this.t < end) {
      if (test(this)) return true
      this.advance(0.01, each)
    }
    return test(this)
  }

  get threadCount() {
    return this.threads.length
  }

  private sample() {
    const state = this.lisp.get('wl-state')
    const seen = this.lisp.get('wl-pitch')
    this.log.push({
      t: Number(this.t.toFixed(3)),
      pitch: this.pitchDeg,
      speed: this.v,
      rearAmps: this.motors.rear.amps,
      frontAmps: this.motors.front.amps,
      state: state === undefined ? -1 : toNum(state),
      throttle: this.rider.throttle,
      lean: this.rider.lean,
      seen: seen === undefined ? 0 : toNum(seen),
    })
  }

  // ---- The program's threads ----

  private runThreads() {
    for (const th of [...this.threads]) {
      if (th.nextAt > this.t + 1e-9) continue
      if (this.faults.stall && th.name === 'wheelie' && !th.stalled) {
        th.stalled = true
        th.nextAt = this.t + this.faults.stall
        continue
      }
      this.sleepAsked = null
      const go = this.lisp.evalIn(th.cond, th.env)
      let steps = this.lisp.lastSteps
      if (go === NIL) {
        this.threads = this.threads.filter((x) => x !== th)
        continue
      }
      for (const f of th.body) {
        this.lisp.evalIn(f, th.env)
        steps += this.lisp.lastSteps
      }
      this.maxSteps = Math.max(this.maxSteps, steps)
      if (this.sleepAsked === null) throw new LispError(`The thread "${th.name}" loops without sleeping: it would starve the controller.`)
      th.nextAt = this.t + Math.max(this.sleepAsked, 0.001)
    }
  }

  // ---- Physics ----

  private appOn() {
    return this.appOffUntil >= 0 && this.t >= this.appOffUntil
  }

  private motorAmps(wheel: Wheel, dt: number): number {
    const s = this.scooter
    const m = this.motors[wheel]
    if (wheel === 'front' && this.wiring.front === -2) return 0
    const want = Math.max(0, Math.min(1, this.rider.throttle)) * s.motorMax
    if (this.appOn()) {
      // The throttle app's ramp freezes while it's off and jumps to the throttle when it comes back.
      if (this.appWasOff) m.app = want
      const rate = (s.motorMax / (want > m.app ? s.rampUp : s.rampDown)) * dt
      m.app += Math.max(-rate, Math.min(rate, want - m.app))
      m.cmd = null
      return m.app
    }
    const c = m.cmd
    if (!c || this.t - c.at > s.commandTimeout) return 0
    return c.kind === 'brake' ? -c.amps : c.amps
  }

  /** Nm a motor puts on its wheel for a current, with braking against the way the wheel turns. */
  private torqueFor(amps: number, speed: number): number {
    const s = this.scooter
    if (amps >= 0) {
      const a = Math.min(amps, s.motorMax)
      const duty = Math.abs(speed) / s.topSpeed
      return s.kt * a * Math.max(0, Math.min(1, (0.97 - duty) / 0.12))
    }
    return -Math.sign(speed) * s.kt * Math.min(-amps, s.motorMax) * Math.min(1, Math.abs(speed) / 0.3)
  }

  private physics(dt: number) {
    if (this.loopedOut || this.held) return
    const s = this.scooter
    const r = this.rider
    const R = s.wheelRadius
    const rearSpeed = this.v + this.rearSlip

    const rearA = this.motorAmps('rear', dt)
    const frontA = this.motorAmps('front', dt)
    this.appWasOff = !this.appOn()
    const rm = this.motors.rear
    const fm = this.motors.front
    rm.amps = rearA
    fm.amps = frontA
    rm.torque = this.torqueFor(rearA, rearSpeed)
    fm.torque = this.torqueFor(frontA, this.vf)

    const brake = (nm: number, speed: number) => -Math.sign(speed) * nm * Math.min(1, Math.abs(speed) / 0.3)
    const tauR = rm.torque + brake(r.rearBrake, rearSpeed)
    const tauF = fm.torque + brake(r.frontBrake, this.vf)

    // Battery: what the motors turn into motion, plus losses; braking gives some back.
    const vin = this.vin()
    const power = (tq: number, speed: number) => (tq * speed) / R
    for (const [m, speed] of [
      [rm, rearSpeed],
      [fm, this.vf],
    ] as const) {
      const p = power(m.torque, speed)
      m.ampsIn = p >= 0 ? p / vin / 0.88 + Math.abs(m.amps) * 0.02 : (p * 0.8) / vin
    }

    if (this.faults.rearSpin && tauR > 0) {
      this.rearSlip += 25 * dt
    } else this.rearSlip = Math.max(0, this.rearSlip - 25 * dt)

    const m = s.mass
    const d = s.comAhead + r.lean
    const h = s.comHeight
    const L = Math.hypot(d, h)
    const phi = Math.atan2(h, d) + this.theta
    const J = s.inertia + m * L * L
    const drag = Math.sign(this.v) * (0.012 * m * G) + 0.5 * 1.2 * 0.5 * this.v * this.v
    const wheelMass = s.wheelInertia / (R * R)
    const k = m * L * Math.sin(phi)
    const gravity = m * G * L * Math.cos(phi)
    const mu = 0.9
    let vdot = 0
    let wdot = 0
    let frontSpin: number | null = null
    if (this.grounded) {
      // Both wheels down: the body can't pitch, and the ground pushes up on the
      // front wheel with whatever moment that takes. Both motors twist the body
      // nose-up; the front one only pushes the scooter along while its tyre grips.
      const M = m + 2 * wheelMass
      vdot = ((tauR + tauF) / R - drag) / M
      let up = (gravity - k * vdot - tauR - tauF) / s.wheelbase
      if (Math.abs(tauF / R) > mu * Math.max(0, up)) {
        // The front tyre slips (or is about to leave the ground): it grips with what weight it has.
        const sign = Math.sign(tauF) || 1
        up = (gravity - (k * (tauR / R - drag)) / M - tauR - tauF) / s.wheelbase / (1 + (sign * k * mu) / (M * s.wheelbase))
        const grip = sign * mu * Math.max(0, up)
        vdot = (tauR / R + grip - drag) / M
        frontSpin = (R * (tauF - grip * R)) / s.wheelInertia
      }
      if (up < 0) this.grounded = false
    }
    if (!this.grounded) {
      const M = m + wheelMass
      const a = tauR / R - drag + m * L * Math.cos(phi) * this.omega * this.omega
      const b = tauR + tauF - gravity
      const det = M * J - k * k
      vdot = (a * J + k * b) / det
      wdot = (M * b + k * a) / det
      // The front wheel spins on its own.
      frontSpin = (R * (tauF - 0.3 * Math.sign(this.vf))) / s.wheelInertia
    }
    this.accel = vdot
    this.v += vdot * dt
    if (this.v < 0) this.v = 0
    if (!this.grounded) {
      this.omega += wdot * dt
      this.theta += this.omega * dt
      this.peak = Math.max(this.peak, this.theta)
      if (this.theta <= 0) {
        // A landing counts once the nose was really up; shuffling at the ground doesn't.
        if (this.peak > 1 * DEG) this.landings.push(-this.omega / DEG)
        this.peak = 0
        this.theta = 0
        this.omega = 0
        this.grounded = true
      }
      if (this.theta > 60 * DEG) this.loopedOut = true
    }
    if (this.grounded && frontSpin === null) this.vf = this.v
    else if (frontSpin !== null) this.vf = Math.max(0, this.vf + frontSpin * dt)
    // Touching down, the front tyre is brought to road speed.
    if (this.grounded && this.landings.length && this.vf < this.v) this.vf = this.v

    this.rollRate = (r.roll - this.rollPrev) / dt
    this.rollPrev = r.roll
    this.canQuietSince = this.faults.canQuiet ? (this.canQuietSince ?? this.t) : null
  }

  private vin() {
    const draw = this.motors.rear.ampsIn + this.motors.front.ampsIn
    return this.scooter.batteryVolts - this.scooter.batteryOhms * draw
  }

  // ---- The IMU ----

  /** Gravity and acceleration (g) and turning (deg/s), in the IMU's own axes. */
  imu(): { gyro: V3; acc: V3 } {
    if (this.faults.imuMissing) return { gyro: [0, 0, 0], acc: [0, 0, 0] }
    if (this.faults.imuFrozen && this.frozen) return this.frozen
    const r = this.rider
    const deck = this.theta + (r.onBoard ? this.scooter.sag * DEG : 0)
    // The scooter's axes in the world: pitched nose-up, then leaning.
    const body = mul(rotY(-deck), rotX(r.roll * DEG))
    const toBody = transpose(body)
    const lateral = (this.v * r.yawRate * DEG) / G
    const accBody = apply(toBody, [this.accel / G, lateral, 1])
    const gyroBody: V3 = [this.rollRate, -this.omega / DEG, r.yawRate]
    const noise = (k: number) => (this.rand() - 0.5) * 2 * k
    const acc = apply(this.mount, accBody).map((x) => x + noise(0.003)) as V3
    const gyro = apply(this.mount, gyroBody).map((x, i) => x + this.gyroBias[i] + noise(0.08)) as V3
    this.frozen = { gyro, acc }
    return { gyro, acc }
  }

  // ---- The firmware's functions ----

  private host(): Record<string, (...a: Val[]) => Val> {
    const f = (x: number): Val => x
    const list = (xs: number[]): Val => xs.map((x) => x)
    const erpm = (speed: number) => speed / metersPerErpm(this.scooter)
    const wheelOf = (id: number): Wheel | null => (this.wiring.rear === id ? 'rear' : this.wiring.front === id ? 'front' : null)
    const canWheel = (id: Val) => {
      const w = wheelOf(Number(toNum(id)))
      if (w && this.faults.canQuiet) return { wheel: w, quiet: true }
      return w ? { wheel: w, quiet: false } : null
    }
    const speedOf = (w: Wheel) => (w === 'rear' ? this.v + this.rearSlip : this.vf)
    const command = (w: Wheel | null, kind: Command['kind'], amps: Val) => {
      if (!w) return T
      const a = toNum(amps)
      if (kind === 'current' && a < 0) throw new LispError('set-current with a negative current would drive backwards.')
      this.motors[w].cmd = { kind, amps: a, at: this.t }
      return T
    }
    const temp = () => this.faults.fetTemp ?? 40
    return {
      systime: () => BigInt(Math.floor(this.t * 10000)),
      'secs-since': (ts) => f(this.t - Number(ts) / 10000),
      sleep: (secs) => {
        this.sleepAsked = toNum(secs)
        return T
      },
      spawn: (...args) => {
        const fn = args.find((a): a is Closure => typeof a === 'object' && !Array.isArray(a) && !(a instanceof Uint8Array) && 'kind' in a && a.kind === 'closure')
        if (!fn) throw new LispError('spawn needs a function.')
        const loop = fn.body[0]
        if (fn.params.length || fn.body.length !== 1 || !Array.isArray(loop) || String(loop[0]) !== 'loopwhile')
          throw new LispError('This runner only runs threads of the form (lambda () (loopwhile test body...)).')
        const name = typeof args[0] === 'string' ? args[0] : 'thread'
        this.threads.push({ name, cond: loop[1], body: loop.slice(2), env: fn.env, nextAt: this.t, stalled: false })
        return BigInt(this.threads.length)
      },
      'get-imu-gyro': () => list(this.imu().gyro),
      'get-imu-acc': () => list(this.imu().acc),
      'get-adc-decoded': () => f(Math.max(0, Math.min(1, this.rider.throttle))),
      'get-ppm': () => f(Math.max(0, Math.min(1, this.rider.throttle))),
      'get-rpm': () => {
        const w = wheelOf(-1)
        return f(w ? erpm(speedOf(w)) : 0)
      },
      'canget-rpm': (id) => {
        const c = canWheel(id)
        return f(c && !c.quiet ? erpm(speedOf(c.wheel)) : 0)
      },
      'get-current': () => f(this.motors[wheelOf(-1) ?? 'rear'].amps),
      'canget-current': (id) => {
        const c = canWheel(id)
        return f(c ? this.motors[c.wheel].amps : 0)
      },
      'get-current-in': () => f(this.motors[wheelOf(-1) ?? 'rear'].ampsIn),
      'canget-current-in': (id) => {
        const c = canWheel(id)
        return f(c ? this.motors[c.wheel].ampsIn : 0)
      },
      'get-vin': () => f(this.vin()),
      'get-fault': () => BigInt(this.faults.faultCode ?? 0),
      'get-temp-fet': () => f(temp()),
      'canget-temp-fet': () => f(temp()),
      'get-temp-mot': () => f(45),
      'canget-temp-motor': () => f(45),
      'can-msg-age': (id) => {
        const c = canWheel(id)
        if (!c) return NIL
        return f(this.canQuietSince === null ? 0.01 : this.t - this.canQuietSince + 0.01)
      },
      'set-current': (amps) => command(wheelOf(-1), 'current', amps),
      'set-brake': (amps) => command(wheelOf(-1), 'brake', amps),
      'canset-current': (id, amps) => command(canWheel(id)?.wheel ?? null, 'current', amps),
      'canset-brake': (id, amps) => command(canWheel(id)?.wheel ?? null, 'brake', amps),
      'app-disable-output': (ms) => {
        const n = toNum(ms)
        this.appOffUntil = n === 0 ? this.t : n < 0 ? -1 : this.t + n / 1000
        return T
      },
      'foc-play-tone': (_ch, hz) => {
        this.tones.push({ t: this.t, hz: toNum(hz) })
        return T
      },
      'foc-play-stop': () => T,
      'send-data': (data) => {
        if (!(data instanceof Uint8Array)) throw new LispError('send-data: this program sends byte arrays.')
        this.sent.push({ t: this.t, data: data.slice() })
        return T
      },
    }
  }
}
