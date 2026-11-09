// Splits LispBM source into coloured tokens for the editor. A simple scanner:
// comments, strings, characters, numbers (with LispBM's type suffixes), quote
// marks, brackets, special forms, t/nil and extension calls (get-…, set-…).

type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'constant' | 'quote' | 'paren' | 'symbol' | 'space'

export interface Token {
  kind: TokenKind
  text: string
  /** Bracket nesting depth, for colouring brackets. */
  depth?: number
}

const KEYWORDS = new Set([
  'def', 'define', 'defun', 'defunret', 'defmacro', 'lambda', 'closure', 'let', 'if', 'cond', 'progn', 'and', 'or', 'not', 'quote',
  'loopwhile', 'loopfor', 'loopforeach', 'loopwhile-thd', 'match', 'recv', 'recv-to', 'send', 'spawn', 'spawn-trap', 'setq', 'setvar',
  'set', 'var', 'import', 'move-to-flash', 'atomic', 'when', 'unless', 'case', 'break', 'return', 'trap', 'exit-ok', 'exit-error',
  'wait', 'yield', 'sleep', 'self', 'event-register-handler', 'loop', 'apply',
])
const CONSTANTS = new Set(['t', 'nil', 'true', 'false', 'pi', '_'])
const BUILTIN = /^(get|set|can|uart|gpio|i2c|foc|conf|bms|ext|lbm|str|buf|bufget|bufset|print|puts|rand|mod|abs|sqrt|exp|log|pow|sin|cos|tan|atan|atan2|list|car|cdr|cons|append|length|reverse|ix|setix|map|range|first|rest|to-|type-of|systime|secs-since|timeout|esp-now|wifi|tcp|ble|i2c|pwm|rgbled|disp|img|eeprom|fw|imu|lisp)/

const NUMBER = /^(-?(0x[0-9a-f]+|\d+\.\d*(e-?\d+)?|\.\d+|\d+(e-?\d+)?))(u8|i8|u16|i16|u32|i32|u64|i64|u|i|f32|f64|b)?$/i
const DELIM = /[\s()[\]{}"';`,]/

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let depth = 0
  let i = 0
  const push = (kind: TokenKind, text: string, d?: number) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && (kind === 'space' || kind === 'comment') && d === undefined) last.text += text
    else out.push(d === undefined ? { kind, text } : { kind, text, depth: d })
  }
  while (i < src.length) {
    const c = src[i]
    if (c === ';') {
      let j = src.indexOf('\n', i)
      if (j < 0) j = src.length
      push('comment', src.slice(i, j))
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      push('string', src.slice(i, Math.min(j + 1, src.length)))
      i = j + 1
    } else if (c === '\\' && src[i + 1] === '#') {
      // Character literal: \#a, \#newline
      let j = i + 3
      while (j < src.length && !DELIM.test(src[j])) j++
      push('string', src.slice(i, j))
      i = j
    } else if (c === '(' || c === '[' || c === '{') {
      push('paren', c, depth++)
      i++
    } else if (c === ')' || c === ']' || c === '}') {
      depth = Math.max(0, depth - 1)
      push('paren', c, depth)
      i++
    } else if (c === "'" || c === '`' || c === ',') {
      const at = src[i + 1] === '@' && c === ','
      push('quote', at ? ',@' : c)
      i += at ? 2 : 1
    } else if (/\s/.test(c)) {
      let j = i + 1
      while (j < src.length && /\s/.test(src[j])) j++
      push('space', src.slice(i, j))
      i = j
    } else {
      let j = i + 1
      while (j < src.length && !DELIM.test(src[j])) j++
      const word = src.slice(i, j)
      const prev = out.findLast((t) => t.kind !== 'space')
      const head = prev?.kind === 'paren' && '([{'.includes(prev.text)
      const kind: TokenKind = NUMBER.test(word)
        ? 'number'
        : CONSTANTS.has(word)
          ? 'constant'
          : KEYWORDS.has(word)
            ? 'keyword'
            : head && BUILTIN.test(word)
              ? 'builtin'
              : 'symbol'
      push(kind, word)
      i = j
    }
  }
  return out
}

/** Whether brackets balance, and where the first problem is (line, 1-based). */
export function bracketProblem(src: string): { line: number; message: string } | null {
  const stack: { ch: string; line: number }[] = []
  let line = 1
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\n') line++
    else if (c === ';') {
      while (i < src.length && src[i] !== '\n') i++
      line++
    } else if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') line++
        i += src[i] === '\\' ? 2 : 1
      }
      if (i >= src.length) return { line, message: 'A string is never closed.' }
    } else if (c === '\\' && src[i + 1] === '#') i += 2
    else if ('([{'.includes(c)) stack.push({ ch: c, line })
    else if (c in pairs) {
      const top = stack.pop()
      if (!top) return { line, message: `An extra “${c}” with nothing to close.` }
      if (top.ch !== pairs[c]) return { line, message: `“${c}” closes the “${top.ch}” opened on line ${top.line}.` }
    }
  }
  const open = stack.pop()
  return open ? { line: open.line, message: `The “${open.ch}” opened on line ${open.line} is never closed.` } : null
}
