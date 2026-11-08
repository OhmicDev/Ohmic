// The VESC terminal: COMM_TERMINAL_CMD carries a command line, and the
// firmware answers with any number of COMM_PRINT packets (one per printf, no
// end marker). Command list and help text from bldc terminal.c (6.06).

import { faultByName } from './faults'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeTerminalCmd(line: string): Uint8Array {
  return enc.encode(line)
}

/** COMM_PRINT body (after the ID byte) as text. Trailing NULs are dropped. */
export function decodePrint(body: Uint8Array): string {
  return dec.decode(body).replace(/\0+$/, '')
}

export type CommandRisk =
  /** Drives the motor: wheel off the ground, nobody near it. */
  | 'spins'
  /** Drives the motor and saves new motor settings when it succeeds. */
  | 'spins-saves'
  /** Restarts the controller; the connection drops for a moment. */
  | 'reboots'

export interface TerminalCommand {
  name: string
  args?: string
  help: string
  risk?: CommandRisk
}

export const TERMINAL_COMMANDS: TerminalCommand[] = [
  { name: 'help', help: 'Show this help' },
  { name: 'last_adc_duration', help: 'The time the latest ADC interrupt consumed' },
  { name: 'kv', help: 'The calculated kv of the motor (BLDC)' },
  { name: 'mem', help: 'Show memory usage' },
  { name: 'threads', help: 'List all threads' },
  { name: 'fault', help: 'Prints the current fault code' },
  { name: 'faults', help: 'Prints all stored fault codes and conditions when they arrived' },
  { name: 'tim', help: 'Prints tim1 and tim8 settings' },
  { name: 'volt', help: 'Prints different voltages' },
  { name: 'param_detect', args: '[current] [min_rpm] [low_duty]', help: 'Spin up the motor in COMM_MODE_DELAY and compute its parameters.', risk: 'spins' },
  { name: 'rpm_dep', help: 'Prints some rpm-dep values' },
  { name: 'foc_encoder_detect', args: '[current]', help: 'Run the motor at 1Hz on open loop and compute encoder settings', risk: 'spins' },
  { name: 'measure_res', args: '[current]', help: 'Lock the motor with a current and calculate its resistance', risk: 'spins' },
  { name: 'measure_ind', args: '[duty]', help: 'Send short voltage pulses, measure the current and calculate the motor inductance', risk: 'spins' },
  { name: 'measure_linkage', args: '[current] [duty] [min_erpm] [motor_res]', help: 'Run the motor in BLDC delay mode and measure the flux linkage', risk: 'spins' },
  { name: 'measure_res_ind', help: 'Measure the motor resistance and inductance with an incremental adaptive algorithm.', risk: 'spins' },
  { name: 'measure_linkage_foc', args: '[duty]', help: 'Run the motor with FOC and measure the flux linkage.', risk: 'spins' },
  { name: 'measure_linkage_openloop', args: '[current] [duty] [erpm_per_sec] [motor_res] [motor_ind]', help: 'Run the motor in openloop FOC and measure the flux linkage', risk: 'spins' },
  { name: 'foc_state', help: 'Print some FOC state variables.' },
  { name: 'foc_dc_cal', help: 'Calibrate current and voltage DC offsets.' },
  { name: 'hw_status', help: 'Print some hardware status information.' },
  { name: 'foc_openloop', args: '[current] [erpm]', help: 'Create an open loop rotating current vector.', risk: 'spins' },
  { name: 'foc_openloop_duty', args: '[duty] [erpm]', help: 'Create an open loop rotating voltage vector.', risk: 'spins' },
  { name: 'nrf_ext_set_enabled', args: '[enabled]', help: 'Enable or disable external NRF51822.' },
  { name: 'foc_sensors_detect_apply', args: '[current]', help: 'Automatically detect FOC sensors, and apply settings on success.', risk: 'spins-saves' },
  { name: 'rotor_lock_openloop', args: '[current_A] [time_S] [angle_DEG]', help: 'Lock the motor with a current for a given time. Time 0 means forever, or until the heartbeat packets stop.', risk: 'spins' },
  { name: 'foc_detect_apply_all', args: '[max_power_loss_W]', help: 'Detect and apply all motor settings, based on maximum resistive motor power losses.', risk: 'spins-saves' },
  { name: 'foc_detect_apply_all_can', args: '[max_power_loss_W]', help: 'Detect and apply all motor settings, based on maximum resistive motor power losses. Also initiates detection in all VESCs found on the CAN-bus.', risk: 'spins-saves' },
  { name: 'uptime', help: 'Prints how many seconds have passed since boot.' },
  { name: 'hall_analyze', args: '[current]', help: 'Rotate motor in open loop and analyze hall sensors.', risk: 'spins' },
  { name: 'crc', help: 'Print CRC values.' },
  { name: 'drv_reset_faults', help: 'Reset gate driver faults (if possible).' },
  { name: 'update_pid_pos_offset', args: '[angle_now] [store]', help: 'Update position PID offset.' },
  { name: 'fw_info', help: 'Print detailed firmware info.' },
  { name: 'rebootwdt', help: 'Reboot using the watchdog timer.', risk: 'reboots' },
  // Registered by other firmware modules (imu.c, encoder.c, mcpwm_foc.c).
  { name: 'imu_type_internal', help: 'Print internal IMU type' },
  { name: 'encoder', help: 'Prints the status of the AS5047, AS5x47U, AD2S1205, TLE5012, MT6816, or TS5700N8501 encoder.' },
  { name: 'encoder_clear_errors', help: 'Clear error of the TS5700N8501 encoder, AD2S1205 resolver.' },
  { name: 'encoder_clear_multiturn', help: 'Clear multiturn counter of the TS5700N8501 encoder.' },
  { name: 'foc_plot_hfi_en', args: '[en]', help: 'Enable HFI plotting. 0: off, 1: DFT, 2: Raw' },
]

