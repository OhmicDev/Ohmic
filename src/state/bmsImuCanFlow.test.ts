// Reading the BMS, calibrating the IMU and monitoring CAN, against the
// simulated scooter.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasBms } from '../protocol/bms'
import { CAN_MODE, describeVescFrame, type CanFrame } from '../protocol/can'
import { connectLocal } from '../test/simulator'
import { waitForWithin } from '../test/waitFor'
import { activeClient, useSession } from './session'
import { useSettings } from './settings'

const waitFor = waitForWithin(6000)

beforeEach(() => {
  useSettings.setState({ autoReconnect: false, pollHz: 20, deviceViews: {} })
})

afterEach(async () => {
  await useSession.getState().disconnect()
})

describe('BMS, IMU and CAN', () => {
  it('reads the BMS through the controller', async () => {
    await connectLocal()
    const v = await activeClient()!.bmsValues()
    expect(v.cells).toHaveLength(13)
    expect(v.soc).toBeGreaterThan(0)
    expect(hasBms(v)).toBe(true)
    // Parked, so the high cells balance.
    expect(v.balancing.some(Boolean)).toBe(true)
  })

  it('calibrates the IMU', async () => {
    await connectLocal()
    const cal = await activeClient()!.imuCalibration(90)
    expect(cal).toHaveLength(9)
    expect(cal[2]).toBeCloseTo(90)
  })

  it('monitors CAN in comm-bridge mode and sends frames', async () => {
    const bus = await connectLocal()
    const client = activeClient()!
    const frames: CanFrame[] = []
    const off = client.onCanFrame((f) => frames.push(f))
    await client.setCanMode(CAN_MODE.COMM_BRIDGE)
    expect(bus.canMode).toBe(CAN_MODE.COMM_BRIDGE)
    await waitFor(() => frames.some((f) => describeVescFrame(f)?.name === 'STATUS'))
    expect(frames.every((f) => (f.id & 0xff) === 2)).toBe(true)
    await client.sendCanFrame({ id: (17 << 8) | 2, extended: true, data: Uint8Array.of(254) })
    await waitFor(() => frames.some((f) => describeVescFrame(f)?.name === 'PONG'))
    await client.setCanMode(CAN_MODE.VESC)
    // Frames already on their way still arrive; after that, nothing.
    await new Promise((r) => setTimeout(r, 100))
    const n = frames.length
    await new Promise((r) => setTimeout(r, 300))
    expect(frames.length).toBe(n)
    off()
  })
})
