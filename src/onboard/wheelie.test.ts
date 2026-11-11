import { describe, expect, it } from 'vitest'
import { apply, metersPerErpm, mounting, WheelieSim, type WheelieSimOptions } from '../sim/wheelieSim'
import { read, showValue, Sym, type Val } from './lispbm'
import {
  calibrationFrom,
  decodeWheelieTelemetry,
  parseImuAverage,
  parsePeek,
  parseWheelieStatus,
  scriptSettingNames,
  WHEELIE_CAL_READ,
  WHEELIE_CAL_START,
  WHEELIE_DEFAULTS,
  WHEELIE_FIELDS,
  WHEELIE_LISP,
  WHEELIE_OFF_PROGRAM,
  WHEELIE_PEEK_PROGRAM,
  WHEELIE_STATUS_PROGRAM,
  WHEELIE_TELEMETRY_PROGRAM,
  WHEELIE_VERSION,
  wheelieArmCommands,
  wheelieLispName,
  wheelieProgram,
  wheelieSettingsProblem,
  type ImuAverage,
  type Vec3,
  type WheelieCalibration,
  type WheelieSettings,
  type WheelieWiring,
} from './wheelie'
import { MAX_CMD } from './lisp'

const S = { off: 0, armed: 1, lifting: 2, holding: 3, catching: 4, landing: 5, waiting: 6, fault: 7 }

const straight = (zero: number): WheelieCalibration => ({ forward: [1, 0, 0], up: [0, 0, 1], side: [0, -1, 0], gyroBias: [0, 0, 0], zero, at: 0, device: 'test' })

interface Rig {
  sim: WheelieSim
  settings: WheelieSettings
  wiring: WheelieWiring
  arm: (runId?: number) => void
  state: () => number
  reason: () => number
}

function rig(opts: { settings?: Partial<WheelieSettings>; sim?: WheelieSimOptions; cal?: WheelieCalibration } = {}): Rig {
  const sim = new WheelieSim({ speed: 14 / 3.6, ...opts.sim })
  const wiring: WheelieWiring = { rear: sim.wiring.rear, front: sim.wiring.front, input: 0, speedPerErpm: metersPerErpm(sim.scooter), handbackWait: 0.5 }
  const settings = { ...WHEELIE_DEFAULTS, ...opts.settings }
  expect(wheelieSettingsProblem(settings)).toBeNull()
  const cal = opts.cal ?? straight(sim.scooter.sag)
  sim.load(wheelieProgram(settings, cal, wiring))
  return {
    sim,
    settings,
    wiring,
    arm: (runId = 7) => {
      for (const c of wheelieArmCommands(settings, cal, wiring, runId)) sim.repl(c)
    },
    state: () => sim.num('wl-state'),
    reason: () => sim.num('wl-reason'),
  }
}

interface Plan {
  throttle?: number
  lean?: number
  rearBrake?: number
  frontBrake?: number
  roll?: number
  yawRate?: number
}

/** One millisecond of the rider moving toward the plan the way a person does: the throttle snaps over in an eighth of a second, a lean takes a moment. */
const toward = (p: Plan) => (s: WheelieSim) => {
  const step = (x: number, goal: number | undefined, most: number) => (goal === undefined ? x : x + Math.max(-most, Math.min(most, goal - x)))
  const r = s.rider
  r.throttle = step(r.throttle, p.throttle, 0.008)
  r.lean = step(r.lean, p.lean, 0.0006)
  r.roll = step(r.roll, p.roll, 0.03)
  r.yawRate = step(r.yawRate, p.yawRate, 0.2)
  if (p.rearBrake !== undefined) r.rearBrake = p.rearBrake
  if (p.frontBrake !== undefined) r.frontBrake = p.frontBrake
}

function go(sim: WheelieSim, seconds: number, p: Plan) {
  sim.advance(seconds, toward(p))
}

/** Rolling along, armed, then a pin with a lean back: into the hold. */
function intoHold(r: Rig, lean = -0.22) {
  go(r.sim, 0.5, { throttle: 0.3 })
  r.arm()
  go(r.sim, 0.5, { throttle: 0.3 })
  r.sim.until(() => r.state() === S.holding, 2, toward({ throttle: 1, lean }))
  expect(r.state(), `ended early: reason ${r.reason()}`).toBe(S.holding)
}

const recent = (sim: WheelieSim, seconds: number) => sim.log.filter((x) => x.t > sim.t - seconds)

