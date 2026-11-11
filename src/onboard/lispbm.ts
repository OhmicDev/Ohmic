// A small LispBM interpreter, so tests and the demo can run the programs Ohmic
// sends to controllers against a simulated vehicle, instead of a copy of them.
//
// It follows LispBM where getting it wrong would hide a bug on the real thing:
//   - integers and floats are different types: (/ 5 2) is 2, and integers are
//     28 bits on the controller, so a counter that would overflow is an error;
//   - only nil is false: 0 is true;
//   - arithmetic or comparison on nil (say, a "never received" reading) is an
//     error, and so is using a name that was never defined;
//   - a function called with the wrong number of arguments is an error.
// It only knows the forms and functions Ohmic's programs use. Anything else is an
// error too, so a typo in a function name shows up in the tests.

export class Sym {
  readonly name: string
  constructor(name: string) {
    this.name = name
  }
  toString() {
    return this.name
  }
}

const symbols = new Map<string, Sym>()
export function sym(name: string): Sym {
  let s = symbols.get(name)
  if (!s) {
    s = new Sym(name)
    symbols.set(name, s)
  }
  return s
}

export const NIL = sym('nil')
export const T = sym('t')

export interface Closure {
  kind: 'closure'
  params: Sym[]
  body: Val[]
  env: Env
}
export interface Native {
  kind: 'native'
  name: string
  fn: (args: Val[]) => Val
}
/** Integers are bigint and floats are number, so the two never mix by accident. */
export type Val = bigint | number | string | Sym | Val[] | Closure | Native | Uint8Array

export class LispError extends Error {}

export type Env = { vars: Map<string, Val>; up: Env | null }

const INT_LIMIT = 2n ** 27n

// ---- Reading ----

export function read(src: string): Val[] {
  const tokens = src.match(/;[^\n]*|"(?:[^"\\]|\\.)*"|[()']|[^\s()';"]+/g) ?? []
  let i = 0
  const one = (): Val => {
    const t = tokens[i++]
    if (t === undefined) throw new LispError('Unexpected end of program (a parenthesis is missing).')
    if (t === '(') {
      const out: Val[] = []
      while (tokens[i] !== ')') {
        if (tokens[i] === undefined) throw new LispError('Unexpected end of program (a parenthesis is missing).')
        if (tokens[i].startsWith(';') || tokens[i].startsWith('@')) {
          i++
          continue
        }
        out.push(one())
      }
      i++
      return out.length ? out : NIL
    }
    if (t === ')') throw new LispError('Unexpected ")".')
    if (t === "'") return [sym('quote'), one()]
    if (t.startsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, '$1')
    if (/^-?\d+$/.test(t)) return checkInt(BigInt(t))
    if (/^-?\d+\.\d+$/.test(t) || /^-?\d+\.\d+e-?\d+$/.test(t)) return Number(t)
    return sym(t)
  }
  const out: Val[] = []
  while (i < tokens.length) {
    // Comments, and directives such as @const-start, which only say where the firmware keeps the code.
    if (tokens[i].startsWith(';') || tokens[i].startsWith('@')) {
      i++
      continue
    }
    out.push(one())
  }
  return out
}

// ---- Values ----

const isList = (v: Val): v is Val[] => Array.isArray(v)
const truthy = (v: Val) => v !== NIL
const bool = (b: boolean): Val => (b ? T : NIL)

function checkInt(n: bigint): bigint {
  if (n >= INT_LIMIT || n < -INT_LIMIT) throw new LispError(`Integer overflow: ${n} doesn't fit LispBM's 28-bit integers.`)
  return n
}

function show(v: Val): string {
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(1) : String(Number(v.toPrecision(7)))
  if (typeof v === 'string') return JSON.stringify(v)
  if (v instanceof Sym) return v.name
  if (isList(v)) return `(${v.map(show).join(' ')})`
  if (v instanceof Uint8Array) return `[${v.join(' ')}]`
  return v.kind === 'native' ? v.name : 'closure'
}
export { show as showValue }

function numArg(v: Val, what: string): bigint | number {
  if (typeof v === 'bigint' || typeof v === 'number') return v
  throw new LispError(`${what}: expected a number, got ${show(v)}.`)
}

