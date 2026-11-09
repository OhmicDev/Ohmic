// LispBM scripts end to end against the simulated scooter: upload, run, the
// console, stats, and the checks before anything is written.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { connectLocal } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { useLisp } from './lisp'
import { useSession } from './session'
import { useSettings } from './settings'

const waitFor = waitForWithin(6000)
const lisp = () => useLisp.getState()

beforeEach(() => {
  useSettings.setState({ autoReconnect: false, pollHz: 20, deviceViews: {} })
  useLisp.setState({ lines: [], busy: null, error: null, notice: null, stats: {}, target: 'local' })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('LispBM scripts', () => {
  it('uploads, starts, prints, reads back, reports stats, stops and removes', async () => {
    const bus = await connectLocal()
    const code = '(print "Hello from the test")\n(def answer 42)\n'
    lisp().setCode(code)
    expect(await lisp().upload()).toBe(true)
    expect(bus.local.scripts.storedCode()).toBe(code)
    expect(bus.local.scripts.running).toBe(true)
    await waitFor(() => lisp().lines.some((l) => l.text === 'Hello from the test' && l.kind === 'out'))
    expect(lisp().dirty).toBe(false)

    expect(await lisp().readBack()).toBe(code)

    await lisp().pollStats()
    const st = lisp().stats.local
    expect(st.running).toBe(true)
    expect(st.stats?.bindings).toContainEqual({ name: 'answer', value: 42 })

    expect(await lisp().setRunning(false)).toBe(true)
    expect(bus.local.scripts.running).toBe(false)
    expect(await lisp().removeStored()).toBe(true)
    expect(bus.local.scripts.storedCode()).toBeNull()
    expect(await lisp().readBack()).toBe('')
  })

  it('sends REPL lines through the shared console queue', async () => {
    const bus = await connectLocal()
    await lisp().repl('(+ 1 2)')
    await waitFor(() => lisp().lines.some((l) => l.kind === 'out' && l.text.startsWith('>')))
    expect(lisp().lines.find((l) => l.kind === 'in')?.text).toBe('(+ 1 2)')
    expect(bus.local.lisp.dropped).toBe(0)
  })

  it('refuses to upload while a wheel turns, or a script too big for the controller', async () => {
    const bus = await connectLocal({ parked: false })
    await waitFor(() => bus.sim.speed > 2)
    await new Promise((r) => setTimeout(r, 120))
    lisp().setCode('(print "x")')
    expect(await lisp().upload()).toBe(false)
    expect(lisp().error).toMatch(/turning/)
    expect(bus.local.scripts.erases).toHaveLength(0)
    // Stopping a script is always allowed.
    expect(await lisp().setRunning(false)).toBe(true)

    bus.sim.parked = true
    await waitFor(() => bus.sim.speed === 0, 15000)
    await new Promise((r) => setTimeout(r, 150))
    lisp().setCode(`(def big "${'x'.repeat(132_000)}")`)
    expect(await lisp().upload()).toBe(false)
    expect(lisp().error).toMatch(/room for 131,066/)
  }, 20000)

  it('marks lines that answer Ohmic’s own programs', async () => {
    await connectLocal()
    const { runLisp } = await import('./onboard')
    await runLisp('local', '(list ohm-abs-on 0)')
    expect(lisp().lines.at(-1)?.kind).toBe('ohmic')
  })
})
