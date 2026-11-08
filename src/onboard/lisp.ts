// Helpers for sending LispBM through the firmware's script console.
//
// A console command travels as one packet, and controllers take payloads of
// about 512 bytes (less once forwarded over CAN), so programs are sent as several
// short commands: definitions first, then one that starts them.

/** Longest console command sent, in characters (ASCII only). */
export const MAX_CMD = 440

/** Numbers as LispBM reads them: floats always with a decimal point. */
export function lf(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Not a number')
  const s = Number(n.toPrecision(6)).toString()
  if (s.includes('e')) return n.toFixed(9)
  return s.includes('.') ? s : `${s}.0`
}

/** Whole numbers as LispBM integers. */
export function li(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Not a number')
  return String(Math.round(n))
}

export class ProgramTooLongError extends Error {}

/** Packs expressions into as few commands as fit, keeping their order. */
export function packCommands(exprs: string[], limit = MAX_CMD): string[] {
  const out: string[] = []
  let cur: string[] = []
  const wrap = (xs: string[]) => (xs.length === 1 ? xs[0] : `(progn ${xs.join(' ')})`)
  for (const e of exprs) {
    if (e.length > limit) throw new ProgramTooLongError(`A program part is ${e.length} characters; the limit is ${limit}.`)
    if (cur.length && wrap([...cur, e]).length > limit) {
      out.push(wrap(cur))
      cur = []
    }
    cur.push(e)
  }
  if (cur.length) out.push(wrap(cur))
  return out
}

/** Collapses the whitespace used to lay programs out readably here. */
export const squash = (code: string) => code.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim()