/** As a float, the way LispBM converts for math functions. */
export function toNum(v: Val, what = 'value'): number {
  const n = numArg(v, what)
  return typeof n === 'bigint' ? Number(n) : n
}

function arith(op: string, args: Val[]): Val {
  const ns = args.map((a) => numArg(a, op))
  if (op === '-' && ns.length === 1) {
    const n = ns[0]
    return typeof n === 'bigint' ? checkInt(-n) : -n
  }
  if (!ns.length) {
    if (op === '+') return 0n
    if (op === '*') return 1n
    throw new LispError(`${op} needs arguments.`)
  }
  const float = ns.some((n) => typeof n === 'number')
  if (float) {
    const fs = ns.map(Number)
    return fs.slice(1).reduce((a, b) => {
      if (op === '/' && b === 0) throw new LispError('Division by zero.')
      return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
    }, fs[0])
  }
  const is = ns as bigint[]
  return checkInt(
    is.slice(1).reduce((a, b) => {
      if (op === '/' && b === 0n) throw new LispError('Division by zero.')
      return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
    }, is[0]),
  )
}

function compare(op: string, args: Val[]): Val {
  if (args.length < 2) throw new LispError(`${op} needs two arguments.`)
  const ns = args.map((a) => toNum(a, op))
  for (let i = 1; i < ns.length; i++) {
    const [a, b] = [ns[i - 1], ns[i]]
    const ok = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : a === b
    if (!ok) return NIL
  }
  return T
}

function eq(a: Val, b: Val): boolean {
  if (typeof a === 'bigint' || typeof a === 'number') return typeof a === typeof b && a === b
  if (isList(a) && isList(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]))
  return a === b
}

function bufArgs(name: string, args: Val[]): [Uint8Array, number] {
  const [buf, idx] = args
  if (!(buf instanceof Uint8Array)) throw new LispError(`${name}: expected a byte array.`)
  const i = Number(numArg(idx, name))
  return [buf, i]
}

// ---- Evaluating ----

export interface InterpOptions {
  /** Functions the host provides (the VESC extensions), by name. */
  host?: Record<string, (...args: Val[]) => Val>
  /** Steps one top-level evaluation may take before it's called stuck. */
  stepLimit?: number
}

export class Interp {
  readonly globals = new Map<string, Val>()
  private readonly natives = new Map<string, Native>()
  private steps = 0
  private readonly stepLimit: number
  /** Steps the last top-level evaluation or call took: a rough measure of its cost on the controller. */
  lastSteps = 0

