import { describe, expect, it } from 'vitest'
import { decodeConfig, encodeConfig } from '../config/codec'
import defs606 from '../config/defs/6.06/mcconf.json'
import appDefs606 from '../config/defs/6.06/appconf.json'
import defs700 from '../config/defs/7.00/mcconf.json'
import type { ConfigDefs } from '../config/types'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { ConfigRejectedError, VescClient } from './VescClient'

const MC = defs606 as ConfigDefs
const APP = appDefs606 as ConfigDefs

async function setup() {
  const bus = new MockBus()
  const transport = new MockTransport({ bus, latencyMs: [0, 2], chunkSize: 20, connectDelayMs: 0 })
  await transport.connect()
  return { bus, client: new VescClient(transport) }
}

describe('config commands', () => {
  it('reads motor and app settings from the local and CAN controllers', async () => {
    const { client } = await setup()
    const local = decodeConfig(MC, await client.getConfig('mcconf'))
    expect(local.l_current_max).toBe(55)
    expect(local.si_battery_cells).toBe(13)
    const app = decodeConfig(APP, await client.getConfig('appconf', { target: 2 }))
    expect(app.controller_id).toBe(2)
    client.close()
  })

  it('writes settings, which the simulated scooter then obeys', async () => {
    const { bus, client } = await setup()
    const values = decodeConfig(MC, await client.getConfig('mcconf'))
    await client.setConfig('mcconf', encodeConfig(MC, { ...values, l_current_max: 70, l_in_current_max: 35 }))
    const back = decodeConfig(MC, await client.getConfig('mcconf'))
    expect(back.l_current_max).toBe(70)
    expect(bus.sim.limitsFor(0)).toMatchObject({ motorCurrentMax: 70, batteryCurrentMax: 35 })
    expect(bus.local.config?.writes).toBe(1)
    client.close()
  })

  it('applies hardware limits and keeps calibrated offsets, like the firmware', async () => {
    const { client } = await setup()
    const values = decodeConfig(MC, await client.getConfig('mcconf'))
    await client.setConfig(
      'mcconf',
      encodeConfig(MC, { ...values, l_current_max: 140, foc_offsets_current__0: 1000, l_current_max_scale: 1 }),
    )
    const back = decodeConfig(MC, await client.getConfig('mcconf'))
    expect(back.l_current_max).toBe(100)
    expect(back.foc_offsets_current__0).toBeCloseTo(2048.3, 3)
    client.close()
  })

  it('reports a write the controller refuses because of a different layout', async () => {
    const { bus, client } = await setup()
    const other = defs700 as ConfigDefs
    const blob = encodeConfig(other, Object.fromEntries(other.order.map((n) => [n, other.params[n].def])))
    await expect(client.setConfig('mcconf', blob)).rejects.toBeInstanceOf(ConfigRejectedError)
    expect(bus.local.config?.writes).toBe(0)
    client.close()
  })

  it('reads hardware defaults separately from the stored settings', async () => {
    const { client } = await setup()
    const defaults = decodeConfig(MC, await client.getConfig('mcconf', { defaults: true }))
    expect(defaults.l_current_max).toBe(60)
    expect(defaults.foc_offsets_current__0).toBeCloseTo(2048.3, 3)
    client.close()
  })
})
