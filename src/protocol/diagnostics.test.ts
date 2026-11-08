import { describe, expect, it } from 'vitest'
import { VescClient } from '../client/VescClient'
import { MockBus } from '../sim/mockBus'
import { MockTransport } from '../transport/MockTransport'
import { BufferReader } from './buffer'
import { COMM } from './commands'
import { FAULTS, faultByName, faultFirmwareName, faultInfo } from './faults'
import { decodeImu, emptyImu, encodeImu, encodeImuRequest, IMU_FIELDS, IMU_MASK_MOTION } from './imu'
import { decodePrint, encodeTerminalCmd, parseFaultLog, parseHelp, TERMINAL_COMMANDS, terminalCommand } from './terminal'

describe('faults', () => {
  it('has one entry per firmware code, in order, with help', () => {
    FAULTS.forEach((f, i) => expect(f.code).toBe(i))
    expect(FAULTS).toHaveLength(34)
    for (const f of FAULTS.slice(1)) {
      expect(f.causes.length, f.id).toBeGreaterThan(0)
      expect(f.fixes.length, f.id).toBeGreaterThan(0)
    }
  })

  it('looks codes up by their firmware name', () => {
    expect(faultByName('FAULT_CODE_OVER_TEMP_FET')?.code).toBe(5)
    expect(faultByName('under_voltage')?.code).toBe(2)
    expect(faultByName('FAULT_CODE_SOMETHING_NEW')).toBeNull()
    expect(faultFirmwareName(29)).toBe('FAULT_CODE_LV_OUTPUT_FAULT')
    expect(faultInfo(99).title).toMatch(/unknown fault 99/i)
  })
})

describe('IMU data', () => {
  it('round-trips the fields named in the mask, then the controller ID', () => {
    const d = emptyImu()
    IMU_FIELDS.forEach((f, i) => (d[f] = (i + 1) * 0.37 - 2))
    const bytes = encodeImu(d, IMU_MASK_MOTION, 7)
    expect(bytes[0]).toBe(COMM.GET_IMU_DATA)
    expect(bytes.length).toBe(1 + 2 + 9 * 4 + 1)
    const back = decodeImu(new BufferReader(bytes, 1))
    expect(back.mask).toBe(IMU_MASK_MOTION)
    expect(back.controllerId).toBe(7)
    expect(back.data.roll).toBeCloseTo(d.roll, 5)
    expect(back.data.gyroZ).toBeCloseTo(d.gyroZ, 5)
    expect(back.data.magX).toBe(0) // not requested
    expect([...encodeImuRequest(0x01ff)]).toEqual([0x01, 0xff])
  })
})

describe('terminal text', () => {
  it('encodes commands and decodes prints without trailing NULs', () => {
    expect(new TextDecoder().decode(encodeTerminalCmd('hw_status'))).toBe('hw_status')
    expect(decodePrint(new TextEncoder().encode('Uptime: 3.00 s\n\0'))).toBe('Uptime: 3.00 s\n')
  })

  it('knows which commands drive the motor', () => {
    expect(terminalCommand('foc_openloop 5 1000')?.risk).toBe('spins')
    expect(terminalCommand('foc_detect_apply_all 400')?.risk).toBe('spins-saves')
    expect(terminalCommand('faults')?.risk).toBeUndefined()
    expect(terminalCommand('rebootwdt')?.risk).toBe('reboots')
    expect(new Set(TERMINAL_COMMANDS.map((c) => c.name)).size).toBe(TERMINAL_COMMANDS.length)
  })

  it('reads the command list out of help output', () => {
    const text = [
      'Valid commands are:',
      'help',
      '  Show this help',
      'foc_openloop [current] [erpm]',
      '  Create an open loop rotating current vector.',
      'my_pkg_cmd',
      '  There is no help available for this command.',
      ' ',
    ].join('\n')
    expect(parseHelp(text)).toEqual([
      { name: 'help', args: undefined, help: 'Show this help' },
      { name: 'foc_openloop', args: '[current] [erpm]', help: 'Create an open loop rotating current vector.' },
      { name: 'my_pkg_cmd', args: undefined, help: '' },
    ])
  })

  it('parses the fault log the firmware prints', () => {
    const text = [
      'Active fault: FAULT_CODE_NONE\n',
      'The following faults were registered since start:\n',
      'Fault            : FAULT_CODE_ABS_OVER_CURRENT',
      'Motor            : 1',
      'Current          : 182.4',
      'Current filtered : 150.2',
      'Voltage          : 49.87',
      'Duty             : 0.412',
      'RPM              : 12011.3',
      'Tacho            : 52221',
      'Cycles running   : 1802',
      'TIM duty         : 3460',
      'Temperature      : 41.20',
      'Info             : Current 182.4',
      ' ',
      'Fault            : FAULT_CODE_DRV',
      'Motor            : 2',
      'Voltage          : 50.10',
      'DRV8301_FAULTS   : FETHA_OC',
      ' ',
    ].join('\n')
    const log = parseFaultLog(text)
    expect(log?.active).toBeNull()
    expect(log?.entries).toHaveLength(2)
    expect(log?.entries[0]).toMatchObject({ code: 4, motor: 1, current: 182.4, currentFiltered: 150.2, voltage: 49.87, duty: 0.412, rpm: 12011.3, tacho: 52221, temperature: 41.2, info: 'Current 182.4' })
    expect(log?.entries[1]).toMatchObject({ code: 3, motor: 2, voltage: 50.1, info: 'FETHA_OC' })
    expect(parseFaultLog('No faults registered since startup\n')).toEqual({ active: null, entries: [] })
    expect(parseFaultLog('Active fault: FAULT_CODE_OVER_TEMP_FET\nThe following...\nFault : FAULT_CODE_OVER_TEMP_FET')?.active).toBe(5)
    expect(parseFaultLog('Invalid command: faults')).toBeNull()
  })
})

