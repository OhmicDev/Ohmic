// A scripted stand-in for the model, for the demo scooter and tests when no AI
// server is set up. It is not an AI: it recognises a few goals, calls the same
// tools the real assistant would, and proposes simple changes worked out from the
// tool results, so the whole flow (guardrails, change cards, test mode) can be tried.

import { erpmAt } from '../lib/calculators'
import type { AiBackend, AiReply, ContentBlock, MessageParam } from './backend'

type Goal = 'power' | 'range' | 'smooth' | 'hill' | 'cool' | 'cutout' | 'beginner' | 'fault' | 'test' | 'other'

const GOALS: [Goal, RegExp][] = [
  ['test', /how did (that|it) go|test ride|after the test/i],
  ['range', /range|further|farther|efficien|last longer/i],
  ['beginner', /beginner|learn|new rider|kid|gentle/i],
  ['smooth', /smooth|jerk|throttle|twitchy/i],
  ['hill', /hill|climb|uphill|incline/i],
  ['cool', /cool|hot|heat|temperat|overheat/i],
  ['cutout', /cut.?out|cuts out|stutter|power loss|shuts? off/i],
  ['fault', /fault|error code|explain/i],
  ['power', /power|faster|accelerat|punch|torque|speed/i],
]

const goalOf = (text: string): Goal => GOALS.find(([, re]) => re.test(text))?.[0] ?? 'other'
const num = (s: unknown) => (typeof s === 'string' ? parseFloat(s) : typeof s === 'number' ? s : NaN)
const r1 = (n: number) => Math.round(n * 10) / 10

let seq = 0
const toolUse = (goal: Goal, name: string, input: Record<string, unknown>): ContentBlock => ({ type: 'tool_use', id: `demo_${goal}_${name}_${++seq}`, name, input })
const text = (t: string): ContentBlock => ({ type: 'text', text: t })

function lastUserText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const t = m.content.find((b) => b.type === 'text')
    if (t) return String(t.text)
  }
  return ''
}

/** The tool result answering the latest tool call, parsed. */
function lastResult(messages: MessageParam[]): { goal: Goal; tool: string; data: Record<string, unknown> | null; error: boolean; raw: string } | null {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') return null
  const res = last.content.find((b) => b.type === 'tool_result')
  if (!res) return null
  const id = String(res.tool_use_id)
  const m = /^demo_([a-z]+)_([a-z_]+)_\d+$/.exec(id)
  if (!m) return null
  const raw = String(res.content ?? '')
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(raw)
  } catch {
    data = null
  }
  return { goal: m[1] as Goal, tool: m[2], data, error: res.is_error === true, raw }
}

type Snapshot = {
  connected?: boolean
  pack_limit_a?: string
  controllers?: { id: string; motor_settings: Record<string, string>; app_settings: Record<string, string> }[]
}

