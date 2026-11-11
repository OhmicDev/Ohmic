// The demo controller running the installed auto-wheelie program: the real
// script in the wheelie simulator, kept in step with the demo clock. While it's
// armed a demo rider rides along at about 16 km/h and, every 10 seconds, pins
// the throttle and leans back, holds the wheelie for a few seconds and lets go,
// so the Wheelie page has something to show. While Ohmic calibrates, the demo
// holds the scooter the way the steps ask (Ohmic tells it which step).

import { COMM } from '../protocol/commands'
import { showValue } from '../onboard/lispbm'
import { SCOOTER, WheelieSim } from './wheelieSim'

export type DemoWheeliePose = 'level' | 'tipped' | 'loaded' | 'check' | null

/** The longest stretch simulated in one go; a longer pause skips ahead. */
const MAX_CATCH_UP_S = 3
/** Seconds of the simulator's 10 ms log kept. */
const KEEP_LOG_S = 20
const CRUISE = 16 / 3.6

const num = (code: string, name: string) => {
  const m = new RegExp(`\\(def ${name} (-?[\\d.]+)\\)`).exec(code)
  return m ? Number(m[1]) : NaN
}

export class DemoWheelie {
  readonly sim: WheelieSim
  private readonly now: () => number
  /** Demo-clock ms at which the simulator's time was 0. */
  private zeroAt: number
  private pose: DemoWheeliePose = null
  /** Simulator time the program was last seen arming, for the rider's 10 s cycle. */
  private armedAt: number | null = null
  private onCheckedAt = -1
  private on = false

  constructor(code: string, now: () => number) {
    // The scooter's wheel and motor match the speed reading Ohmic installed, and its
    // second motor answers on the CAN ID Ohmic installed.
    const spe = num(code, 'wl-spe')
    const poles = spe > 0 ? (2 * (2 * Math.PI * SCOOTER.wheelRadius)) / 60 / spe : SCOOTER.poles
    const rear = num(code, 'wl-rear')
    const front = num(code, 'wl-front')
    this.sim = new WheelieSim({
      scooter: { ...SCOOTER, poles },
      wiring: { rear: Number.isFinite(rear) ? rear : -1, front: Number.isFinite(front) ? front : 1 },
      speed: 0,
    })
    this.sim.load(code)
    this.now = now
    this.zeroAt = now()
  }

  /** Holds the scooter for a calibration step; null lets it go. */
  setPose(pose: DemoWheeliePose) {
    this.catchUp()
    this.pose = pose
    const s = this.sim
    s.v = 0
    s.rider.throttle = 0
    s.rider.lean = 0
    s.rider.onBoard = pose !== 'level' && pose !== 'tipped'
    s.pose(pose === 'tipped' ? 15 : pose === 'check' ? 12 : 0)
  }

  /** One console command, answered the way the firmware prints it. */
  repl(code: string): string[] {
    this.catchUp()
    try {
      return [`> ${showValue(this.sim.repl(code))}`]
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      return [`***\tEval error: ${text}`]
    }
  }

  /** The program's live data since last time, as the packets send-data makes. */
  pump(): Uint8Array[] {
    this.catchUp()
    const sent = this.sim.sent.splice(0)
    return sent.map((p) => Uint8Array.from([COMM.CUSTOM_APP_DATA, ...p.data]))
  }

  private catchUp() {
    const target = (this.now() - this.zeroAt) / 1000
    let ahead = target - this.sim.t
    if (ahead > MAX_CATCH_UP_S) {
      this.zeroAt += (ahead - MAX_CATCH_UP_S) * 1000
      ahead = MAX_CATCH_UP_S
    }
    if (ahead < 0.001) return
    this.sim.advance(ahead, (s) => this.ride(s))
    const log = this.sim.log
    const old = log.findIndex((x) => x.t > this.sim.t - KEEP_LOG_S)
    if (old > 0) log.splice(0, old)
  }

  /** The demo rider, every millisecond. */
  private ride(s: WheelieSim) {
    if (this.pose) return
    const r = s.rider
    const step = (x: number, goal: number, most: number) => x + Math.max(-most, Math.min(most, goal - x))
    // Reading the program's state every 10 ms is plenty.
    if (s.t - this.onCheckedAt >= 0.01) {
      this.onCheckedAt = s.t
      const on = s.num('wl-on') === 1
      if (on && !this.on) this.armedAt = s.t
      if (!on) this.armedAt = null
      this.on = on
    }
    if (this.armedAt === null) {
      // Disarmed: rolls to a stop and stands.
      r.throttle = step(r.throttle, 0, 0.008)
      r.lean = step(r.lean, 0, 0.0006)
      r.rearBrake = s.v > 0.2 ? 12 : 0
      return
    }
    r.rearBrake = 0
    const k = (s.t - this.armedAt) % 10
    if (k < 6) {
      // Rolling along at about 16 km/h; the first seconds get up to speed.
      r.throttle = step(r.throttle, Math.max(0, Math.min(0.5, 0.12 + 0.15 * (CRUISE - s.v))), 0.008)
      r.lean = step(r.lean, 0, 0.0006)
    } else if (k < 9) {
      // Pins it and leans back; leans a little forward mid-way, to speed up.
      r.throttle = step(r.throttle, 1, 0.008)
      r.lean = step(r.lean, k > 7.3 && k < 7.9 ? -0.18 : -0.22, 0.0006)
    } else {
      // Lets go, and stands upright once the front is down.
      r.throttle = step(r.throttle, 0, 0.008)
      if (s.grounded) r.lean = step(r.lean, 0, 0.0006)
    }
  }
}
