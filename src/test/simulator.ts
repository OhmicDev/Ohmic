// Connecting the store tests to the simulated scooter (two controllers: local + CAN 2).
// Kept apart from waitFor.ts because importing the config store makes every
// connection read settings, which tests of the bare session don't want.

import { sleep } from '../lib/time'
import { MockBus } from '../sim/mockBus'
import { useConfig } from '../state/config'
import { connectWith, useSession } from '../state/session'
import { useTelemetry } from '../state/telemetry'
import { MockTransport } from '../transport/MockTransport'
import { waitForWithin } from './waitFor'

export const LOCAL = 'uuid:5e1a00000000000000000001'
export const CAN2 = 'uuid:5e1a00000000000000000002'

const devices = () => useConfig.getState().devices

/** ERPM of motor 0 (local) or 1 (CAN 2), either direction. */
export const rpm = (bus: MockBus, motor: number) => Math.abs(bus.sim.valuesFor(motor, motor + 1).rpm)

/**
 * Waits for the local controller's settings and a working link. When parked, also
 * waits for the wheels to stop.
 */
export async function connectLocal({ bus = new MockBus(), parked = true } = {}) {
  const waitFor = waitForWithin(6000)
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => devices()[LOCAL]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  if (parked) await waitFor(() => bus.sim.speed === 0)
  // Let a fresh poll confirm the wheels are still.
  await sleep(150)
  return bus
}

/** Waits for both controllers' settings, a working link and telemetry from both. */
export async function connectBoth({ parked = true } = {}) {
  const waitFor = waitForWithin(5000)
  const bus = new MockBus()
  bus.sim.parked = parked
  bus.sim.rideTime = 4.5
  await connectWith(new MockTransport({ bus, connectDelayMs: 5, latencyMs: [1, 2] }))
  await waitFor(() => devices()[LOCAL]?.appconf.status === 'ready' && devices()[CAN2]?.appconf.status === 'ready')
  await waitFor(() => useSession.getState().link === 'ok')
  await waitFor(() => !!useTelemetry.getState().devices.local && !!useTelemetry.getState().devices.can2)
  return bus
}
