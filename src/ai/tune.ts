// The AI Tune conversation: the agent loop (model ↔ tools), the change cards it
// produces, and what the rider does with them (test mode, apply, edit, reject,
// revert). Nothing here writes settings by itself: permanent changes go through
// the write dialog (validate, review, backup, write, read back), and test mode
// sends live limits to memory only.

import { create } from 'zustand'
import { toDisplay } from '../config/display'
import { makeItem, type WriteItem, type WriteOutcome } from '../config/write'
import { TEMP_FIELDS, TEMP_KEYS, type TempLimits } from '../protocol/setup'
import { useConfig } from '../state/config'
import { motionBlock } from '../state/motion'
import { useRideModes, type LimitTest } from '../state/rideModes'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import { checkServer, echoable, serverBackend, type AiBackend, type ContentBlock, type MessageParam } from './backend'
import { demoBackend } from './demoBackend'
import { checkProposal, type ProposedChange, type ResolvedChange } from './guardrails'
import { useAiLog } from './log'
import { guardContext, runTool, type ToolEnv } from './tools'

/** Model ↔ tool round trips per message before the loop stops itself. */
export const MAX_ROUNDS = 12

export type ProposalStatus = 'open' | 'testing' | 'tested' | 'applied' | 'rejected' | 'reverted' | 'failed'

export interface Proposal {
  id: string
  summary: string
  risk: 'low' | 'medium' | 'high'
  changes: ResolvedChange[]
  status: ProposalStatus
  createdAt: number
  /** Every change is a live limit, so it can run as a test. */
  testable: boolean
  /** Last thing that happened, for the card. */
  note?: string
}

export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean }
  | { id: string; kind: 'tool'; label: string; error: boolean }
  | { id: string; kind: 'proposal'; proposalId: string }
  | { id: string; kind: 'notice'; text: string; tone: 'info' | 'warn' | 'error' }

export type BackendState = 'checking' | 'server' | 'demo'

interface TuneState {
  backend: BackendState
  model: string | null
  /** Why the server isn't used, when it isn't. */
  serverProblem: string | null
  history: MessageParam[]
  items: ChatItem[]
  proposals: Record<string, Proposal>
  running: boolean
  /** What the model is doing right now, for the status line. */
  activity: string | null
  detect: () => Promise<void>
  send: (text: string) => Promise<void>
  stop: () => void
  newChat: () => void
  reject: (id: string) => void
  /** New values for a card's rows (in the card's units), checked together: all are kept or none. Returns problems, or null. */
  edit: (id: string, values: number[]) => string[] | null
  /** Starts the proposal as a test (live limits, memory only). Returns an error, or null. */
  startTest: (id: string) => Promise<string | null>
  endTest: () => Promise<string | null>
  /** The writes that make a proposal permanent (or a problem). */
  applyPlan: (id: string) => { items: WriteItem[] } | { error: string }
  /** The writes that put a proposal's old values back. */
  revertPlan: (id: string) => { items: WriteItem[] } | { error: string }
  /** Called by the write dialog. */
  writeStarted: (id: string, mode: 'apply' | 'revert') => void
  writeFinished: (id: string, mode: 'apply' | 'revert', items: WriteItem[], outcomes: WriteOutcome[]) => void
}

