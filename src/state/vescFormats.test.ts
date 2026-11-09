// VESC data formats behind the scripting, BMS and CAN tools: LispBM programs and
// stats, qCompress, BMS values and CAN frames.
import { describe, expect, it } from 'vitest'
import { qCompress, qCompressStored, qUncompress } from '../lib/qcompress'
import { BufferReader } from '../protocol/buffer'
import { cellSummary, decodeBmsValues, encodeBmsValues, hasBms } from '../protocol/bms'
import { describeVescFrame, parseCanId, parseHexBytes, type CanFrame } from '../protocol/can'
import { decodeLispStats, encodeLispStats, lispStorageBlob, packLispProgram, parseLispStorage, unpackLispProgram } from '../protocol/lisp'

describe('VESC formats', () => {
  it('packs a LispBM script the way VESC Tool does, with size and CRC first', () => {
    const program = packLispProgram('(print "hi")')
    expect([...program.subarray(0, 2)]).toEqual([0, 0])
    expect(program.at(-3)).toBe(0) // end of code
    const blob = lispStorageBlob(program)
    expect(new BufferReader(blob).u32()).toBe(program.length - 2)
    expect(parseLispStorage(blob)).toEqual(program)
    expect(unpackLispProgram(program)).toEqual({ code: '(print "hi")', imports: 0 })
    const bad = blob.slice()
    bad[8] ^= 1
    expect(() => parseLispStorage(bad)).toThrow(/checksum/)
    expect(parseLispStorage(new Uint8Array(16).fill(0xff))).toBeNull()
  })

  it('reads LispBM stats', () => {
    const s = decodeLispStats(new BufferReader(encodeLispStats({ cpu: 12.5, heap: 30.25, mem: 8, bindings: [{ name: 'speed', value: 4.5 }] })))
    expect(s.cpu).toBeCloseTo(12.5)
    expect(s.heap).toBeCloseTo(30.25)
    expect(s.bindings).toEqual([{ name: 'speed', value: 4.5 }])
  })

  it('round-trips qCompress, including the simulator’s uncompressed form', async () => {
    const text = new TextEncoder().encode('hello '.repeat(500))
    expect(await qUncompress(await qCompress(text))).toEqual(text)
    expect(await qUncompress(qCompressStored(text))).toEqual(text)
    const big = new Uint8Array(70_000).map((_, i) => i % 251)
    expect(await qUncompress(qCompressStored(big))).toEqual(big)
    await expect(qUncompress(Uint8Array.of(0, 0, 0, 9, 1, 2, 3))).rejects.toThrow(/damaged/)
  })

  it('reads BMS values, newest fields optional', () => {
    const v = decodeBmsValues(
      new BufferReader(
        encodeBmsValues({
          vTotal: 48.2,
          vCharge: 0,
          current: 3.4,
          currentIc: 3.4,
          ahCount: 1.2,
          whCount: 55,
          cells: [3.701, 3.712, 3.695],
          balancing: [false, true, false],
          temps: [25.5, 26],
          tempIc: 30,
          tempHumSensor: 22,
          humidity: 40,
          tempCellsHighest: 26,
          soc: 0.62,
          soh: 0.98,
          canId: 20,
          ahChargeTotal: 10,
          whChargeTotal: 480,
          ahDischargeTotal: 12,
          whDischargeTotal: 560,
          pressure: null,
          dataVersion: 1,
          status: 'Idle',
        }),
      ),
    )
    expect(v.vTotal).toBeCloseTo(48.2, 5)
    expect(v.cells).toEqual([3.701, 3.712, 3.695])
    expect(v.balancing).toEqual([false, true, false])
    expect(v.soc).toBeCloseTo(0.62)
    expect(v.canId).toBe(20)
    expect(v.status).toBe('Idle')
    expect(hasBms(v)).toBe(true)
    expect(cellSummary(v)).toMatchObject({ minIndex: 2, maxIndex: 1, balancing: 1 })
    expect(cellSummary(v)!.spread).toBeCloseTo(0.017)
  })

  it('names VESC CAN traffic and parses hand-typed frames', () => {
    const f: CanFrame = { id: (9 << 8) | 2, extended: true, data: Uint8Array.of(0, 0, 0x13, 0x88, 0, 105, 0x01, 0xf4) }
    expect(describeVescFrame(f)).toEqual({ sender: 2, type: 9, name: 'STATUS', text: '5000 ERPM · 10.5 A · duty 50.0 %' })
    expect(describeVescFrame({ ...f, extended: false })).toBeNull()
    expect(parseHexBytes('01 02 ff')).toEqual(Uint8Array.of(1, 2, 255))
    expect(parseHexBytes('0102ff')).toEqual(Uint8Array.of(1, 2, 255))
    expect(parseHexBytes('0x01,0x02')).toEqual(Uint8Array.of(1, 2))
    expect(parseHexBytes('zz')).toBeNull()
    expect(parseHexBytes('00 '.repeat(9))).toBeNull()
    expect(parseCanId('0x902', true)).toBe(0x902)
    expect(parseCanId('2048', false)).toBeNull()
    expect(parseCanId('-1', true)).toBeNull()
  })
})
