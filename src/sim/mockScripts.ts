// A demo controller's script storage and engine: the stored LispBM script and
// QML screen (erase, write, read, start, stop), the engine's stats, and the
// settings a package adds while its script runs.
//
// It can't run real LispBM. When a script starts it prints the top-level
// (print "…") lines, keeps top-level (def name number) values as globals, and
// repeats a (loopwhile t … (print (str-from-n (get-speed) "…")) (sleep n)) loop.

import { convertParamXml } from '../config/paramXml'
import { decodeConfig, encodeConfig, xmlDefaults } from '../config/codec'
import type { ConfigDefs, ConfigValues } from '../config/types'
import { qCompressStored } from '../lib/qcompress'
import { BufferReader, BufferWriter } from '../protocol/buffer'
import { COMM } from '../protocol/commands'
import { encodeLispStats, parseLispStorage, unpackLispProgram } from '../protocol/lisp'
import { DEMO_CONFIG_MARKER, DEMO_LIGHTS_XML } from './demoPackageConfig'
import type { MockReply } from './mockBus'

export interface ScriptHost {
  now: () => number
  /** Live readings a script can print. */
  reading: (fn: string) => number | null
  /** False when the controller won't take new code (STM32 controllers refuse while the motor spins). */
  canErase: () => boolean
}

const AREA_MAX = 128 * 1024

function lispPrint(text: string): Uint8Array {
  return Uint8Array.from([COMM.LISP_PRINT, ...new TextEncoder().encode(text)])
}

let demoDefs: ConfigDefs | null = null
function lightsDefs(): ConfigDefs {
  demoDefs ??= convertParamXml(DEMO_LIGHTS_XML, 'appconf', 'custom')
  return demoDefs
}

export class MockScripts {
  private readonly host: ScriptHost
  lispArea: Uint8Array | null = null
  qmlArea: Uint8Array | null = null
  running = false
  /** Code of the script now running (what was stored when it started). */
  private code = ''
  private globals = new Map<string, number>()
  private loop: { every: number; fn: string; format: string; next: number } | null = null
  private customValues: ConfigValues | null = null
  /** Every erase, for tests. */
  erases: { kind: 'lisp' | 'qml'; size: number }[] = []

  constructor(host: ScriptHost) {
    this.host = host
  }

  storedProgram(): Uint8Array | null {
    if (!this.lispArea) return null
    try {
      return parseLispStorage(this.lispArea)
    } catch {
      return null
    }
  }

  storedCode(): string | null {
    const p = this.storedProgram()
    return p ? unpackLispProgram(p).code : null
  }

  hasQml(): boolean {
    if (!this.qmlArea || this.qmlArea.length < 6) return false
    const size = new BufferReader(this.qmlArea).u32()
    return size !== 0xffffffff && size > 0
  }

  /** Custom configs on offer: the demo light package's, while it runs. */
  customConfigCount(): number {
    return this.running && this.code.includes(DEMO_CONFIG_MARKER) ? 1 : 0
  }

  private start(): string[] {
    const code = this.storedCode()
    if (code === null) return []
    this.running = true
    this.code = code
    this.globals.clear()
    this.loop = null
    const out: string[] = []
    // Only top-level forms count; a crude depth scan is enough for the examples.
    let depth = 0
    let formStart = -1
    for (let i = 0; i < code.length; i++) {
      const c = code[i]
      if (c === ';') {
        while (i < code.length && code[i] !== '\n') i++
        continue
      }
      if (c === '"') {
        i++
        while (i < code.length && code[i] !== '"') i += code[i] === '\\' ? 2 : 1
        continue
      }
      if (c === '(') {
        if (depth === 0) formStart = i
        depth++
      } else if (c === ')') {
        depth--
        if (depth === 0 && formStart >= 0) out.push(...this.topLevel(code.slice(formStart, i + 1)))
      }
    }
    if (depth !== 0) {
      this.running = false
      return ['***\tReader error: unbalanced parentheses', '***\tScript stopped.']
    }
    this.customValues ??= this.customConfigCount() ? xmlDefaults(lightsDefs()) : null
    return out
  }

