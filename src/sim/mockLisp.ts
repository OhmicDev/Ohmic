// Just enough of a LispBM console for the demo: it recognises the programs Ohmic
// sends (ABS, regen and motor sounds), runs their logic in the simulator, and answers
// the status checks. Like the firmware, it ignores commands sent too close together.

import { ABS_DT, type AbsParams } from '../onboard/abs'
import { REGEN_DT, type RegenParams } from '../onboard/regen'

interface LispHost {
  now: () => number
  startAbs: (p: AbsParams) => void
  stopAbs: () => void
  absStatus: () => { on: boolean; interventions: number; beat: number } | null
  playTune: (entries: number[]) => void
  stopTune: () => void
  startRegen: (p: RegenParams) => void
  stopRegen: () => void
  regenStatus: () => { on: boolean; engagements: number; beat: number } | null
  /** The auto-wheelie program running as the stored script, when it is: it answers its own commands. */
  wheelie: () => { repl: (code: string) => string[] } | null
}

/** The firmware drops console commands closer together than this. */
const REPL_MIN_GAP_MS = 500

export class MockLisp {
  private readonly host: LispHost
  private readonly globals = new Map<string, number | number[]>()
  private lastAt = -Infinity
  /** Commands dropped for coming too soon, so tests can see the app keeps its gap. */
  dropped = 0

  constructor(host: LispHost) {
    this.host = host
  }

  /** Returns the lines printed, or null when the command was ignored. */
  eval(code: string): string[] | null {
    const now = this.host.now()
    if (now - this.lastAt < REPL_MIN_GAP_MS) {
      this.dropped++
      return null
    }
    this.lastAt = now

    if (/\bwl-/.test(code)) {
      const w = this.host.wheelie()
      if (w) return w.repl(code)
      return ['***\tEval error: variable_not_bound', `***\tSymbol: ${/wl-[\w-]+/.exec(code)![0]}`]
    }

    for (const m of code.matchAll(/\(def (ohm-[\w-]+) (-?\d+(?:\.\d+)?)\)/g)) this.globals.set(m[1], Number(m[2]))
    for (const m of code.matchAll(/\(def (ohm-m\d+) '\(([\d\s-]*)\)\)/g)) this.globals.set(m[1], m[2].trim().split(/\s+/).map(Number))
    for (const m of code.matchAll(/\(def ohm-gc '\(([\d\s]*)\)\)/g)) this.globals.set('ohm-gc', m[1].trim().split(/\s+/).filter(Boolean).map(Number))
    if (code.includes('(def ohm-gc nil)')) this.globals.set('ohm-gc', [])

    const n = (k: string) => {
      const v = this.globals.get(k)
      return typeof v === 'number' ? v : NaN
    }

    if (code.startsWith('(list ohm-abs-on')) {
      if (!this.globals.has('ohm-abs-on')) return ['***\tEval error: variable_not_bound', '***\tSymbol: ohm-abs-on']
      const st = this.host.absStatus()
      const on = st?.on ? 1 : 0
      if (!st?.on) this.globals.set('ohm-abs-on', 0)
      return [`> (${on} ${st?.interventions ?? 0} ${st?.beat ?? 0} ${n('ohm-id') || 0})`]
    }
    if (code.startsWith('(list ohm-regen-on')) {
      if (!this.globals.has('ohm-regen-on')) return ['***\tEval error: variable_not_bound', '***\tSymbol: ohm-regen-on']
      const st = this.host.regenStatus()
      const on = st?.on ? 1 : 0
      if (!st?.on) this.globals.set('ohm-regen-on', 0)
      return [`> (${on} ${st?.engagements ?? 0} ${st?.beat ?? 0} ${n('ohm-gid') || 0})`]
    }
    if (code === '(def ohm-regen-on 0)') {
      this.host.stopRegen()
      return ['> 0']
    }
    if (code.includes('(def ohm-regen-on 1)') && code.includes('spawn')) {
      const followers = this.globals.get('ohm-gc')
      this.host.startRegen({
        speedPerErpm: n('ohm-gp'),
        amps: n('ohm-ga'),
        rampS: REGEN_DT / n('ohm-gu'),
        fadeSpeed: n('ohm-gh'),
        minSpeed: n('ohm-gm'),
        delayS: n('ohm-gw') * REGEN_DT,
        input: n('ohm-gs') === 1 ? 1 : 0,
        lever: n('ohm-gl') === 1,
        followers: Array.isArray(followers) ? followers : [],
      })
      return ['> 3']
    }
    if (code === '(def ohm-abs-on 0)') {
      this.host.stopAbs()
      return ['> 0']
    }
    if (code.includes('(def ohm-abs-on 1)') && code.includes('spawn')) {
      const rel = n('ohm-pr')
      this.host.startAbs({
        speedPerErpm: n('ohm-pe'),
        slipDecel: n('ohm-pd'),
        minSpeed: n('ohm-pm'),
        releaseFraction: rel,
        holdS: n('ohm-ph') * ABS_DT,
        rampS: ((1 - rel) * ABS_DT) / n('ohm-ps'),
        maxReleaseS: n('ohm-px') * ABS_DT,
        armS: n('ohm-pa') * ABS_DT,
      })
      return ['> 3']
    }
    if (code === '(progn (def ohm-mp 0) (foc-play-stop))') {
      this.host.stopTune()
      return ['> t']
    }
    const play = /\(def ohm-ml \(list ([\w\s-]+)\)\)/.exec(code)
    if (play && code.includes('spawn')) {
      const entries = play[1]
        .trim()
        .split(/\s+/)
        .flatMap((name) => {
          const v = this.globals.get(name)
          return Array.isArray(v) ? v : []
        })
      this.host.playTune(entries)
      return ['> 4']
    }
    const fn = /\(defun ([\w-]+)/g.exec(code)
    if (fn) return [`> ${fn[1]}`]
    return ['> t']
  }
}
