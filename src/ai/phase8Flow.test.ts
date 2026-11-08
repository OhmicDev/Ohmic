// AI Tune, end to end against the simulated scooter (two controllers: local + CAN 2),
// with the scripted backend standing in for the model.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockBus } from '../sim/mockBus'
import { db, listBackups } from '../state/backups'
import { useConfig } from '../state/config'
import { motionBlock } from '../state/motion'
import { useRideModes } from '../state/rideModes'
import { connectWith, useSession } from '../state/session'
import { AI_DEFAULTS, useSettings } from '../state/settings'
import { runWrites } from '../state/writes'
import { MockTransport } from '../transport/MockTransport'
import { TOOLS } from './agentSpec'
import { echoable, type AiBackend, type ContentBlock } from './backend'
import { blockedReason } from './blocklist'
import { demoBackend } from './demoBackend'
import { checkProposal, type ProposedChange } from './guardrails'
import { useAiLog } from './log'
import { EMPTY_PROFILE, packLimitA, parseProfileField, useProfile } from './profile'
import { schemaProblem } from './schema'
import { guardContext, runTool } from './tools'
import { setBackendForTests, useTune } from './tune'

async function waitFor(check: () => boolean, timeoutMs = 6000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const LOCAL = 'uuid:5e1a00000000000000000001'
const CAN2 = 'uuid:5e1a00000000000000000002'
const cfg = () => useConfig.getState()
const tune = () => useTune.getState()
const live = (bus: MockBus, key: string) => (key === LOCAL ? bus.local : bus.remotes.get(2)!).config!.values.mcconf
const change = (param: string, new_value: number, target = 'all'): ProposedChange => ({ param, target, new_value, reason: 'r', tradeoff: 't' })
const env = { onProposal: () => 'p', onRefused: () => {}, testWindows: [] }

async function connect({ parked = true } = {}) {
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => cfg().devices[LOCAL]?.appconf.status === 'ready' && cfg().devices[CAN2]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  await useRideModes.getState().load()
  return bus
}

const targets = () => [cfg().devices[LOCAL].target, cfg().devices[CAN2].target]

beforeEach(async () => {
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {}, singleMotorKey: null, ai: { ...AI_DEFAULTS } })
  await Promise.all([db.backups.clear(), db.liveLimits.clear(), db.rideModes.clear(), db.aiLog.clear(), db.aiProfile.clear()])
  useRideModes.setState({ activeId: null, motors: 'dual', test: null, busy: false, error: null, loaded: false })
  useProfile.setState({ profile: EMPTY_PROFILE, loaded: false })
  useAiLog.setState({ entries: [], loaded: true })
  setBackendForTests(demoBackend({ delayMs: 0 }))
  tune().newChat()
  useTune.setState({ proposals: {} })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('AI Tune building blocks', () => {
  it('checks tool input against the strict schemas', () => {
    const propose = TOOLS.find((t) => t.name === 'propose_config_changes')!.input_schema
    const ok = { summary: 's', risk_level: 'low', changes: [{ param: 'l_current_max', target: 'all', new_value: 50, reason: 'r', tradeoff: 't' }] }
    expect(schemaProblem(propose, ok)).toBeNull()
    expect(schemaProblem(propose, { ...ok, risk_level: 'extreme' })).toMatch(/risk_level/)
    expect(schemaProblem(propose, { ...ok, extra: 1 })).toMatch(/extra/)
    expect(schemaProblem(propose, { summary: 's', risk_level: 'low' })).toMatch(/changes/)
    expect(schemaProblem(propose, { ...ok, changes: [{ ...ok.changes[0], new_value: '50' }] })).toMatch(/new_value/)
    for (const t of TOOLS) {
      expect(t.strict).toBe(true)
      expect(t.input_schema.additionalProperties).toBe(false)
    }
  })

  it('drops the declined model’s blocks before a fallback, keeping text and the markers', () => {
    const content: ContentBlock[] = [
      { type: 'thinking', thinking: '', signature: 'a' },
      { type: 'text', text: 'partial' },
      { type: 'tool_use', id: 'x', name: 'get_device_snapshot', input: {} },
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'thinking', thinking: '', signature: 'b' },
      { type: 'text', text: 'rest' },
    ]
    expect(echoable(content).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking', 'text'])
    const plain: ContentBlock[] = [{ type: 'text', text: 'hi' }]
    expect(echoable(plain)).toBe(plain)
  })

  it('refuses bad profile values instead of adjusting them, and works out the pack limit', () => {
    expect(parseProfileField('cells_parallel', '2.5')).toEqual({ error: expect.stringMatching(/whole number/) })
    expect(parseProfileField('bms_limit_a', '5000')).toEqual({ error: expect.stringMatching(/1 to 1000/) })
    expect(parseProfileField('vehicle_type', 'E-Bike')).toEqual({ value: 'ebike' })
    expect(packLimitA({ ...EMPTY_PROFILE, cells_parallel: 4, cell_continuous_a: 20 })).toEqual({ amps: 80, from: '4 cells in parallel × 20 A' })
    expect(packLimitA({ ...EMPTY_PROFILE, cells_parallel: 4, cell_continuous_a: 20, bms_limit_a: 50 })?.amps).toBe(50)
    expect(packLimitA(EMPTY_PROFILE)).toBeNull()
  })

  it('keeps motor detection, protection and wiring settings off-limits', () => {
    for (const n of ['motor_type', 'foc_motor_r', 'foc_motor_flux_linkage', 'l_abs_current_max', 'l_max_vin', 'controller_id', 'app_to_use', 'foc_f_zv']) expect(blockedReason(n)).toBeTruthy()
    for (const n of ['l_current_max', 'l_in_current_max', 'l_max_erpm', 'app_adc_conf.ramp_time_pos']) expect(blockedReason(n)).toBeNull()
  })
})

describe('guardrails on the demo scooter', () => {
  it('refuses unsafe proposals with a reason for each', async () => {
    await connect()
    const check = (c: ProposedChange[]) => checkProposal(c, guardContext())
    const problems = (c: ProposedChange[]) => {
      const r = check(c)
      return r.ok ? [] : r.problems
    }
    expect(problems([change('foc_motor_r', 0.05)])[0]).toMatch(/off-limits/)
    expect(problems([change('l_in_current_max', 35)])[0]).toMatch(/pack’s limit is known/)
    expect(problems([change('l_in_current_max', 5001)]).join(' ')).toMatch(/isn’t allowed/)
    // Motor current above the controller's absolute limit (150 A on the demo).
    expect(problems([change('l_current_max', 160)]).join(' ')).toMatch(/Absolute maximum current/)
    expect(problems([change('l_max_duty', 120)]).join(' ')).toMatch(/isn’t allowed/)
    const tempDefault = Number(cfg().devices[LOCAL].mcconf.defaults!.l_temp_motor_end)
    expect(problems([change('l_temp_motor_end', tempDefault + 5)]).join(' ')).toMatch(/default/)
    expect(problems([change('l_battery_cut_end', 30)]).join(' ')).toMatch(/per cell|cell/)
    expect(problems([change('l_current_max', 50, 'can:9')])[0]).toMatch(/no controller/)
    expect(problems(Array.from({ length: 11 }, (_, i) => change('l_current_max', 40 + i)))[0]).toMatch(/At most 10/)
    expect(problems([change('l_current_max', 55)]).join(' ')).toMatch(/already/)

    // With the pack known, battery current may rise up to what it delivers in total.
    await useProfile.getState().update({ cells_parallel: 10, cell_continuous_a: 10 })
    expect(check([change('l_in_current_max', 45)]).ok).toBe(true)
    expect(problems([change('l_in_current_max', 55)])[0]).toMatch(/total 110 A across 2 controllers.*100 A/)
    // Lowering it is always fine.
    expect(check([change('l_in_current_max', 20)]).ok).toBe(true)
  }, 20000)

  it('validates tool input before running a tool', async () => {
    await connect()
    const bad = await runTool('get_params', { names: 'l_current_max', controller: 'local' }, env)
    expect(bad.isError).toBe(true)
    expect(bad.content).toMatch(/Invalid input/)
    const good = await runTool('get_params', { names: ['l_current_max', 'l_max_erpm'], controller: 'local' }, env)
    expect(good.isError).toBeFalsy()
    const rows = JSON.parse(good.content).params
    expect(rows[0]).toMatchObject({ name: 'l_current_max', value_number: 55, unit: 'A', can_test_live: false })
    expect(rows[1]).toMatchObject({ name: 'l_max_erpm', unit: 'ERPM', can_test_live: true })
  }, 20000)
})

describe('the agent loop and change cards', () => {
  it('proposes, runs a test in memory only, reads it back and ends it', async () => {
    const bus = await connect()
    await tune().send('I want more range.')
    const proposals = Object.values(tune().proposals)
    expect(proposals).toHaveLength(1)
    const p = proposals[0]
    expect(p.testable).toBe(true)
    expect(p.changes.map((c) => `${c.deviceKey}:${c.param}=${c.to}`)).toEqual([
      `${LOCAL}:l_in_current_max=22.5`,
      `${CAN2}:l_in_current_max=22.5`,
      `${LOCAL}:l_max_erpm=7800`,
      `${CAN2}:l_max_erpm=7800`,
    ])

    // History alternates and every tool call got exactly one result, in one message.
    const h = tune().history
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    for (let i = 1; i < h.length - 1; i += 2) {
      const uses = h[i].content.filter((b) => b.type === 'tool_use').map((b) => b.id)
      const results = h[i + 1].content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id)
      expect(results).toEqual(uses)
    }

    await waitFor(() => motionBlock(targets()) === null)
    expect(await tune().startTest(p.id)).toBeNull()
    expect(tune().proposals[p.id].status).toBe('testing')
    for (const key of [LOCAL, CAN2]) {
      expect(live(bus, key).l_in_current_max).toBe(22.5)
      expect(live(bus, key).l_max_erpm).toBe(7800)
    }
    // Memory only: nothing written to flash, and the editor still shows the stored values.
    expect(bus.local.config!.writes).toBe(0)
    expect(cfg().devices[LOCAL].mcconf.device!.l_in_current_max).toBe(30)

    expect(await tune().endTest()).toBeNull()
    expect(tune().proposals[p.id].status).toBe('tested')
    for (const key of [LOCAL, CAN2]) {
      expect(live(bus, key).l_in_current_max).toBe(30)
      expect(live(bus, key).l_max_erpm).toBe(100000)
    }
    expect(useAiLog.getState().entries.map((e) => e.event).reverse()).toEqual(['proposed', 'test-started', 'test-ended'])
  }, 30000)

  it('applies a stored-setting change permanently with a backup, and puts it back', async () => {
    const bus = await connect()
    await tune().send('My motor gets too hot. I want it to run cooler.')
    const p = Object.values(tune().proposals)[0]
    expect(p.testable).toBe(false)
    expect(await tune().startTest(p.id)).toMatch(/Only live limits/)

    await waitFor(() => motionBlock(targets()) === null)
    const plan = tune().applyPlan(p.id)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.items.map((i) => i.changes.map((c) => `${c.name}:${c.from}→${c.to}`))).toEqual([['l_current_max:55→46.8'], ['l_current_max:55→46.8']])
    tune().writeStarted(p.id, 'apply')
    const outcomes = await runWrites(plan.items, () => {})
    tune().writeFinished(p.id, 'apply', plan.items, outcomes)
    expect(outcomes.map((o) => o.status)).toEqual(['ok', 'ok'])
    expect(tune().proposals[p.id].status).toBe('applied')
    expect(live(bus, LOCAL).l_current_max).toBeCloseTo(46.8, 4)
    expect(live(bus, CAN2).l_current_max).toBeCloseTo(46.8, 4)
    expect((await listBackups()).length).toBeGreaterThanOrEqual(2)

    const back = tune().revertPlan(p.id)
    if ('error' in back) throw new Error(back.error)
    const outcomes2 = await runWrites(back.items, () => {})
    tune().writeFinished(p.id, 'revert', back.items, outcomes2)
    expect(tune().proposals[p.id].status).toBe('reverted')
    expect(live(bus, LOCAL).l_current_max).toBe(55)
    expect(useAiLog.getState().entries.map((e) => e.event).reverse()).toEqual(['proposed', 'applied', 'reverted'])
  }, 30000)

  it('edits are checked as a whole: all kept or none', async () => {
    await connect()
    await useProfile.getState().update({ cells_parallel: 20, cell_continuous_a: 10, bms_limit_a: 150 })
    await tune().send('I want more power.')
    const p = Object.values(tune().proposals)[0]
    expect(p.changes.map((c) => c.to)).toEqual([37.5, 37.5])
    expect(tune().edit(p.id, [80, 80])?.join(' ')).toMatch(/total 160 A/)
    expect(tune().proposals[p.id].changes.map((c) => c.to)).toEqual([37.5, 37.5])
    expect(tune().edit(p.id, [70, 70])).toBeNull()
    expect(tune().proposals[p.id].changes.map((c) => c.to)).toEqual([70, 70])
  }, 30000)

  it('asks for the pack before raising battery current, saving the answer to the profile', async () => {
    await connect()
    await tune().send('I want more power.')
    expect(Object.keys(tune().proposals)).toHaveLength(0)
    await tune().send('It has 10P of 15 A cells')
    expect(useProfile.getState().profile).toMatchObject({ cells_parallel: 10, cell_continuous_a: 15, fromChat: ['cells_parallel', 'cell_continuous_a'] })
    const p = Object.values(tune().proposals)[0]
    expect(p.changes.map((c) => c.to)).toEqual([37.5, 37.5])
  }, 30000)

  it('won’t start a test while a wheel is turning', async () => {
    await connect({ parked: false })
    await waitFor(() => motionBlock(targets())?.includes('turning') ?? false)
    await tune().send('I want more range.')
    const p = Object.values(tune().proposals)[0]
    expect(await tune().startTest(p.id)).toMatch(/turning/)
    expect(useRideModes.getState().test).toBeNull()
  }, 30000)

  it('leaves a refused exchange out of the conversation', async () => {
    setBackendForTests({ kind: 'demo', send: async () => ({ content: [], stop_reason: 'refusal' }) })
    await tune().send('hello')
    expect(tune().history).toEqual([])
    expect(tune().items.some((i) => i.kind === 'notice' && i.tone === 'warn')).toBe(true)
  })

  it('doesn’t run a tool call cut off at the length limit, and tells the model', async () => {
    let n = 0
    const backend: AiBackend = {
      kind: 'demo',
      send: async () =>
        ++n === 1
          ? { content: [{ type: 'tool_use', id: 't1', name: 'get_device_snapshot', input: {} }], stop_reason: 'max_tokens' }
          : { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
    }
    setBackendForTests(backend)
    await tune().send('hello')
    const h = tune().history
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(h[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: true })
    expect(tune().items.some((i) => i.kind === 'tool')).toBe(false)
  })

  it('sends nothing when AI Tune is off', async () => {
    let calls = 0
    setBackendForTests({ kind: 'demo', send: async () => (calls++, { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' }) })
    useSettings.getState().setAi({ enabled: false })
    await tune().send('hello')
    expect(calls).toBe(0)
    expect(tune().history).toEqual([])
  })
})