  private topLevel(form: string): string[] {
    const print = /^\((?:print|puts) "((?:[^"\\]|\\.)*)"\)$/.exec(form)
    if (print) return [print[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')]
    const def = /^\(def ([\w-]+) (-?\d+(?:\.\d+)?)\)$/.exec(form)
    if (def) this.globals.set(def[1], Number(def[2]))
    if (form.startsWith('(loopwhile t')) {
      const sleep = /\(sleep (\d+(?:\.\d+)?)\)/.exec(form)
      const shown = /\(print \(str-from-n \(([\w-]+)\) "([^"]*)"\)\)/.exec(form)
      if (sleep && shown) this.loop = { every: Math.max(0.1, Number(sleep[1])) * 1000, fn: shown[1], format: shown[2], next: this.host.now() }
    }
    return []
  }

  /** Lines a running loop printed since last time. */
  pump(): MockReply[] {
    const l = this.loop
    if (!this.running || !l) return []
    const now = this.host.now()
    const out: MockReply[] = []
    for (let n = 0; l.next <= now && n < 5; n++) {
      const v = this.host.reading(l.fn)
      out.push(lispPrint(v === null ? '***\tEval error: variable_not_bound' : formatC(l.format, v)))
      l.next += l.every
    }
    if (l.next <= now) l.next = now + l.every
    return out
  }

  private stats(): Uint8Array {
    const len = this.code.length
    const bindings = [...this.globals].map(([name, value]) => ({ name, value }))
    if (this.loop) bindings.push({ name: 'loop-count', value: Math.floor((this.host.now() / this.loop.every) % 100000) })
    return Uint8Array.from([
      COMM.LISP_GET_STATS,
      ...encodeLispStats({
        cpu: this.loop ? 2.5 + ((this.host.now() / 997) % 1.5) : 0.4,
        heap: Math.min(85, 6 + len / 120),
        mem: Math.min(80, 3 + len / 400),
        bindings,
      }),
    ])
  }

  /** Handles a script command, or returns null for anything else. */
  handle(cmd: number, body: Uint8Array): MockReply[] | null {
    switch (cmd) {
      case COMM.LISP_ERASE_CODE:
      case COMM.QMLUI_ERASE: {
        const size = new BufferReader(body).i32()
        const ok = size > 0 && size <= AREA_MAX && this.host.canErase()
        if (ok) {
          if (cmd === COMM.LISP_ERASE_CODE) {
            // The firmware stops the engine before erasing.
            this.running = false
            this.loop = null
            this.lispArea = new Uint8Array(AREA_MAX).fill(0xff)
          } else this.qmlArea = new Uint8Array(AREA_MAX).fill(0xff)
          this.erases.push({ kind: cmd === COMM.LISP_ERASE_CODE ? 'lisp' : 'qml', size })
        }
        return [{ data: Uint8Array.of(cmd, ok ? 1 : 0), delayMs: ok ? 400 : 20 }]
      }
      case COMM.LISP_WRITE_CODE:
      case COMM.QMLUI_WRITE: {
        const r = new BufferReader(body)
        const offset = r.u32()
        const data = r.rest()
        const area = cmd === COMM.LISP_WRITE_CODE ? this.lispArea : this.qmlArea
        // Flash only goes from 1 to 0, so writing over unerased bytes fails.
        const ok = !!area && offset + data.length <= area.length && data.every((b, i) => area[offset + i] === 0xff || area[offset + i] === b)
        if (ok) area.set(data, offset)
        return [Uint8Array.from([cmd, ok ? 1 : 0, ...new BufferWriter().u32(offset).toUint8Array()])]
      }
      case COMM.LISP_READ_CODE: {
        const r = new BufferReader(body)
        const len = Math.min(r.i32(), 502)
        const offset = r.i32()
        const program = this.storedProgram()
        const w = new BufferWriter().u8(cmd)
        if (!program || !this.lispArea) return [w.i32(0).i32(0).toUint8Array()]
        const total = program.length + 6
        const chunk = this.lispArea.subarray(Math.min(offset, total), Math.min(offset + len, total))
        return [w.i32(total).i32(offset).raw(chunk).toUint8Array()]
      }
      case COMM.LISP_SET_RUNNING: {
        const run = body[0] === 1
        let out: string[] = []
        if (run) out = this.start()
        else {
          this.running = false
          this.loop = null
        }
        const ok = !run || this.running
        return [Uint8Array.of(cmd, ok ? 1 : 0), ...out.map(lispPrint)]
      }
      case COMM.LISP_GET_STATS:
        // The firmware stays quiet while no script runs.
        return this.running ? [this.stats()] : []
      case COMM.GET_CUSTOM_CONFIG_XML: {
        const r = new BufferReader(body)
        const index = r.i8()
        const len = r.i32()
        const offset = r.i32()
        if (index !== 0 || !this.customConfigCount()) return []
        const xml = qCompressStored(new TextEncoder().encode(DEMO_LIGHTS_XML))
        const chunk = xml.subarray(offset, offset + Math.max(0, Math.min(len, 400)))
        return [new BufferWriter().u8(cmd).i8(index).i32(xml.length).i32(offset).raw(chunk).toUint8Array()]
      }
      case COMM.GET_CUSTOM_CONFIG:
      case COMM.GET_CUSTOM_CONFIG_DEFAULT: {
        const index = body[0]
        if (index !== 0 || !this.customConfigCount()) return []
        const defs = lightsDefs()
        const values = cmd === COMM.GET_CUSTOM_CONFIG ? (this.customValues ?? xmlDefaults(defs)) : xmlDefaults(defs)
        return [Uint8Array.from([cmd, index, ...encodeConfig(defs, values)])]
      }
      case COMM.SET_CUSTOM_CONFIG: {
        const index = body[0]
        if (index !== 0 || !this.customConfigCount()) return []
        try {
          this.customValues = decodeConfig(lightsDefs(), body.subarray(1))
        } catch {
          return [] // wrong layout: the package ignores it
        }
        return [{ data: Uint8Array.of(cmd, index), delayMs: 120 }]
      }
      default:
        return null
    }
  }
}

/** Just enough of printf for the examples' "%.1f" style formats. */
function formatC(format: string, v: number): string {
  return format.replace(/%(\.(\d+))?[fd]/, (_m, _p, digits) => (digits === undefined ? String(Math.round(v)) : v.toFixed(Number(digits))))
}
