import { describe, expect, it } from 'vitest'
import { Interp, LispError, NIL, read, showValue, T, topLevelForms, type Val } from './lispbm'

const run = (src: string, host?: Record<string, (...a: Val[]) => Val>) => new Interp({ host }).run(src)

describe('the LispBM runner', () => {
  it('keeps integers and floats apart, the way the controller does', () => {
    expect(run('(/ 5 2)')).toBe(2n)
    expect(run('(/ 5.0 2)')).toBe(2.5)
    expect(run('(+ 1 2.5)')).toBe(3.5)
    expect(run('(- 3)')).toBe(-3n)
    expect(showValue(run('(* 2.0 3)'))).toBe('6.0')
  })

  it('treats only nil as false: 0 is true', () => {
    expect(run('(if 0 1 2)')).toBe(1n)
    expect(run('(if nil 1 2)')).toBe(2n)
    expect(run('(if false 1 2)')).toBe(2n)
    expect(run('(and 1 0 5)')).toBe(5n)
    expect(run('(or nil 3)')).toBe(3n)
    expect(run('(not nil)')).toBe(T)
  })

  it('stops on the mistakes that would stop the controller', () => {
    expect(() => run('(+ 1 nil)')).toThrow(LispError)
    expect(() => run('(< nil 1)')).toThrow(LispError)
    expect(() => run('(+ 1 no-such-name)')).toThrow(/variable_not_bound: no-such-name/)
    expect(() => run('(no-such-function 1)')).toThrow(/variable_not_bound/)
    expect(() => run('(defun f (a b) a) (f 1)')).toThrow(/2 arguments was called with 1/)
    expect(() => run('(/ 1 0)')).toThrow(/Division by zero/)
    expect(() => run('(setq never-defined 1)')).toThrow(/variable_not_bound/)
    // Integers are 28 bits.
    expect(() => run('(* 100000 10000)')).toThrow(/overflow/)
    expect(() => run('(loopwhile t 1)')).toThrow(/too long/)
  })

  it('compares numbers by value and anything by shape', () => {
    expect(run('(= 1 1.0)')).toBe(T)
    expect(run('(eq 1 1.0)')).toBe(NIL)
    expect(run("(eq '(1 2) (list 1 2))")).toBe(T)
    expect(run('(eq nil nil)')).toBe(T)
  })

  it('runs functions, closures, let, cond and loops', () => {
    const src = `
      (def n 0)
      (defun add (x) (def n (+ n x)))
      (defun pick (x) (cond ((< x 0) 'neg) ((= x 0) 'zero) (t 'pos)))
      (let ((a 2) (b (* a 3))) (add b))
      (loopwhile (< n 20) (add 1))
      (list n (pick -1) (pick 0) (pick 5) ((lambda (a) (* a a)) 4))`
    expect(showValue(run(src))).toBe('(20 neg zero pos 16)')
  })

  it('calls the host’s functions and lets the host call the program’s', () => {
    const seen: Val[] = []
    const lisp = new Interp({ host: { 'get-rpm': () => 1234.5, 'set-current': (a) => (seen.push(a), T) } })
    lisp.run('(defun go (k) (set-current (* k (get-rpm))))')
    lisp.call('go', 2.0)
    expect(seen).toEqual([2469])
    expect(() => lisp.call('go')).toThrow(/1 arguments/)
  })

  it('writes byte arrays big-endian, like the firmware', () => {
    const b = run('(progn (def b (bufcreate 7)) (bufset-u8 b 0 87) (bufset-i16 b 1 -2) (bufset-f32 b 3 1.5) b)') as Uint8Array
    expect([...b]).toEqual([87, 0xff, 0xfe, 0x3f, 0xc0, 0, 0])
    expect(() => run('(bufset-f32 (bufcreate 3) 0 1.0)')).toThrow(/outside/)
  })

  it('reads comments, quotes and strings, and splits a program into one-line forms', () => {
    expect(read('; note\n(a "b;c" \'d) ; end')).toHaveLength(1)
    expect(topLevelForms('(def a 1) ; one\n(defun f (x)\n  ; the body\n  (+ x a))')).toEqual(['(def a 1)', '(defun f (x) (+ x a))'])
    expect(() => topLevelForms('(def a (+ 1 2)')).toThrow(/missing/)
  })
})
