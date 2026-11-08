import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockBus, type MockLayout } from '../sim/mockBus'
import { BleTransport } from '../transport/BleTransport'
import { MockTransport } from '../transport/MockTransport'
import { SerialTransport } from '../transport/SerialTransport'
import { FakeBluetoothDevice, FakeSerial, FakeSerialPort } from '../test/fakeBrowserDevices'
import { connectWith, useSession } from './session'
import { useSettings } from './settings'
import { useTelemetry } from './telemetry'

async function waitFor(check: () => boolean, timeoutMs = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const fastMock = (layout: MockLayout = 'dual') =>
  new MockTransport({ bus: new MockBus({ layout }), connectDelayMs: 5, latencyMs: [1, 2] })

const session = () => useSession.getState()
const tele = () => useTelemetry.getState()

beforeEach(() => {
  useSettings.setState({ autoReconnect: true, pollHz: 20, deviceViews: {} })
})

afterEach(async () => {
  await session().disconnect()
})

describe('session', () => {
  it('connects, finds the CAN controller and shows both combined', async () => {
    await connectWith(fastMock())
    expect(session().status).toBe('connected')
    expect(session().devices.map((d) => d.target)).toEqual(['local', 2])
    expect(session().primary).toBe('local')
    await waitFor(() => tele().dash !== null)
    expect(tele().dash?.controllers).toBe(2)
    expect(Object.keys(tele().devices).sort()).toEqual(['can2', 'local'])
  })

  it('uses the motor controllers behind a VESC Express', async () => {
    await connectWith(fastMock('express'))
    const s = session()
    expect(s.fw?.hwName).toBe('VESC Express T')
    expect(s.devices.find((d) => d.target === 'local')?.motor).toBe(false)
    expect(s.primary).toBe(10)
    await waitFor(() => tele().dash !== null)
    expect(Object.keys(tele().devices).sort()).toEqual(['can10', 'can11'])
  })

  it('shows one controller when picked, remembers it, and keeps the trip whole', async () => {
    await connectWith(fastMock())
    await waitFor(() => tele().dash !== null)
    session().setView(2)
    await waitFor(() => tele().dash?.view === 2)
    expect(tele().dash?.controllers).toBe(1)
    // Trip energy still comes from both controllers.
    expect(Object.keys(tele().devices).sort()).toEqual(['can2', 'local'])
    expect(useSettings.getState().deviceViews[session().fw!.uuid]).toBe(2)

    // Reconnecting to the same scooter restores the choice.
    await session().disconnect()
    expect(session().view).toBe(2) // kept until the next connection decides
    useSession.setState({ view: 'all' })
    await connectWith(fastMock())
    expect(session().view).toBe(2)
  })

  it('reconnects by itself after a drop and carries on', async () => {
    const t = fastMock()
    await connectWith(t)
    await waitFor(() => tele().dash !== null)
    const uuid = session().fw?.uuid

    t.simulateDrop('Connection lost')
    expect(session().status).toBe('reconnecting')
    expect(session().reconnect?.reason).toBe('Connection lost')
    expect(tele().dash).not.toBeNull() // last values stay on screen

    await waitFor(() => session().status === 'connected')
    expect(session().fw?.uuid).toBe(uuid)
    const before = tele().lastUpdate
    await waitFor(() => tele().lastUpdate > before)
  })

  it('stops trying when the rider says so', async () => {
    const t = fastMock()
    await connectWith(t)
    // Make reconnect attempts fail so it stays in the reconnecting state.
    t.connect = () => Promise.reject(new Error('still gone'))
    t.simulateDrop()
    expect(session().status).toBe('reconnecting')
    await waitFor(() => (session().reconnect?.attempt ?? 0) >= 2)
    await session().disconnect()
    expect(session().status).toBe('idle')
    expect(session().reconnect).toBeNull()
  })

  it('turns a drop into an error when auto-reconnect is off', async () => {
    useSettings.setState({ autoReconnect: false })
    const t = fastMock()
    await connectWith(t)
    t.simulateDrop('Connection lost')
    await waitFor(() => session().status === 'error')
    expect(session().error).toMatch(/Connection lost/)
  })

  it('recovers from an unplugged USB cable once it is plugged back in', async () => {
    const serial = new FakeSerial()
    const port = new FakeSerialPort(new MockBus())
    serial.pick = port
    await connectWith(await SerialTransport.request({ serial: serial.api }))
    expect(session().transportKind).toBe('serial')
    await waitFor(() => tele().dash !== null)

    port.unplug()
    await waitFor(() => session().status === 'reconnecting')
    await new Promise((r) => setTimeout(r, 150))
    expect(session().status).toBe('reconnecting')

    serial.replug(port)
    await waitFor(() => session().status === 'connected', 4000)
    const before = tele().lastUpdate
    await waitFor(() => tele().lastUpdate > before)
  })

  it('recovers a Bluetooth link that came back in range', async () => {
    const device = new FakeBluetoothDevice()
    await connectWith(new BleTransport(device as unknown as BluetoothDevice))
    await waitFor(() => tele().dash !== null)

    device.goAway()
    expect(session().status).toBe('reconnecting')
    device.comeBack()
    await waitFor(() => session().status === 'connected', 4000)
    expect(session().primary).toBe(10)
  })

  it('reports a controller that never answers', async () => {
    const t = new MockTransport({ connectDelayMs: 1 })
    t.write = async () => {} // swallow everything
    await connectWith(t)
    expect(session().status).toBe('error')
    expect(session().error).toMatch(/didn't answer/)
  }, 10_000)
})