describe('the wheelie program', () => {
  it('loads disarmed: nothing runs at power-up, and its functions go to flash', () => {
    const { sim } = rig()
    expect(sim.threadCount).toBe(0)
    const st = parseWheelieStatus(`> ${showValue(sim.repl(WHEELIE_STATUS_PROGRAM))}`)
    expect(st).toMatchObject({ version: WHEELIE_VERSION, on: false, state: S.off })

    // Before @const-start only values; between it and @const-end only functions.
    const [head, rest] = WHEELIE_LISP.split(/^@const-start/m)
    const [code] = rest.split(/^@const-end/m)
    const heads = (src: string) => read(src).map((f) => ((f as Val[])[0] as Sym).name)
    expect(new Set(heads(head))).toEqual(new Set(['def']))
    expect(new Set(heads(code))).toEqual(new Set(['defun']))
    // What stays in the controller's 2464-cell script memory: about three cells per global.
    const globals = new Set([...WHEELIE_LISP.matchAll(/\(def (wl-[a-z0-9-]+)/g)].map((m) => m[1]))
    expect(globals.size * 3).toBeLessThan(700)
  })

  it('the settings in the app and in the script are the same ones', () => {
    expect(new Set(scriptSettingNames())).toEqual(new Set(WHEELIE_FIELDS.map((f) => wheelieLispName(f.key))))
    expect(wheelieSettingsProblem(WHEELIE_DEFAULTS)).toBeNull()
  })

  it('refuses settings out of range instead of trimming them', () => {
    expect(wheelieSettingsProblem({ ...WHEELIE_DEFAULTS, target: 40 })).toMatch(/Target angle must be from 3 ° to 30 °/)
    expect(wheelieSettingsProblem({ ...WHEELIE_DEFAULTS, kp: Number.NaN })).toMatch(/Hold strength isn’t set/)
    expect(wheelieSettingsProblem({ ...WHEELIE_DEFAULTS, trigger: 0.5 })).toMatch(/whole number/)
    expect(wheelieSettingsProblem({ ...WHEELIE_DEFAULTS, target: 18, maxAngle: 20 })).toMatch(/cut-out angle/)
    expect(wheelieSettingsProblem({ ...WHEELIE_DEFAULTS, minKmh: 28, maxKmh: 30 })).toMatch(/fastest speed/)
    expect(wheelieSettingsProblem({ ...WHEELIE_DEFAULTS, letGo: 0.9, pin: 0.95 })).toMatch(/Ends below/)
  })

  it('arms from console commands that fit the console, and reports the run it was given', () => {
    const r = rig({ settings: { target: 12 } })
    const cmds = wheelieArmCommands(r.settings, straight(1.5), r.wiring, 4321)
    expect(cmds.length).toBeLessThanOrEqual(6)
    for (const c of cmds) expect(c.length).toBeLessThanOrEqual(MAX_CMD)
    r.arm(4321)
    r.sim.advance(0.3)
    const st = parseWheelieStatus(`> ${showValue(r.sim.repl(WHEELIE_STATUS_PROGRAM))}`)
    expect(st).toMatchObject({ on: true, state: S.armed, runId: 4321 })
    expect(r.sim.num('wl-target')).toBe(12)
    expect(r.sim.tones[0].hz).toBe(1500)
    // Arming again only updates it.
    r.arm(4322)
    expect(r.sim.threadCount).toBe(1)
  })

  it('does nothing when not armed, however the throttle moves', () => {
    const r = rig()
    go(r.sim, 0.5, { throttle: 0.3 })
    go(r.sim, 1.5, { throttle: 1 })
    expect(r.sim.motors.rear.cmd).toBeNull()
    expect(r.sim.motors.front.cmd).toBeNull()
    expect(r.sim.tones).toHaveLength(0)
  })

  it('says no, with a low tone, when a wheelie can’t start', () => {
    const slow = rig({ sim: { speed: 6 / 3.6 } })
    go(slow.sim, 0.3, { throttle: 0.2 })
    slow.arm()
    go(slow.sim, 0.5, { throttle: 0.2 })
    go(slow.sim, 0.4, { throttle: 1 })
    expect(slow.reason()).toBe(4)
    expect(slow.state()).toBe(S.armed)
    expect(slow.sim.tones.map((t) => t.hz)).toContain(600)

    const full = rig({ settings: { minVolts: 30, maxVolts: 45 } })
    go(full.sim, 0.3, { throttle: 0.3 })
    full.arm()
    go(full.sim, 0.5, { throttle: 0.3 })
    go(full.sim, 0.4, { throttle: 1 })
    expect(full.reason()).toBe(22)
    expect(full.sim.pitchDeg).toBe(0)
  })

  it('disarms itself after the set time without a wheelie', () => {
    const r = rig()
    r.arm()
    r.sim.repl('(def wl-arm-minutes 0.02)')
    r.sim.advance(1.5)
    expect(r.reason()).toBe(20)
    expect(r.sim.num('wl-on')).toBe(0)
    expect(r.sim.threadCount).toBe(0)
  })

  it('pinning the throttle lifts the front and holds it at the target', () => {
    const r = rig()
    intoHold(r)
    go(r.sim, 2, { throttle: 1, lean: -0.22 })
    expect(r.state()).toBe(S.holding)
    const last = recent(r.sim, 0.8)
    for (const x of last) expect(Math.abs(x.pitch - r.settings.target)).toBeLessThan(1.5)
    // It believes the angle it's at.
    for (const x of last) expect(Math.abs(x.seen - x.pitch)).toBeLessThan(0.8)
    expect(Math.max(...r.sim.log.map((x) => x.pitch))).toBeLessThan(r.settings.target + 3)
  })

  it('leaning forward speeds it up and leaning back slows it down', () => {
    const change = (lean: number) => {
      const r = rig()
      intoHold(r)
      go(r.sim, 0.6, { throttle: 1, lean })
      const before = r.sim.v
      go(r.sim, 1.2, { throttle: 1, lean })
      expect(r.state()).toBe(S.holding)
      return r.sim.v - before
    }
    expect(change(-0.16)).toBeGreaterThan(0.4)
    expect(change(-0.3)).toBeLessThan(-0.4)
  })

  it('letting go lands it gently, then waits for the throttle to be let go before handing back', () => {
    const r = rig()
    intoHold(r)
    go(r.sim, 1.5, { throttle: 1, lean: -0.22 })
    // Easing to half throttle ends it.
    r.sim.until(() => r.state() === S.waiting, 2, (s) => (s.rider.throttle = Math.max(0.5, s.rider.throttle - 0.008)))
    expect(r.reason()).toBe(1)
    expect(r.sim.landings).toHaveLength(1)
    expect(r.sim.landings[0]).toBeLessThan(60)
    expect(r.sim.loopedOut).toBe(false)
    // Still at half throttle: nothing drives, and a tone now and then says why.
    go(r.sim, 2, { throttle: 0.5, lean: 0 })
    expect(r.state()).toBe(S.waiting)
    expect(Math.abs(r.sim.motors.rear.amps)).toBeLessThan(0.5)
    expect(Math.abs(r.sim.motors.front.amps)).toBeLessThan(0.5)
    expect(r.sim.tones.filter((t) => t.hz === 800).length).toBeGreaterThan(0)
    // Let go: control goes back, still armed, and the throttle starts from nothing.
    go(r.sim, 0.2, { throttle: 0 })
    r.sim.until(() => r.state() === S.armed, 1.5)
    expect(r.state()).toBe(S.armed)
    expect(r.sim.num('wl-count')).toBe(1)
    go(r.sim, 0.1, { throttle: 0 })
    expect(r.sim.motors.rear.amps).toBeLessThan(1)
    go(r.sim, 0.6, { throttle: 0.3 })
    expect(r.sim.motors.rear.amps).toBeCloseTo(0.3 * r.sim.scooter.motorMax, 0)
  })

  it('lands by itself at the time limit, and a second wheelie works the same', () => {
    const r = rig({ settings: { maxTime: 1.5 } })
    intoHold(r)
    r.sim.until(() => r.state() === S.waiting, 3, (s) => (s.rider.throttle = 1))
    expect(r.reason()).toBe(2)
    r.sim.until(() => r.sim.grounded, 0.5, (s) => (s.rider.throttle = 1))
    expect(r.sim.landings).toHaveLength(1)
    expect(r.sim.landings[0]).toBeLessThan(60)
    // Pinned after landing: it keeps free-wheeling.
    go(r.sim, 1, { throttle: 1, lean: 0 })
    expect(r.state()).toBe(S.waiting)
    expect(r.sim.motors.rear.amps).toBeLessThan(0.5)
    go(r.sim, 1.3, { throttle: 0 })
    expect(r.state()).toBe(S.armed)
    go(r.sim, 0.6, { throttle: 0.3 })
    go(r.sim, 0.2, { throttle: 1, lean: -0.22 })
    r.sim.until(() => r.state() === S.holding, 1.5, (s) => (s.rider.throttle = 1))
    expect(r.sim.num('wl-count')).toBe(2)
  })

  it('ends when the front comes down, and at the speed limit', () => {
    const forward = rig()
    intoHold(forward)
    go(forward.sim, 2.5, { throttle: 1, lean: 0.05 })
    expect(forward.reason()).toBe(24)
    const fast = rig({ settings: { maxKmh: 28 } })
    intoHold(fast)
    go(fast.sim, 3, { throttle: 1, lean: -0.16 })
    expect(fast.reason()).toBe(3)
    expect(fast.sim.kmh).toBeLessThan(30)
  })

  it('a pulled brake ends it and disarms', () => {
    const rear = rig()
    intoHold(rear)
    go(rear.sim, 0.6, { throttle: 1, lean: -0.22 })
    go(rear.sim, 0.3, { throttle: 1, rearBrake: 40 })
    expect(rear.reason()).toBe(8)
    go(rear.sim, 1.5, { throttle: 0, rearBrake: 0 })
    expect(rear.state()).toBe(S.off)
    expect(rear.sim.num('wl-on')).toBe(0)
    expect(rear.sim.threadCount).toBe(0)
    expect(rear.sim.loopedOut).toBe(false)

    const front = rig()
    intoHold(front)
    go(front.sim, 0.8, { throttle: 1, lean: -0.22 })
    go(front.sim, 0.5, { throttle: 1, frontBrake: 30 })
    expect(front.reason()).toBe(9)
    // It doesn't fight the brake on the way down.
    go(front.sim, 0.2, { throttle: 1, frontBrake: 30 })
    expect(front.sim.motors.front.amps).toBeLessThanOrEqual(0.5)
  })

  it('leaning to the side or turning hard ends it', () => {
    const roll = rig()
    intoHold(roll)
    go(roll.sim, 1, { throttle: 1, roll: 16 })
    expect(roll.reason()).toBe(6)
    const yaw = rig()
    intoHold(yaw)
    go(yaw.sim, 1, { throttle: 1, yawRate: 60 })
    expect(yaw.reason()).toBe(7)
  })

  it('a bump or a lean too far back is caught; past the cut-out angle it brakes the nose back down', () => {
    // A bump throws the nose up at 69°/s: the hold brakes and settles back.
    const bump = rig()
    intoHold(bump)
    go(bump.sim, 0.5, { throttle: 1, lean: -0.22 })
    const at = bump.sim.t
    bump.sim.omega += 1.2
    go(bump.sim, 1.5, { throttle: 1, lean: -0.22 })
    expect(bump.state()).toBe(S.holding)
    expect(Math.max(...recent(bump.sim, bump.sim.t - at).map((x) => x.pitch))).toBeLessThan(bump.settings.maxAngle)
    expect(bump.sim.pitchDeg).toBeCloseTo(bump.settings.target, -0.5)

    // Leaning far back with a tight cut-out: it brakes the nose down and lands.
    const r = rig({ settings: { maxAngle: 14 } })
    intoHold(r)
    go(r.sim, 1.5, { throttle: 1, lean: -0.36 })
    expect(r.sim.log.some((x) => x.state === S.catching)).toBe(true)
    expect(r.reason()).toBe(5)
    expect(r.sim.loopedOut).toBe(false)
    expect(Math.max(...r.sim.log.map((x) => x.pitch))).toBeLessThan(r.settings.maxAngle + 8)
  })

  it('heat and battery current end it', () => {
    const hot = rig()
    intoHold(hot)
    hot.sim.faults.fetTemp = 90
    go(hot.sim, 0.3, { throttle: 1 })
    expect(hot.reason()).toBe(12)
    const draw = rig({ settings: { maxAmpsIn: 25 } })
    go(draw.sim, 0.5, { throttle: 0.3 })
    draw.arm()
    go(draw.sim, 0.5, { throttle: 0.3 })
    go(draw.sim, 1.2, { throttle: 1, lean: -0.22 })
    expect(draw.reason()).toBe(11)
  })

  it('a stalled IMU, a quiet CAN bus or a controller fault stop it and leave the motors free', () => {
    for (const [fault, why] of [
      ['imuFrozen', 14],
      ['canQuiet', 16],
      ['faultCode', 21],
    ] as const) {
      const r = rig()
      intoHold(r)
      go(r.sim, 0.5, { throttle: 1 })
      if (fault === 'faultCode') r.sim.faults.faultCode = 5
      else r.sim.faults[fault] = true
      go(r.sim, 0.2, { throttle: 1 })
      expect(r.reason(), fault).toBe(why)
      expect(r.state()).toBe(S.waiting)
      go(r.sim, 0.3, { throttle: 1 })
      expect(Math.abs(r.sim.motors.rear.amps)).toBeLessThan(0.5)
      go(r.sim, 1.2, { throttle: 0 })
      expect(r.state()).toBe(S.fault)
      expect(r.sim.threadCount).toBe(0)
    }
  })

  it('if the program stops, the throttle has the motors back within 50 ms', () => {
    const r = rig()
    intoHold(r)
    go(r.sim, 0.5, { throttle: 1 })
    r.sim.faults.stall = 0.3
    go(r.sim, 0.08, { throttle: 1 })
    // The throttle app is driving again: its own current, not the program's.
    expect(r.sim.motors.rear.cmd).toBeNull()
    expect(r.sim.motors.rear.amps).toBeGreaterThan(40)
    go(r.sim, 0.4, { throttle: 1 })
    expect(r.reason()).toBe(15)
  })

  it('a dry run does everything but drive the motors', () => {
    const r = rig({ settings: { dry: 1 } })
    go(r.sim, 0.5, { throttle: 0.3 })
    r.arm()
    go(r.sim, 0.5, { throttle: 0.3 })
    go(r.sim, 1.5, { throttle: 1, lean: -0.22 })
    expect(r.sim.log.some((x) => x.state === S.lifting)).toBe(true)
    expect(r.sim.motors.rear.cmd).toBeNull()
    expect(r.sim.motors.front.cmd).toBeNull()
    expect(r.sim.tones.map((t) => t.hz)).toContain(2200)
  })

  it('on a stand any speed counts and the current is capped', () => {
    const r = rig({ settings: { bench: 1, benchAmps: 8 }, sim: { speed: 0 } })
    r.arm()
    go(r.sim, 0.3, { throttle: 0 })
    go(r.sim, 1, { throttle: 1 })
    expect(r.sim.log.some((x) => x.state === S.lifting)).toBe(true)
    // Before the pin it's the throttle as usual; once the program drives, it's capped.
    const driven = r.sim.log.filter((x) => x.state >= S.lifting && x.state <= S.landing)
    expect(driven.length).toBeGreaterThan(30)
    for (const x of driven) expect(Math.max(Math.abs(x.rearAmps), Math.abs(x.frontAmps))).toBeLessThanOrEqual(8.001)
  })

  it('with two pins set, one pin isn’t enough', () => {
    const r = rig({ settings: { trigger: 1 } })
    go(r.sim, 0.5, { throttle: 0.3 })
    r.arm()
    go(r.sim, 0.5, { throttle: 0.3 })
    go(r.sim, 0.5, { throttle: 1 })
    expect(r.state()).toBe(S.armed)
    go(r.sim, 0.25, { throttle: 0.3 })
    go(r.sim, 0.3, { throttle: 1, lean: -0.22 })
    expect(r.sim.num('wl-count')).toBe(1)
  })

  it('switching it off mid-wheelie lands it first', () => {
    const r = rig()
    intoHold(r)
    r.sim.repl(WHEELIE_OFF_PROGRAM)
    go(r.sim, 1, { throttle: 1 })
    expect(r.reason()).toBe(19)
    expect(r.sim.landings).toHaveLength(1)
    go(r.sim, 1.5, { throttle: 0 })
    expect(r.sim.num('wl-on')).toBe(0)
  })

  it('sends live data that decodes', () => {
    const r = rig()
    go(r.sim, 0.3, { throttle: 0.3 })
    r.arm()
    r.sim.repl(WHEELIE_TELEMETRY_PROGRAM)
    intoHold(r)
    go(r.sim, 0.5, { throttle: 1, lean: -0.22 })
    const all = r.sim.sent.map((p) => decodeWheelieTelemetry(p.data)!)
    expect(all.length).toBeGreaterThan(20)
    const last = all.at(-1)!
    expect(last).toMatchObject({ version: WHEELIE_VERSION, state: S.holding, count: 1, dry: false })
    expect(last.pitch).toBeCloseTo(r.sim.pitchDeg, 0)
    expect(last.speed).toBeCloseTo(r.sim.v, 0)
    expect(last.loopDt).toBeCloseTo(0.01, 2)
  })

  it('one run of its loop stays within what the controller can do 100 times a second', () => {
    const r = rig()
    intoHold(r)
    go(r.sim, 1, { throttle: 1 })
    expect(r.sim.maxSteps).toBeLessThan(2000)
  })
})

describe('calibrating the IMU', () => {
  /** Averages the IMU the way Ohmic asks the controller to. */
  function average(sim: WheelieSim): ImuAverage {
    sim.repl(WHEELIE_CAL_START)
    expect(parseImuAverage(`> ${showValue(sim.repl(WHEELIE_CAL_READ))}`)).toBe('busy')
    sim.advance(1.2)
    const a = parseImuAverage(`> ${showValue(sim.repl(WHEELIE_CAL_READ))}`)
    if (!a || typeof a === 'string') throw new Error('no average')
    return a
  }

  const mount = mounting(90, 180, 12)
  const near = (a: Vec3, b: Vec3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 2))

  it('finds which way the controller points, from three still moments', () => {
    const sim = new WheelieSim({ mount, gyroBias: [1.2, -0.7, 0.4] })
    sim.load(WHEELIE_LISP)
    sim.rider.onBoard = false
    const level = average(sim)
    sim.pose(18)
    const tipped = average(sim)
    sim.pose(0)
    sim.rider.onBoard = true
    const loaded = average(sim)
    const cal = calibrationFrom(level, tipped, loaded, 'test')
    if ('problem' in cal) throw new Error(cal.problem)
    near(cal.forward, apply(mount, [1, 0, 0]))
    near(cal.up, apply(mount, [0, 0, 1]))
    near(cal.side, apply(mount, [0, -1, 0]))
    cal.gyroBias.forEach((x, i) => expect(x).toBeCloseTo([1.2, -0.7, 0.4][i], 1))
    expect(cal.zero).toBeCloseTo(sim.scooter.sag, 1)
  })

  it('refuses a moment that moved or a lift that was too small', () => {
    const still: ImuAverage = { acc: [0, 0, 1], gyro: [0, 0, 0], spread: 0.005 }
    const lifted: ImuAverage = { acc: [Math.sin(0.3), 0, Math.cos(0.3)], gyro: [0, 0, 0], spread: 0.005 }
    expect(calibrationFrom({ ...still, spread: 0.1 }, lifted, still, 't')).toMatchObject({ problem: expect.stringMatching(/moved/) })
    expect(calibrationFrom(still, { ...still, acc: [0.05, 0, 1] }, still, 't')).toMatchObject({ problem: expect.stringMatching(/only 3° up/) })
    expect(calibrationFrom({ ...still, acc: [0, 0, 0.3] }, lifted, still, 't')).toMatchObject({ problem: expect.stringMatching(/0.30 g/) })
  })

  it('holds the target with an oddly mounted, calibrated IMU', () => {
    const opts = { mount, gyroBias: [1.2, -0.7, 0.4] as Vec3 }
    const probe = new WheelieSim(opts)
    probe.load(WHEELIE_LISP)
    probe.rider.onBoard = false
    const level = average(probe)
    probe.pose(18)
    const tipped = average(probe)
    probe.pose(0)
    probe.rider.onBoard = true
    const cal = calibrationFrom(level, tipped, average(probe), 'test')
    if ('problem' in cal) throw new Error(cal.problem)

    const r = rig({ sim: opts, cal })
    // The check Ohmic offers: lift the front and the reading rises.
    r.sim.pose(15)
    expect(parsePeek(`> ${showValue(r.sim.repl(WHEELIE_PEEK_PROGRAM))}`)!.pitch).toBeCloseTo(15, 0)
    r.sim.pose(0)
    r.sim.v = 14 / 3.6
    intoHold(r)
    go(r.sim, 2, { throttle: 1, lean: -0.22 })
    for (const x of recent(r.sim, 0.8)) expect(Math.abs(x.pitch - r.settings.target)).toBeLessThan(1.5)
  })
})
