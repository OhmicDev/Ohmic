import { describe, expect, it } from 'vitest'
import { COMM } from '../protocol/commands'
import { MockTransport } from '../transport/MockTransport'
import { VescClient, TimeoutError } from './VescClient'

async function setup() {
  const transport = new MockTransport({ latencyMs: [0, 2], chunkSize: 7, connectDelayMs: 0 })
  await transport.connect()
  return { transport, client: new VescClient(transport) }
}

describe('VescClient against the simulated controller', () => {
  it('reads firmware version', async () => {
    const { client } = await setup()
    const fw = await client.getFwVersion()
    expect(fw.major).toBe(6)
    expect(fw.hwName).toBe('SIM_75_100')
    expect(fw.uuid).toHaveLength(24)
    client.close()
  })

  it('reads live values with a plausible pack voltage', async () => {
    const { client } = await setup()
    const v = await client.getValues()
    expect(v.vIn).toBeGreaterThan(13 * 3.5)
    expect(v.vIn).toBeLessThan(13 * 4.2)
    expect(v.controllerId).toBe(1)
    client.close()
  })

  it('finds the second controller on CAN and talks to it through forwarding', async () => {
    const { client } = await setup()
    expect(await client.pingCan()).toEqual([2])
    const v = await client.getValues({ target: 2 })
    expect(v.controllerId).toBe(2)
    client.close()
  })

  it('handles many back-to-back requests in order', async () => {
    const { client } = await setup()
    const results = await Promise.all([
      client.getValues({ priority: 'low' }),
      client.getFwVersion(),
      client.getValues({ target: 2 }),
      client.getValues(),
    ])
    expect(results[0]).toHaveProperty('vIn')
    expect(results[1]).toHaveProperty('hwName')
    expect((results[2] as { controllerId: number }).controllerId).toBe(2)
    client.close()
  })

  it('times out after retries when nothing answers', async () => {
    const { client } = await setup()
    // The simulator ignores unknown commands, like real firmware.
    await expect(client.request(COMM.GET_DECODED_CHUK, undefined, { timeoutMs: 20, retries: 1 })).rejects.toBeInstanceOf(
      TimeoutError,
    )
    // The queue keeps working afterwards.
    expect((await client.getFwVersion()).major).toBe(6)
    client.close()
  })

  it('rejects pending requests when closed', async () => {
    const { client } = await setup()
    const p = client.getValues()
    client.close()
    await expect(p).rejects.toThrow('Connection closed')
  })
})
