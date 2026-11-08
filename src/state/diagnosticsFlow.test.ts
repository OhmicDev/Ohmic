import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIGNAL_INDEX } from '../live/signals'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { useFaults } from './faults'
import { addLiveViewer, liveLogs, useLiveView } from './live'
import { connectWith, injectDemoFault, useSession } from './session'
import { useSettings } from './settings'
import { runCommand, useTerminal } from './terminal'

async function waitFor(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const connectDemo = () => connectWith(new MockTransport({ bus: new MockBus({ layout: 'dual' }), connectDelayMs: 5, latencyMs: [1, 2] }))
const faults = () => useFaults.getState()
const term = () => useTerminal.getState()

beforeEach(() => {
  useSettings.setState({ autoReconnect: false, pollHz: 20, deviceViews: {} })
  useFaults.setState({ events: [], active: {}, logs: {}, loaded: true })
  useTerminal.setState({ lines: [], history: [], learned: {} })
  useLiveView.setState({ plotted: [], device: null, pausedAt: null, zoom: null })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('live recording', () => {
  it('records every controller, and reads the IMU only while the Live screen is open', async () => {
    await connectDemo()
    await waitFor(() => (liveLogs.get('local')?.size ?? 0) > 3 && (liveLogs.get('can2')?.size ?? 0) > 3)
    const roll = SIGNAL_INDEX.get('roll')!
    expect(Number.isFinite(liveLogs.get('local')!.latestFinite(roll))).toBe(false)

    useLiveView.setState({ device: 'local' })
    const close = addLiveViewer()
    try {
      await waitFor(() => Number.isFinite(liveLogs.get('local')!.latest(roll)))
      // Only the controller being looked at.
      expect(Number.isFinite(liveLogs.get('can2')!.latestFinite(roll))).toBe(false)
    } finally {
      close()
    }
  })
})

describe('faults', () => {
  it('records a fault while it shows, with the conditions just before, then closes it', async () => {
    await connectDemo()
    await waitFor(() => (liveLogs.get('can2')?.size ?? 0) > 2)
    expect(injectDemoFault(2, 2, 0.4)).toBe(true)

    await waitFor(() => !!faults().active.can2)
    const e = faults().active.can2
    expect(e.code).toBe(2)
    expect(e.deviceName).toContain('CAN 2')
    expect(e.snapshotDuring).toBeUndefined()
    expect(e.snapshot.vIn).toBeGreaterThan(40)

    await waitFor(() => !faults().active.can2)
    const done = faults().events.find((x) => x.uid === e.uid)!
    expect(done.endedAt! - done.at).toBeGreaterThanOrEqual(250)
  })

  it('reads the controller fault log through the terminal', async () => {
    await connectDemo()
    injectDemoFault('local', 4, 0.2)
    await faults().readLog('local')
    const log = faults().logs.local
    expect(log.status).toBe('ok')
    expect(log.log?.entries.map((x) => x.code)).toEqual([4])
    // It shows in the transcript as sent by the Faults screen, not in typed history.
    expect(term().lines.find((l) => l.kind === 'cmd')).toMatchObject({ text: 'faults', source: 'Faults' })
    expect(term().history).toEqual([])
  })

  it('marks a fault as unfinished when the connection ends', async () => {
    await connectDemo()
    injectDemoFault('local', 6, 5)
    await waitFor(() => !!faults().active.local)
    await useSession.getState().disconnect()
    expect(faults().active).toEqual({})
    expect(faults().events[0].lostAt).toBeTypeOf('number')
    expect(faults().events[0].endedAt).toBeNull()
  })
})

describe('terminal', () => {
  it('sends commands to the chosen controller and keeps the history', async () => {
    await connectDemo()
    const out = await runCommand('hw_status', 2, { quietMs: 150 })
    expect(out).toContain('SIM_75_100')
    await term().send('uptime', 'local')
    await term().send('uptime', 'local')
    expect(term().history).toEqual(['hw_status', 'uptime'])
    await waitFor(() => term().lines.filter((l) => l.kind === 'out' && l.target === 'local').length > 0)
  })

  it('learns the command list from help', async () => {
    await connectDemo()
    await term().send('help', 'local')
    await waitFor(() => (term().learned.local?.length ?? 0) > 10)
    expect(term().learned.local.map((c) => c.name)).toContain('faults')
  })

  it('refuses to send without a connection', async () => {
    await expect(term().send('help', 'local')).rejects.toThrow('Not connected')
    expect(term().lines.at(-1)?.kind).toBe('error')
  })
})