describe('demo controller diagnostics', () => {
  async function setup() {
    const bus = new MockBus()
    const transport = new MockTransport({ bus, latencyMs: [0, 3], chunkSize: 20, connectDelayMs: 0 })
    await transport.connect()
    const client = new VescClient(transport)
    const printed: string[] = []
    client.onPrint((t) => printed.push(t))
    const settle = () => new Promise((r) => setTimeout(r, 60))
    return { bus, client, printed, settle }
  }

  it('answers terminal commands in order, locally and over CAN', async () => {
    const { client, printed, settle } = await setup()
    await client.terminal('help')
    await settle()
    expect(printed[0]).toBe('Valid commands are:')
    expect(printed.slice(1, 3)).toEqual(['help', '  Show this help'])
    expect(parseHelp(printed.join('\n')).map((c) => c.name)).toContain('faults')

    printed.length = 0
    await client.terminal('nope', 2)
    await client.terminal('')
    await settle()
    expect(printed).toEqual(['Invalid command: nope\ntype help to list all available commands\n', 'No command received\n'])

    printed.length = 0
    await client.terminal('hw_status', 2)
    await settle()
    expect(printed).toContain('Hardware: SIM_75_100')
    expect(printed).toContain('UUID: 5E 1A 00 00 00 00 00 00 00 00 00 02')
    client.close()
  })

  it('reports injected faults in live values and in the fault log', async () => {
    const { bus, client, printed, settle } = await setup()
    await client.terminal('faults')
    await settle()
    expect(printed).toEqual(['No faults registered since startup\n'])

    bus.remotes.get(2)!.injectFault(5, 1)
    expect((await client.getValues({ target: 2 })).fault).toBe(5)
    expect((await client.getValues()).fault).toBe(0)

    printed.length = 0
    await client.terminal('faults', 2)
    await settle()
    const log = parseFaultLog(printed.join('\n'))
    expect(log?.active).toBe(5)
    expect(log?.entries.map((e) => e.code)).toEqual([5])
    expect(log?.entries[0].voltage).toBeGreaterThan(40)

    // The same fault again while it's still active isn't logged twice.
    bus.remotes.get(2)!.injectFault(5, 1)
    expect(bus.remotes.get(2)!.faultLog).toHaveLength(1)
    client.close()
  })

  it('switches the motor output off while a fault is active, then recovers', () => {
    const bus = new MockBus({ now: () => 0 })
    bus.sim.rideTime = 6 // full throttle part of the ride
    for (let i = 0; i < 100; i++) bus.sim.step(0.01)
    expect(bus.sim.valuesFor(0, 1).currentMotor).toBeGreaterThan(20)
    bus.sim.injectFault(0, 2, 0.5)
    bus.sim.step(0.01)
    const during = bus.sim.valuesFor(0, 1)
    expect(during.fault).toBe(2)
    expect(during.currentMotor).toBe(0)
    expect(bus.sim.valuesFor(1, 2).currentMotor).toBeGreaterThan(20) // the other motor keeps going
    for (let i = 0; i < 60; i++) bus.sim.step(0.01)
    expect(bus.sim.valuesFor(0, 1).fault).toBe(0)
  })

  it('answers IMU requests with plausible orientation', async () => {
    const { bus, client } = await setup()
    bus.sim.rideTime = 22 // climbing part of the ride
    for (let i = 0; i < 400; i++) bus.sim.step(0.01)
    const imu = await client.getImu({ target: 2 })
    expect(imu.pitch).toBeGreaterThan(0.02) // nose up on the 6 % grade
    expect(imu.accZ).toBeGreaterThan(0.9)
    expect(imu.magX).toBe(0) // not in the default mask
    client.close()
  })
})
