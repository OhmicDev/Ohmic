// Terminal commands on a simulated controller. Output follows bldc terminal.c
// (6.06) line for line where the demo has the data; each returned string is
// one COMM_PRINT packet, like one commands_printf call.

import { faultFirmwareName } from '../protocol/faults'
import type { Values } from '../protocol/messages'
import { TERMINAL_COMMANDS, terminalCommand } from '../protocol/terminal'

/** What the firmware stores when a fault starts (fault_data in terminal.c). */
export interface SimFaultRecord {
  code: number
  motor: number
  current: number
  currentFiltered: number
  voltage: number
  duty: number
  rpm: number
  tacho: number
  cyclesRunning: number
  temperature: number
}

/** The firmware keeps 25 entries; the 25th wraps the write index to 0, which empties the printed list. */
export const FAULT_LOG_LEN = 25

interface TerminalDevice {
  /** False for modules like VESC Express that don't drive a motor. */
  motor: boolean
  hwName: string
  uuid: string
  fwMajor: number
  fwMinor: number
  uptimeSec: number
  odometerM: number
  values: Values | null
  faultLog: SimFaultRecord[]
}

const f = (n: number, d: number) => n.toFixed(d)

export function runTerminal(line: string, dev: TerminalDevice): string[] {
  const argv = line.trim().split(/\s+/).filter(Boolean)
  if (argv.length === 0) return ['No command received\n']
  const cmd = argv[0]
  const v = dev.values

  switch (cmd) {
    case 'help': {
      const out = ['Valid commands are:']
      for (const c of TERMINAL_COMMANDS) {
        if (!dev.motor && c.name !== 'help' && c.name !== 'uptime' && c.name !== 'hw_status') continue
        out.push(c.args ? `${c.name} ${c.args}` : c.name, `  ${c.help}`)
      }
      out.push(' ')
      return out
    }
    case 'uptime':
      return [`Uptime: ${f(dev.uptimeSec, 2)} s\n`]
    case 'hw_status':
      return [
        `Firmware: ${dev.fwMajor}.${dev.fwMinor}`,
        `Hardware: ${dev.hwName}`,
        `UUID: ${(dev.uuid.match(/../g) ?? []).map((b) => b.toUpperCase()).join(' ')}`,
        'Permanent NRF found: No',
        'Phase Shunts: No',
        `Odometer : ${Math.floor(dev.odometerM)} m`,
        `Runtime  : ${Math.floor(dev.uptimeSec + 86_400 * 37)} s`,
      ]
  }

  if (!dev.motor) return invalid(cmd)

  switch (cmd) {
    case 'fault':
      return [`${faultFirmwareName(v?.fault ?? 0)}\n`]
    case 'faults': {
      if (dev.faultLog.length === 0) return ['No faults registered since startup\n']
      const out = [`Active fault: ${faultFirmwareName(v?.fault ?? 0)}\n`, 'The following faults were registered since start:\n']
      for (const e of dev.faultLog) {
        out.push(
          `Fault            : ${faultFirmwareName(e.code)}`,
          `Motor            : ${e.motor}`,
          `Current          : ${f(e.current, 1)}`,
          `Current filtered : ${f(e.currentFiltered, 1)}`,
          `Voltage          : ${f(e.voltage, 2)}`,
          `Duty             : ${f(e.duty, 3)}`,
          `RPM              : ${f(e.rpm, 1)}`,
          `Tacho            : ${Math.round(e.tacho)}`,
          `Cycles running   : ${e.cyclesRunning}`,
          `TIM duty         : ${Math.round(8400 * e.duty)}`,
          'TIM val samp     : 4198',
          'TIM current samp : 8399',
          'TIM top          : 8400',
          'Comm step        : 0',
          `Temperature      : ${f(e.temperature, 2)}`,
          ' ',
        )
      }
      return out
    }
    case 'volt':
      return [`Input voltage: ${f(v?.vIn ?? 0, 2)}\n`]
    case 'kv':
      return ['Calculated KV: 17.00 rpm/volt\n']
    case 'mem':
      return ['core free memory : 1912 bytes', 'heap fragments   : 0', 'heap free total  : 0 bytes\n']
  }

  const known = terminalCommand(cmd)
  if (!known) return invalid(cmd)
  if (known.risk === 'spins' || known.risk === 'spins-saves') return ['[demo] The demo scooter doesn’t run motor tests from the terminal.\n']
  return [`[demo] "${cmd}" isn’t simulated in the demo.\n`]
}

function invalid(cmd: string): string[] {
  return [`Invalid command: ${cmd}\ntype help to list all available commands\n`]
}