function proposal(goal: Goal, snap: Snapshot): ContentBlock[] {
  const c = snap.controllers?.[0]
  if (!snap.connected || !c) return [text('Connect to your controller first (Connect tab), then ask again and I’ll look at its setup.')]
  const m = c.motor_settings
  const inMax = num(m.l_in_current_max)
  const motorMax = num(m.l_current_max)
  const maxErpm = num(m.l_max_erpm)
  const poles = num(m.si_motor_poles)
  const wheel = num(m.si_wheel_diameter)
  const gear = num(m.si_gear_ratio) || 1
  const erpmFor = (kmh: number) => Math.round(erpmAt(kmh, poles, wheel, gear) / 100) * 100
  const propose = (summary: string, risk: string, changes: Record<string, unknown>[], intro: string) => [
    text(intro),
    toolUse(goal, 'propose_config_changes', { summary, risk_level: risk, changes }),
  ]

  switch (goal) {
    case 'range': {
      const changes = [
        { param: 'l_in_current_max', target: 'all', new_value: r1(inMax * 0.75), reason: 'Caps how hard the battery is pulled, the biggest range cost.', tradeoff: 'About −25 % peak power; range up roughly 10–15 % in mixed riding.' },
      ]
      if (Number.isFinite(maxErpm) && poles > 0 && wheel > 0) {
        const e = Math.min(maxErpm, erpmFor(25))
        if (e < maxErpm) changes.push({ param: 'l_max_erpm', target: 'all', new_value: e, reason: 'Limits top speed to about 25 km/h; air drag rises fast above that.', tradeoff: 'Lower top speed; noticeably less energy per km at speed.' })
      }
      return propose('Softer battery draw and a lower top speed for more range.', 'low', changes, 'Two live limits give most of the range gain, so you can try them as a test first:')
    }
    case 'beginner': {
      const changes: Record<string, unknown>[] = [
        { param: 'l_current_max_scale', target: 'all', new_value: 60, reason: 'Takes the motor to 60 % of its current, for gentle starts.', tradeoff: 'Slower acceleration and weaker on hills.' },
      ]
      if (Number.isFinite(maxErpm) && poles > 0 && wheel > 0) changes.push({ param: 'l_max_erpm', target: 'all', new_value: Math.min(maxErpm, erpmFor(20)), reason: 'Top speed of about 20 km/h while learning.', tradeoff: 'Lower top speed.' })
      return propose('A gentle setup for learning: soft starts and about 20 km/h.', 'low', changes, 'These are live limits, so you can try them as a test mode and a power cycle undoes them:')
    }
    case 'power': {
      if (String(snap.pack_limit_a ?? '').startsWith('unknown')) {
        return [
          text(
            'More power means more battery current, and I can only raise that once I know what your pack can deliver. How many cells are in parallel, and what are they (or their continuous rating in amps)? If you know your BMS’s discharge limit, that helps too.',
          ),
        ]
      }
      const limit = num(snap.pack_limit_a)
      const n = snap.controllers?.length ?? 1
      const target = Math.min(r1(limit / n), r1(inMax * 1.25))
      if (!(target > inMax)) return [text(`Your battery current (${m.l_in_current_max}) is already at what the pack can deliver, so I won’t raise it. More torque would have to come from motor current, which costs heat.`)]
      return propose('More peak power from the battery, within what the pack delivers.', 'medium', [
        { param: 'l_in_current_max', target: 'all', new_value: target, reason: `Lets each controller pull up to ${target} A, inside your pack’s ${r1(limit)} A.`, tradeoff: 'Harder acceleration; more heat in battery and controller; a bit less range.' },
      ], 'Battery current is a live limit, so try it as a test ride first:')
    }
    case 'hill':
      return propose('More motor current for climbing.', 'medium', [
        { param: 'l_current_max', target: 'all', new_value: r1(motorMax * 1.15), reason: 'More torque at low speed, where hills need it.', tradeoff: 'About +15 % pulling power; motor runs warmer on long climbs.' },
      ], 'Hill climbing is about motor current. That isn’t a live limit, so this one is applied permanently (with a backup first):')
    case 'cool':
      return propose('Less motor current to keep the motor cooler.', 'low', [
        { param: 'l_current_max', target: 'all', new_value: r1(motorMax * 0.85), reason: 'Heat grows with the square of current, so a small cut helps a lot.', tradeoff: 'About −15 % torque; motor about 25 % less heat at full load.' },
      ], 'Motor heat mostly comes from motor current:')
    case 'smooth': {
      const a = c.app_settings
      const up = num(a['app_adc_conf.ramp_time_pos'])
      if (!Number.isFinite(up)) return [text('Your controller doesn’t report throttle ramp settings, so I can’t suggest a throttle change here.')]
      return propose('Slower throttle ramp for a smoother pull-away.', 'low', [
        { param: 'app_adc_conf.ramp_time_pos', target: 'all', new_value: r1(Math.max(0.3, up + 0.2)), reason: 'The throttle takes a little longer to reach full power.', tradeoff: 'Softer, less twitchy starts; a touch less instant response.' },
      ], 'Throttle feel is an app setting, so it’s saved when applied (with a backup first):')
    }
    default:
      return [text('I’ve read your setup. Pick one of the goals above, or tell me what you’d like to change, and I’ll suggest specific settings.')]
  }
}

/** Pack details in the rider's words ("14P, 10 A cells, BMS 40 A"). */
function packFields(t: string): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = []
  const par = /(\d+)\s*(?:p\b|cells?\s+in\s+parallel|in\s+parallel|parallel)/i.exec(t)
  if (par) out.push({ field: 'cells_parallel', value: par[1] })
  const bms = /bms[^\d]{0,20}(\d+(?:\.\d+)?)\s*a/i.exec(t)
  if (bms) out.push({ field: 'bms_limit_a', value: bms[1] })
  const cell = /(\d+(?:\.\d+)?)\s*a(?:mps?)?\b(?![^.]*bms)/i.exec(t.replace(/bms[^\d]{0,20}\d+(?:\.\d+)?\s*a/gi, ''))
  if (cell && par) out.push({ field: 'cell_continuous_a', value: cell[1] })
  return out
}