let backendImpl: AiBackend = demoBackend()
let controller: AbortController | null = null
let seq = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`

/** Lets tests use a fast scripted backend, or any other. */
export function setBackendForTests(b: AiBackend) {
  backendImpl = b
  useTune.setState({ backend: b.kind === 'server' ? 'server' : 'demo', model: null, serverProblem: null })
}

const changeLines = (changes: ResolvedChange[]) => changes.map((c) => `${c.label} (${c.deviceName}): ${c.shownFrom} → ${c.shownTo}`)

/** The changes as the assistant would propose them, to check again. */
const asProposed = (changes: ResolvedChange[]): ProposedChange[] =>
  changes.map((c) => ({ param: c.param, target: c.deviceId, new_value: c.newValue, reason: c.reason, tradeoff: c.tradeoff }))

/** When limit tests ran, from the log (so a ride summary can say whether one was on). */
function testWindows(): ToolEnv['testWindows'] {
  const entries = [...useAiLog.getState().entries].reverse()
  const open = new Map<string, { label: string; from: number }>()
  const out: ToolEnv['testWindows'] = []
  for (const e of entries) {
    if (e.event === 'test-started') open.set(e.proposalId, { label: e.summary, from: e.at })
    else if (e.event === 'test-ended' || e.event === 'applied') {
      const o = open.get(e.proposalId)
      if (o) out.push({ ...o, to: e.at })
      open.delete(e.proposalId)
    }
  }
  const running = useRideModes.getState().test
  for (const [id, o] of open) out.push({ ...o, to: running?.id === id ? null : o.from })
  return out.reverse()
}

/** Groups changes into one write per controller and settings kind. */
function writesFor(changes: ResolvedChange[], pick: (c: ResolvedChange) => number): { items: WriteItem[] } | { error: string } {
  const devices = useConfig.getState().devices
  const groups = new Map<string, ResolvedChange[]>()
  for (const c of changes) {
    const k = `${c.deviceKey}|${c.kind}`
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  const items: WriteItem[] = []
  for (const list of groups.values()) {
    const { deviceKey, kind } = list[0]
    const d = devices[deviceKey]
    const k = d?.[kind]
    if (!d || !k || k.status !== 'ready' || !k.defs || !k.device) return { error: `${list[0].deviceName}’s settings aren’t loaded. Reconnect and try again.` }
    const after = { ...k.device }
    for (const c of list) after[c.param] = pick(c)
    const item = makeItem({ key: d.key, target: d.target, deviceName: d.name, kind, defs: k.defs, before: k.device, after })
    if (item.changes.length) items.push(item)
  }
  return items.length ? { items } : { error: 'The controllers already have these values.' }
}

export const useTune = create<TuneState>()((set, get) => {
  const addItem = (item: ChatItem) => set((s) => ({ items: [...s.items, item] }))
  const patchItem = (id: string, f: (i: ChatItem) => ChatItem) => set((s) => ({ items: s.items.map((i) => (i.id === id ? f(i) : i)) }))
  const notice = (text: string, tone: 'info' | 'warn' | 'error' = 'info') => addItem({ id: uid('n'), kind: 'notice', text, tone })
  const setProposal = (id: string, patch: Partial<Proposal>) =>
    set((s) => (s.proposals[id] ? { proposals: { ...s.proposals, [id]: { ...s.proposals[id], ...patch } } } : {}))
  const log = (p: Proposal, event: Parameters<ReturnType<typeof useAiLog.getState>['add']>[0]['event'], detail?: string, changes = p.changes) =>
    void useAiLog.getState().add({ proposalId: p.id, event, summary: p.summary, changes: changeLines(changes), detail })

  const env = (): ToolEnv => ({
    onProposal: ({ summary, risk, changes }) => {
      const id = uid('p')
      const p: Proposal = { id, summary, risk, changes, status: 'open', createdAt: Date.now(), testable: changes.every((c) => c.live) }
      set((s) => ({ proposals: { ...s.proposals, [id]: p } }))
      addItem({ id: uid('c'), kind: 'proposal', proposalId: id })
      log(p, 'proposed')
      return id
    },
    onRefused: (summary, problems) => void useAiLog.getState().add({ proposalId: uid('r'), event: 'refused', summary, changes: [], detail: problems.join(' ') }),
    testWindows: testWindows(),
  })

  /** One message from the rider: model and tools take turns until the model is done. */
  const loop = async (signal: AbortSignal, before: MessageParam[]) => {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const textId = uid('a')
      addItem({ id: textId, kind: 'assistant', text: '', streaming: true })
      set({ activity: 'Thinking…' })
      let reply
      try {
        reply = await backendImpl.send(
          get().history,
          {
            onText: (t) => {
              set({ activity: null })
              patchItem(textId, (i) => (i.kind === 'assistant' ? { ...i, text: i.text + t } : i))
            },
            onThinking: () => set({ activity: 'Thinking…' }),
            onTool: (name) => set({ activity: TOOL_ACTIVITY[name] ?? 'Working…' }),
          },
          signal,
        )
      } catch (e) {
        finishText(textId)
        if (signal.aborted) notice('Stopped.')
        else notice(e instanceof Error ? e.message : String(e), 'error')
        return
      }
      finishText(textId)

      if (reply.stop_reason === 'refusal') {
        // Nothing from this exchange is kept, so the conversation stays valid.
        set({ history: before })
        notice('The assistant declined this request, so it was left out of the conversation. Try asking a different way.', 'warn')
        return
      }
      const content = echoable(reply.content)
      set((s) => ({ history: [...s.history, { role: 'assistant', content }] }))
      if (reply.stop_reason === 'pause_turn') continue
      const uses = content.filter((b) => b.type === 'tool_use')
      if (reply.stop_reason === 'max_tokens') {
        if (!uses.length) {
          notice('The reply hit the length limit and was cut off. Ask it to continue, or to keep it shorter.', 'warn')
          return
        }
        // A tool call may be cut off mid-way: none are run; the model is told to send them again.
        pushUser(uses.map((u) => toolResult(u, 'Your reply hit the length limit, so this call may be incomplete and was not run. Send it again (shorter if you can).', true)))
        continue
      }
      if (!uses.length) return

      const results: ContentBlock[] = []
      const e = env()
      for (const u of uses) {
        if (signal.aborted) {
          results.push(toolResult(u, 'The rider stopped the assistant before this ran.', true))
          continue
        }
        set({ activity: TOOL_ACTIVITY[String(u.name)] ?? 'Working…' })
        const r = await runTool(String(u.name), u.input, e)
        // A shown proposal is its own card; no extra line for it.
        if (u.name !== 'propose_config_changes' || r.isError) addItem({ id: uid('t'), kind: 'tool', label: r.label, error: !!r.isError })
        results.push(toolResult(u, r.content, r.isError))
      }
      // Every result goes back in one message.
      pushUser(results)
      if (signal.aborted) {
        notice('Stopped.')
        return
      }
    }
    notice(`The assistant stopped after ${MAX_ROUNDS} steps. Send another message to carry on.`, 'warn')
  }

  const finishText = (id: string) => {
    const item = get().items.find((i) => i.id === id)
    if (item?.kind === 'assistant' && !item.text.trim()) set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
    else patchItem(id, (i) => (i.kind === 'assistant' ? { ...i, streaming: false } : i))
  }

  /** Adds to the conversation as the rider; joins the last message when it's the rider's too (tool results first). */
  const pushUser = (blocks: ContentBlock[]) =>
    set((s) => {
      const last = s.history[s.history.length - 1]
      if (last?.role === 'user') return { history: [...s.history.slice(0, -1), { role: 'user', content: [...last.content, ...blocks] }] }
      return { history: [...s.history, { role: 'user', content: blocks }] }
    })

  return {
    backend: 'checking',
    model: null,
    serverProblem: null,
    history: [],
    items: [],
    proposals: {},
    running: false,
    activity: null,

    detect: async () => {
      set({ backend: 'checking' })
      const code = useSettings.getState().ai.accessCode.trim()
      const s = await checkServer(undefined, code)
      if (s.ok) {
        backendImpl = serverBackend(undefined, code)
        set({ backend: 'server', model: s.model, serverProblem: null })
      } else {
        backendImpl = demoBackend()
        set({ backend: 'demo', model: null, serverProblem: s.reason })
      }
    },

    send: async (raw) => {
      const text = raw.trim()
      if (!text || get().running) return
      if (!useSettings.getState().ai.enabled) {
        notice('AI Tune is turned off. Turn it on above to use it.', 'warn')
        return
      }
      const before = get().history
      controller = new AbortController()
      set({ running: true, activity: 'Thinking…' })
      addItem({ id: uid('u'), kind: 'user', text })
      pushUser([{ type: 'text', text }])
      try {
        await loop(controller.signal, before)
      } finally {
        controller = null
        set({ running: false, activity: null })
      }
    },

    stop: () => controller?.abort(),

    newChat: () => {
      controller?.abort()
      set({ history: [], items: [], running: false, activity: null })
    },

    reject: (id) => {
      const p = get().proposals[id]
      if (!p || (p.status !== 'open' && p.status !== 'tested')) return
      setProposal(id, { status: 'rejected', note: 'You rejected this.' })
      log(p, 'rejected')
    },

    edit: (id, values) => {
      const p = get().proposals[id]
      if (!p || p.status !== 'open') return ['Only a proposal that hasn’t been tried or applied can be edited.']
      if (values.length !== p.changes.length || !values.every(Number.isFinite)) return ['Give a number for every change.']
      const changed = values.map((v, i) => v !== p.changes[i].newValue)
      if (!changed.some(Boolean)) return null
      const r = checkProposal(
        asProposed(p.changes).map((c, i) => ({ ...c, new_value: values[i] })),
        guardContext(),
      )
      if (!r.ok) return r.problems
      const what = p.changes.flatMap((c, i) => (changed[i] ? [`${c.label}: ${c.shownTo} → ${r.changes[i].shownTo}`] : []))
      setProposal(id, { changes: r.changes, testable: r.changes.every((x) => x.live), note: `You changed ${what.join('; ')}.` })
      log({ ...p, changes: r.changes }, 'edited', what.join('; '))
      return null
    },

    startTest: async (id) => {
      const p = get().proposals[id]
      if (!p) return 'That proposal is gone.'
      if (!p.testable) return 'Only live limits can be tested; this one has to be applied permanently.'
      if (useSession.getState().status !== 'connected') return 'Connect to the controller first.'
      const motion = motionBlock([...new Map(p.changes.map((c) => [c.deviceKey, c.target])).values()], Date.now(), 'start a test')
      if (motion) return motion
      // Checked again: the controllers or the profile may have changed since.
      const r = checkProposal(asProposed(p.changes), guardContext())
      if (!r.ok) return `It no longer passes the safety checks: ${r.problems.join(' ')}`
      const field = Object.fromEntries(TEMP_KEYS.map((k) => [TEMP_FIELDS[k], k])) as Record<string, keyof TempLimits>
      const limits: LimitTest['limits'] = {}
      for (const c of r.changes) (limits[c.deviceKey] ??= {})[field[c.param]] = c.to
      const prev = useRideModes.getState().test
      const ok = await useRideModes.getState().startTest({ id, label: p.summary, startedAt: Date.now(), limits })
      if (!ok) return useRideModes.getState().error ?? 'The controller didn’t take the test limits.'
      if (prev && prev.id !== id && get().proposals[prev.id]) {
        setProposal(prev.id, { status: 'tested', note: 'Replaced by another test.' })
        log(get().proposals[prev.id], 'test-ended', 'replaced by another test')
      }
      setProposal(id, { status: 'testing', changes: r.changes, note: 'Running as a test. A power cycle or End test puts your settings back.' })
      log(p, 'test-started')
      return null
    },

    endTest: async () => {
      const t = useRideModes.getState().test
      if (!t) return null
      const ok = await useRideModes.getState().endTest()
      if (!ok) return useRideModes.getState().error ?? 'The controller didn’t take its stored limits back.'
      const p = get().proposals[t.id]
      if (p) {
        setProposal(t.id, { status: 'tested', note: 'Test ended: your stored settings are back.' })
        log(p, 'test-ended')
      } else {
        void useAiLog.getState().add({ proposalId: t.id, event: 'test-ended', summary: t.label, changes: [] })
      }
      return null
    },

    applyPlan: (id) => {
      const p = get().proposals[id]
      if (!p) return { error: 'That proposal is gone.' }
      if (p.status === 'applied' || p.status === 'rejected') return { error: 'This proposal is already done.' }
      const r = checkProposal(asProposed(p.changes), guardContext())
      if (!r.ok) return { error: `It no longer passes the safety checks: ${r.problems.join(' ')}` }
      return writesFor(r.changes, (c) => c.to)
    },

    revertPlan: (id) => {
      const p = get().proposals[id]
      if (!p || p.status !== 'applied') return { error: 'Only an applied proposal can be put back.' }
      return writesFor(p.changes, (c) => c.from)
    },

    writeStarted: (id, mode) => {
      // The test's limits are about to become (or stop being) the stored ones.
      if (mode === 'apply' && useRideModes.getState().test?.id === id) useRideModes.getState().dropTest()
    },

    writeFinished: (id, mode, items, outcomes) => {
      const p = get().proposals[id]
      if (!p) return
      const ok = outcomes.length === items.length && outcomes.every((o) => o.status === 'ok' || o.status === 'adjusted')
      const adjusted = outcomes.some((o) => o.status === 'adjusted')
      if (mode === 'apply') {
        if (ok) {
          setProposal(id, { status: 'applied', note: adjusted ? 'Saved, but the controller kept some values differently (see the write details).' : 'Saved to the controller and verified. A backup was made first.' })
          log(p, 'applied', adjusted ? 'some values adjusted by the controller' : undefined)
        } else {
          const why = outcomes.map((o) => (o.status === 'failed' ? o.error : o.status === 'stale' ? 'settings changed on the controller since they were read' : null)).filter(Boolean)
          setProposal(id, { status: p.status === 'testing' ? 'tested' : 'failed', note: `Not saved: ${why.join(' ') || 'the write didn’t finish.'}` })
          log(p, 'apply-failed', why.join(' '))
        }
      } else if (ok) {
        setProposal(id, { status: 'reverted', note: 'Your earlier values are back on the controller.' })
        log(p, 'reverted')
      } else {
        setProposal(id, { note: 'Putting the old values back didn’t finish. Your backups have them too.' })
        log(p, 'apply-failed', 'revert failed')
      }
    },
  }
})

function toolResult(u: ContentBlock, content: string, isError?: boolean): ContentBlock {
  return { type: 'tool_result', tool_use_id: u.id, content, ...(isError ? { is_error: true } : {}) }
}

const TOOL_ACTIVITY: Record<string, string> = {
  get_device_snapshot: 'Reading your controller…',
  search_params: 'Looking up settings…',
  get_params: 'Reading settings…',
  get_live_telemetry: 'Looking at live data…',
  get_ride_summary: 'Reading your ride log…',
  get_fault_history: 'Checking faults…',
  calculate: 'Working it out…',
  propose_config_changes: 'Preparing changes…',
  update_vehicle_profile: 'Saving to your vehicle profile…',
}

/** For the card: the change's value as the assistant gave it (display units). */
export const editValue = (c: ResolvedChange) => c.newValue

/** The stored value in the card's units (to prefill an edit). */
export function shownNumber(c: ResolvedChange): number {
  const d = useConfig.getState().devices[c.deviceKey]
  const p = d?.[c.kind].defs?.params[c.param]
  return p ? toDisplay(p, c.to) : c.newValue
}