  constructor(opts: InterpOptions = {}) {
    this.stepLimit = opts.stepLimit ?? 2_000_000
    const n = (name: string, fn: (args: Val[]) => Val) => this.natives.set(name, { kind: 'native', name, fn })
    for (const op of ['+', '-', '*', '/']) n(op, (a) => arith(op, a))
    for (const op of ['<', '>', '<=', '>=', '=']) n(op, (a) => compare(op, a))
    n('mod', ([a, b]) => {
      const [x, y] = [numArg(a, 'mod'), numArg(b, 'mod')]
      if (typeof x === 'bigint' && typeof y === 'bigint') {
        if (y === 0n) throw new LispError('Division by zero.')
        return x % y
      }
      return Number(x) % Number(y)
    })
    n('eq', ([a, b]) => bool(eq(a, b)))
    n('not', ([a]) => bool(!truthy(a)))
    n('list', (a) => (a.length ? a : NIL))
    n('ix', ([l, i]) => {
      const k = Number(numArg(i, 'ix'))
      if (!isList(l)) return NIL
      const at = k < 0 ? l.length + k : k
      return l[at] ?? NIL
    })
    n('length', ([l]) => BigInt(isList(l) ? l.length : 0))
    const math = (name: string, f: (...x: number[]) => number) => n(name, (a) => f(...a.map((x) => toNum(x, name))))
    math('sqrt', (x) => {
      if (x < 0) throw new LispError('sqrt of a negative number.')
      return Math.sqrt(x)
    })
    math('sin', Math.sin)
    math('cos', Math.cos)
    math('tan', Math.tan)
    math('atan', Math.atan)
    math('atan2', Math.atan2)
    math('deg2rad', (x) => (x * Math.PI) / 180)
    math('rad2deg', (x) => (x * 180) / Math.PI)
    math('floor', Math.floor)
    math('round', Math.round)
    n('abs', ([a]) => {
      const x = numArg(a, 'abs')
      return typeof x === 'bigint' ? (x < 0n ? -x : x) : Math.abs(x)
    })
    n('to-float', ([a]) => toNum(a, 'to-float'))
    n('to-i', ([a]) => {
      const x = numArg(a, 'to-i')
      return typeof x === 'bigint' ? x : checkInt(BigInt(Math.trunc(x)))
    })
    n('bufcreate', ([a]) => new Uint8Array(Number(numArg(a, 'bufcreate'))))
    n('buflen', ([b]) => BigInt(b instanceof Uint8Array ? b.length : 0))
    const setter = (name: string, size: number, put: (v: DataView, x: number) => void) =>
      n(name, (args) => {
        const [buf, i] = bufArgs(name, args)
        if (i < 0 || i + size > buf.length) throw new LispError(`${name}: index ${i} is outside the array.`)
        put(new DataView(buf.buffer, buf.byteOffset + i, size), toNum(args[2], name))
        return T
      })
    setter('bufset-u8', 1, (v, x) => v.setUint8(0, x & 0xff))
    setter('bufset-i8', 1, (v, x) => v.setInt8(0, Math.trunc(x)))
    setter('bufset-i16', 2, (v, x) => v.setInt16(0, Math.trunc(x)))
    setter('bufset-f32', 4, (v, x) => v.setFloat32(0, x))
    for (const [name, fn] of Object.entries(opts.host ?? {})) n(name, (a) => fn(...a))
  }

  /** Reads and evaluates a whole program; returns the last value. */
  run(src: string): Val {
    let last: Val = NIL
    for (const form of read(src)) last = this.evalTop(form)
    return last
  }

  /** Evaluates one top-level form, with a fresh step budget. */
  evalTop(form: Val): Val {
    return this.evalIn(form, null)
  }

  /** Evaluates a form inside a closure's environment, as a thread running that closure would. */
  evalIn(form: Val, env: Env | null): Val {
    this.steps = 0
    try {
      return this.eval(form, env)
    } finally {
      this.lastSteps = this.steps
    }
  }

  /** Calls a global function by name, as the firmware's thread would. */
  call(name: string, ...args: Val[]): Val {
    this.steps = 0
    try {
      return this.apply(this.lookup(sym(name), null), args)
    } finally {
      this.lastSteps = this.steps
    }
  }

  get(name: string): Val | undefined {
    return this.globals.get(name)
  }

  num(name: string): number {
    const v = this.globals.get(name)
    if (v === undefined) throw new LispError(`${name} is not defined.`)
    return toNum(v, name)
  }

  private lookup(s: Sym, env: Env | null): Val {
    for (let e = env; e; e = e.up) if (e.vars.has(s.name)) return e.vars.get(s.name)!
    const g = this.globals.get(s.name)
    if (g !== undefined) return g
    const nat = this.natives.get(s.name)
    if (nat) return nat
    throw new LispError(`variable_not_bound: ${s.name}`)
  }