function reply(messages: MessageParam[]): ContentBlock[] {
  const res = lastResult(messages)
  if (!res) {
    const said = lastUserText(messages)
    const fields = packFields(said)
    if (fields.length) return [text('Thanks, I’ll save that to your vehicle profile.'), toolUse('power', 'update_vehicle_profile', { fields })]
    const goal = goalOf(said)
    if (goal === 'test') return [text('Let me look at the ride you just did.'), toolUse(goal, 'get_ride_summary', { ride: 'latest' })]
    if (goal === 'fault' || goal === 'cutout') return [text('Let me check the fault history first.'), toolUse(goal, 'get_fault_history', { limit: 10 })]
    return [text('Let me read your controller’s setup first.'), toolUse(goal, 'get_device_snapshot', {})]
  }
  const { goal, tool, data, error, raw } = res
  if (tool === 'get_device_snapshot') return proposal(goal, (data ?? {}) as Snapshot)
  if (tool === 'update_vehicle_profile') {
    if (error) return [text(raw)]
    return [text('Now let me look at your setup again.'), toolUse(goal, 'get_device_snapshot', {})]
  }
  if (tool === 'propose_config_changes') {
    if (error) return [text(`Ohmic’s safety checks turned that down:\n${raw.split('\n').slice(1).join('\n')}\nI won’t work around them.`)]
    const testable = (data as { can_run_as_test?: boolean })?.can_run_as_test
    return [
      text(
        testable
          ? 'Try it with “Apply as test mode”, take a short ride (record it from the Ride screen), then tap “How did that go?” and I’ll read the log.'
          : 'Review the card and apply it if it suits you. Ohmic backs up your settings first, and the card can put the old values back.',
      ),
    ]
  }
  if (tool === 'get_ride_summary') {
    if (!data || error) return [text(raw)]
    const d = data as Record<string, unknown>
    if (!('peak_battery_current_a' in d)) return [text(String(raw))]
    return [
      text(
        `${d.limit_test_during_ride ? `That ride ran with the test (“${d.limit_test_during_ride}”). ` : ''}Peak battery current was ${d.peak_battery_current_a} A and motor current ${d.peak_motor_current_a} A. The pack sagged ${d.voltage_sag_v ?? '?'} V, the motor reached ${d.max_temp_motor_c ?? '?'} °C and the controller ${d.max_temp_controller_c ?? '?'} °C, with ${d.duty_headroom_pct ?? '?'} % duty headroom and ${d.faults} fault${d.faults === 1 ? '' : 's'}.${d.wh_per_km !== null && d.wh_per_km !== undefined ? ` You used ${d.wh_per_km} Wh/km.` : ''}\n\nIf it felt right, make it permanent from the card. If not, end the test and tell me what to change.`,
      ),
    ]
  }
  if (tool === 'get_fault_history') {
    if (!data) return [text(raw)]
    const events = (data as { events?: { fault: string; meaning: string; conditions_before: Record<string, number> }[] }).events ?? []
    if (!events.length) return [text('No faults are recorded. If it cut out without a fault, the battery’s BMS may be cutting power: that points at battery current above what the BMS allows.')]
    const e = events[0]
    return [text(`The latest fault is ${e.fault}: ${e.meaning} Just before it: ${e.conditions_before.volts} V, ${e.conditions_before.battery_a} A from the battery, ${e.conditions_before.motor_a} A motor current. Tell me how it happened (accelerating, braking, uphill) and I’ll suggest a fix.`)]
  }
  return [text('Done.')]
}

export function demoBackend(opts: { delayMs?: number } = {}): AiBackend {
  const delay = opts.delayMs ?? 18
  return {
    kind: 'demo',
    send: async (messages, h, signal): Promise<AiReply> => {
      const content = reply(messages)
      for (const b of content) {
        if (b.type !== 'text') {
          h.onTool?.(String(b.name))
          continue
        }
        // Stream the words, like the real thing.
        for (const w of String(b.text).split(/(?<=\s)/)) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          h.onText(w)
          if (delay) await new Promise((r) => setTimeout(r, delay))
        }
      }
      return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', model: 'demo-script' }
    },
  }
}
