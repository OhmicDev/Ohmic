import { describe, expect, it } from 'vitest'
import { VescClient } from '../client/VescClient'
import { MockBus } from '../sim/mockBus'
import { FakeBluetooth, FakeBluetoothDevice, FakeSerial, FakeSerialPort } from '../test/fakeBrowserDevices'
import { BleTransport, NUS_SERVICE } from './BleTransport'
import { MockTransport } from './MockTransport'
import { SerialTransport, VESC_USB_IDS, portName } from './SerialTransport'

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

function serialSetup() {
  const serial = new FakeSerial()
  const port = new FakeSerialPort(new MockBus())
  serial.pick = port
  return { serial, port }
}

describe('SerialTransport (USB)', () => {
  it('asks the picker for VESC USB IDs, or every port when asked', async () => {
    const { serial } = serialSetup()
    await SerialTransport.request({ serial: serial.api })
    expect(serial.lastRequest?.filters).toEqual(VESC_USB_IDS.map(({ usbVendorId, usbProductId }) => ({ usbVendorId, usbProductId })))
    await SerialTransport.request({ serial: serial.api, anyDevice: true })
    expect(serial.lastRequest?.filters).toBeUndefined()
  })

  it('passes on a cancelled picker as NotFoundError', async () => {
    const serial = new FakeSerial()
    await expect(SerialTransport.request({ serial: serial.api })).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('names known VESC ports', () => {
    expect(portName(new FakeSerialPort() as unknown as SerialPort)).toBe('VESC (USB)')
    expect(portName(new FakeSerialPort(undefined, { usbVendorId: 0x10c4, usbProductId: 0xea60 }) as unknown as SerialPort)).toBe(
      'USB serial 10c4:ea60',
    )
  })

  it('talks to a controller at 115200 baud', async () => {
    const { serial, port } = serialSetup()
    const t = await SerialTransport.request({ serial: serial.api })
    await t.connect()
    expect(port.baudRate).toBe(115200)
    const client = new VescClient(t)
    expect((await client.getFwVersion()).hwName).toBe('SIM_75_100')
    expect((await client.getValues()).vIn).toBeGreaterThan(40)
    expect((await client.getValues({ target: 2 })).controllerId).toBe(2)
    client.close()
    await t.disconnect()
    expect(port.isOpen).toBe(false)
  })

  it('reports an unplugged cable once, and stays quiet on a normal disconnect', async () => {
    const { serial, port } = serialSetup()
    const t = await SerialTransport.request({ serial: serial.api })
    const drops: string[] = []
    t.onDisconnect((r) => drops.push(r))

    await t.connect()
    await t.disconnect()
    await tick()
    expect(drops).toEqual([])

    await t.connect()
    port.unplug()
    await tick()
    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatch(/unplugged/i)
  })

  it('reconnects to the re-plugged device, which is a new port object', async () => {
    const { serial, port } = serialSetup()
    const t = await SerialTransport.request({ serial: serial.api })
    await t.connect()
    port.unplug()
    await tick()

    await expect(t.connect()).rejects.toMatchObject({ name: 'ConnectError' })

    const replugged = serial.replug(port)
    await t.connect()
    expect(replugged.isOpen).toBe(true)
    const client = new VescClient(t)
    expect((await client.getFwVersion()).hwName).toBe('SIM_75_100')
    client.close()
    await t.disconnect()
  })

  it('lists granted ports, VESC first', async () => {
    const serial = new FakeSerial()
    const other = new FakeSerialPort(undefined, { usbVendorId: 0x10c4, usbProductId: 0xea60 })
    const vesc = new FakeSerialPort()
    serial.ports = [other, vesc]
    const ports = await SerialTransport.granted(serial.api)
    expect(ports[0]).toBe(vesc)
  })
})

describe('BleTransport (Bluetooth)', () => {
  it('asks the picker for the VESC UART service, or every device when asked', async () => {
    const bt = new FakeBluetooth()
    await BleTransport.request({ bluetooth: bt.api })
    expect(bt.lastOptions).toMatchObject({ filters: [{ services: [NUS_SERVICE] }, { namePrefix: 'VESC' }], optionalServices: [NUS_SERVICE] })
    await BleTransport.request({ bluetooth: bt.api, anyDevice: true })
    expect(bt.lastOptions).toMatchObject({ acceptAllDevices: true, optionalServices: [NUS_SERVICE] })
  })

  it('reaches motor controllers on CAN through a VESC Express', async () => {
    const bt = new FakeBluetooth()
    const t = await BleTransport.request({ bluetooth: bt.api })
    await t.connect()
    expect(t.label).toBe('VESC Express T')
    const client = new VescClient(t)
    expect((await client.getFwVersion()).hwName).toBe('VESC Express T')
    expect(await client.pingCan()).toEqual([10, 11])
    const v = await client.getValues({ target: 10 })
    expect(v.controllerId).toBe(10)
    client.close()
    await t.disconnect()
  })

  it('splits writes into 20-byte chunks and never overlaps them', async () => {
    const device = new FakeBluetoothDevice()
    const t = new BleTransport(device as unknown as BluetoothDevice)
    await t.connect()
    const big = new Uint8Array(150).fill(7)
    await Promise.all([t.write(big), t.write(big.subarray(0, 45)), t.write(big.subarray(0, 3))])
    expect(device.rx.writes).toEqual([20, 20, 20, 20, 20, 20, 20, 10, 20, 20, 5, 3])
    expect(device.rx.overlaps).toBe(0)
    await t.disconnect()
  })

  it('uses bigger writes when set, for links that allow them', async () => {
    const device = new FakeBluetoothDevice()
    device.rx.maxWrite = 244
    const t = new BleTransport(device as unknown as BluetoothDevice, { chunkSize: 128 })
    await t.connect()
    await t.write(new Uint8Array(300))
    expect(device.rx.writes).toEqual([128, 128, 44])
    await t.disconnect()
  })

  it('reassembles large notifications too', async () => {
    const device = new FakeBluetoothDevice()
    device.notifySize = 253 // VESC Express sends up to MTU - 3
    const t = new BleTransport(device as unknown as BluetoothDevice)
    await t.connect()
    const client = new VescClient(t)
    expect((await client.getValues({ target: 11 })).controllerId).toBe(11)
    client.close()
    await t.disconnect()
  })

  it('reports a dropped link once, stays quiet on a normal disconnect, and reconnects', async () => {
    const device = new FakeBluetoothDevice()
    const t = new BleTransport(device as unknown as BluetoothDevice)
    const drops: string[] = []
    t.onDisconnect((r) => drops.push(r))

    await t.connect()
    await t.disconnect()
    expect(drops).toEqual([])

    await t.connect()
    device.goAway()
    expect(drops).toEqual(['Bluetooth connection lost'])

    await expect(t.connect()).rejects.toMatchObject({ name: 'NetworkError' })
    device.comeBack()
    await t.connect()
    const client = new VescClient(t)
    expect((await client.getFwVersion()).hwName).toBe('VESC Express T')
    client.close()
    await t.disconnect()
    expect(drops).toHaveLength(1)
  })

  it('talks to a motor controller through the VESC Bluetooth module (NRF dongle), 20 bytes at a time', async () => {
    // The dongle is a radio on the controller's UART port: the controller itself answers, and CAN goes on from it.
    const dongle = new FakeBluetoothDevice(new MockBus(), 'VESC BLE UART')
    const bt = new FakeBluetooth(dongle)
    const t = await BleTransport.request({ bluetooth: bt.api })
    await t.connect()
    expect(t.label).toBe('VESC BLE UART')
    const client = new VescClient(t)
    expect((await client.getFwVersion()).hwName).toBe('SIM_75_100')
    expect(await client.pingCan()).toEqual([2])
    expect((await client.getValues()).controllerId).toBe(1)
    expect((await client.getValues({ target: 2 })).controllerId).toBe(2)
    expect(Math.max(...dongle.rx.writes)).toBeLessThanOrEqual(20)
    client.close()
    await t.disconnect()
  })

  it('tries again when a phone fails the first connection or service lookup', async () => {
    const device = new FakeBluetoothDevice(new MockBus(), 'VESC BLE UART')
    device.gatt.failConnects = 1
    device.gatt.failServiceLookups = 1
    const t = new BleTransport(device as unknown as BluetoothDevice)
    await t.connect()
    expect(device.gatt.connects).toBe(3)
    const client = new VescClient(t)
    expect((await client.getFwVersion()).hwName).toBe('SIM_75_100')
    client.close()
    await t.disconnect()
  })

  it('explains a device without the VESC UART service', async () => {
    const device = new FakeBluetoothDevice(undefined, 'Headphones')
    device.hasNus = false
    const t = new BleTransport(device as unknown as BluetoothDevice)
    await expect(t.connect()).rejects.toThrow(/Headphones doesn't have the VESC UART service/)
    expect(device.gatt.connected).toBe(false)
  })
})

describe('MockTransport (demo)', () => {
  it('keeps answering while motor detection runs, like the firmware', async () => {
    const bus = new MockBus()
    bus.sim.parked = true
    bus.detectSeconds = 1.5
    const transport = new MockTransport({ bus, connectDelayMs: 1, latencyMs: [1, 2] })
    await transport.connect()
    const client = new VescClient(transport)
    const args = { detectCan: false, maxPowerLoss: 60, minCurrentIn: -10, maxCurrentIn: 20, openloopErpm: 700, sensorlessErpm: 4000 }
    const detection = client.detectApplyAllFoc(args)
    await tick(400)
    // Live values come back mid-detection, and show the motor being measured.
    const started = performance.now()
    const values = await client.getValues({ timeoutMs: 300, retries: 0 })
    expect(performance.now() - started).toBeLessThan(250)
    expect(Math.abs(values.currentMotor)).toBeGreaterThan(0)
    expect(await detection).toBeGreaterThanOrEqual(0)
    await transport.disconnect()
  })
})