const BY_NAME = new Map(TERMINAL_COMMANDS.map((c) => [c.name, c]))

export function terminalCommand(line: string): TerminalCommand | null {
  return BY_NAME.get(line.trim().split(/\s+/)[0] ?? '') ?? null
}

/**
 * Reads the command list out of `help` output, so autocomplete also offers
 * commands this particular controller (or its packages) registered.
 * Command lines start at column 0; their help lines are indented.
 */
export function parseHelp(text: string): TerminalCommand[] {
  const out: TerminalCommand[] = []
  for (const line of text.split('\n')) {
    if (!line.trim() || /^valid commands are/i.test(line)) continue
    if (/^\s/.test(line)) {
      const last = out[out.length - 1]
      if (last) last.help = last.help ? `${last.help} ${line.trim()}` : line.trim()
      continue
    }
    const [name, ...args] = line.trim().split(/\s+/)
    if (!/^[a-z0-9_]+$/i.test(name)) continue
    out.push({ name, args: args.length ? args.join(' ') : undefined, help: '' })
  }
  for (const c of out) if (/^there is no help available/i.test(c.help)) c.help = ''
  return out
}

// ------------------------------------------------------------ `faults` output

export interface FaultLogEntry {
  code: number
  /** FAULT_CODE_... as the firmware printed it. */
  name: string
  motor: number | null
  current: number | null
  currentFiltered: number | null
  voltage: number | null
  gateDriverVoltage: number | null
  duty: number | null
  rpm: number | null
  tacho: number | null
  temperature: number | null
  info: string | null
}

export interface FaultLog {
  /** Fault active right now, or null when none was printed. */
  active: number | null
  entries: FaultLogEntry[]
}

const FIELD_KEYS: Record<string, keyof FaultLogEntry> = {
  motor: 'motor',
  current: 'current',
  'current filtered': 'currentFiltered',
  voltage: 'voltage',
  'gate drv voltage': 'gateDriverVoltage',
  duty: 'duty',
  rpm: 'rpm',
  tacho: 'tacho',
  temperature: 'temperature',
}

/** Parses what the `faults` command prints (bldc terminal.c). Returns null if it doesn't look like a fault log. */
export function parseFaultLog(text: string): FaultLog | null {
  if (/no faults registered since startup/i.test(text)) return { active: null, entries: [] }
  const activeMatch = /active fault:\s*(FAULT_CODE_\w+)/i.exec(text)
  if (!activeMatch && !/^fault\s*:/im.test(text)) return null
  const activeCode = activeMatch ? faultByName(activeMatch[1])?.code : undefined
  const log: FaultLog = { active: activeCode ? activeCode : null, entries: [] }
  let cur: FaultLogEntry | null = null
  for (const raw of text.split('\n')) {
    const m = /^\s*([A-Za-z0-9_ ]+?)\s*:\s*(.*)$/.exec(raw)
    if (!m) continue
    const key = m[1].trim().toLowerCase()
    const value = m[2].trim()
    if (key === 'fault') {
      const info = faultByName(value)
      cur = {
        code: info?.code ?? -1,
        name: value,
        motor: null,
        current: null,
        currentFiltered: null,
        voltage: null,
        gateDriverVoltage: null,
        duty: null,
        rpm: null,
        tacho: null,
        temperature: null,
        info: null,
      }
      log.entries.push(cur)
      continue
    }
    if (!cur) continue
    if (key === 'info') cur.info = value
    else if (key in FIELD_KEYS) {
      const n = Number(value)
      if (Number.isFinite(n)) (cur[FIELD_KEYS[key]] as number | null) = n
    } else if (/_faults$/.test(key) && value) cur.info = cur.info ? `${cur.info}; ${value}` : value
  }
  return log
}