  private eval(x: Val, env: Env | null): Val {
    if (++this.steps > this.stepLimit) throw new LispError('The program ran too long without returning (a loop that never ends?).')
    if (x instanceof Sym) {
      if (x === NIL || x === T || x.name === 'false' || x.name === 'true') return x.name === 'false' ? NIL : x.name === 'true' ? T : x
      return this.lookup(x, env)
    }
    if (!isList(x)) return x
    const [head, ...rest] = x
    if (head instanceof Sym) {
      switch (head.name) {
        case 'quote':
          return rest[0]
        case 'if': {
          if (rest.length < 2 || rest.length > 3) throw new LispError('if takes a test, a then and an optional else.')
          return truthy(this.eval(rest[0], env)) ? this.eval(rest[1], env) : rest.length === 3 ? this.eval(rest[2], env) : NIL
        }
        case 'cond': {
          for (const clause of rest) {
            if (!isList(clause)) throw new LispError('cond clauses are lists.')
            if (truthy(this.eval(clause[0], env))) return this.body(clause.slice(1), env)
          }
          return NIL
        }
        case 'progn':
          return this.body(rest, env)
        case 'and': {
          let v: Val = T
          for (const r of rest) if (!truthy((v = this.eval(r, env)))) return NIL
          return v
        }
        case 'or': {
          for (const r of rest) {
            const v = this.eval(r, env)
            if (truthy(v)) return v
          }
          return NIL
        }
        case 'let': {
          const binds = rest[0]
          const local: Env = { vars: new Map(), up: env }
          if (isList(binds)) {
            for (const b of binds) {
              if (!isList(b) || !(b[0] instanceof Sym)) throw new LispError('let binds (name value) pairs.')
              local.vars.set(b[0].name, this.eval(b[1], local))
            }
          }
          return this.body(rest.slice(1), local)
        }
        case 'setq': {
          const [name, valueX] = rest
          if (!(name instanceof Sym)) throw new LispError('setq sets a name.')
          const v = this.eval(valueX, env)
          for (let e = env; e; e = e.up) {
            if (e.vars.has(name.name)) {
              e.vars.set(name.name, v)
              return v
            }
          }
          if (!this.globals.has(name.name)) throw new LispError(`variable_not_bound: ${name.name}`)
          this.globals.set(name.name, v)
          return v
        }
        case 'def':
        case 'define': {
          const [name, valueX] = rest
          if (!(name instanceof Sym)) throw new LispError('def defines a name.')
          const v = this.eval(valueX, env)
          this.globals.set(name.name, v)
          return name
        }
        case 'defun': {
          const [name, params, ...body] = rest
          if (!(name instanceof Sym)) throw new LispError('defun needs a name.')
          this.globals.set(name.name, this.closure(params, body, env))
          return name
        }
        case 'lambda':
          return this.closure(rest[0], rest.slice(1), env)
        case 'loopwhile': {
          const [test, ...body] = rest
          while (truthy(this.eval(test, env))) this.body(body, env)
          return T
        }
      }
    }
    const fn = this.eval(head, env)
    return this.apply(
      fn,
      rest.map((r) => this.eval(r, env)),
    )
  }

  private closure(params: Val, body: Val[], env: Env | null): Closure {
    const ps = params === NIL ? [] : params
    if (!isList(ps) || !ps.every((p): p is Sym => p instanceof Sym)) throw new LispError('Parameters are a list of names.')
    return { kind: 'closure', params: ps, body, env: env ?? { vars: new Map(), up: null } }
  }

  private body(forms: Val[], env: Env | null): Val {
    let v: Val = NIL
    for (const f of forms) v = this.eval(f, env)
    return v
  }

  private apply(fn: Val, args: Val[]): Val {
    if (typeof fn === 'object' && !isList(fn) && !(fn instanceof Sym) && !(fn instanceof Uint8Array)) {
      if (fn.kind === 'native') return fn.fn(args)
      if (args.length !== fn.params.length) throw new LispError(`A function taking ${fn.params.length} arguments was called with ${args.length}.`)
      const local: Env = { vars: new Map(fn.params.map((p, i) => [p.name, args[i]])), up: fn.env }
      return this.body(fn.body, local)
    }
    throw new LispError(`${show(fn)} is not a function.`)
  }
}

/** Top-level forms of a program, each written out on one line without comments. */
export function topLevelForms(src: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === ';') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '"') inStr = true
    else if (c === '(') {
      if (depth === 0) start = i
      depth++
    } else if (c === ')') {
      depth--
      if (depth < 0) throw new LispError('Unexpected ")".')
      if (depth === 0) out.push(squashForm(src.slice(start, i + 1)))
    }
  }
  if (depth !== 0) throw new LispError('A parenthesis is missing.')
  return out
}

/** One form on one line: comments gone, whitespace collapsed. */
export function squashForm(code: string): string {
  return code
    .replace(/;[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .trim()
}
