// mc_fault_code from bldc datatypes.h (0-29 in 6.x, 30-33 added in 7.00),
// with plain-language help. Every fault stops the motor output for the
// "Fault Stop Time" setting (500 ms by default), then the controller retries.

export type FaultSeverity = 'info' | 'warn' | 'danger'

export interface FaultInfo {
  code: number
  /** Name without the FAULT_CODE_ prefix, e.g. "OVER_TEMP_FET". */
  id: string
  title: string
  /** One-line summary for alerts. */
  help: string
  causes: string[]
  fixes: string[]
  severity: FaultSeverity
}

const F = (
  code: number,
  id: string,
  title: string,
  severity: FaultSeverity,
  help: string,
  causes: string[],
  fixes: string[],
): FaultInfo => ({ code, id, title, severity, help, causes, fixes })

const ENCODER_FIXES = ['Check the encoder cable and connector for damage or loose pins.', 'Check the encoder type in Motor settings › Encoder matches what is fitted.', 'Re-run motor detection.']
const resolver = (code: number, id: string, title: string) =>
  F(code, id, title, 'danger', 'The resolver sensor signal has a problem.', ['Loose or damaged resolver wiring.', 'Electrical noise from the phase wires.'], ['Check the resolver wiring and shielding.', 'Keep sensor wires away from the motor phase wires.'])

export const FAULTS: FaultInfo[] = [
  F(0, 'NONE', 'No fault', 'info', 'Everything is normal.', [], []),
  F(1, 'OVER_VOLTAGE', 'Battery voltage too high', 'danger',
    'The input voltage went above the maximum setting.',
    ['Regen braking on a full battery pushes the voltage up.', 'The maximum input voltage setting is below what the pack reaches when full.', 'A BMS that cuts charging during braking leaves the energy nowhere to go.'],
    ['Brake gently for the first minutes after a full charge.', 'Lower the regen battery current limit.', 'Check Maximum Input Voltage in Motor settings › Voltage suits your pack.']),
  F(2, 'UNDER_VOLTAGE', 'Battery voltage too low', 'warn',
    'The input voltage dropped below the minimum setting.',
    ['The battery is nearly empty.', 'Voltage sag under hard acceleration on a weak or cold pack.', 'A loose battery connector or thin wiring.', 'Minimum Input Voltage is set too high.'],
    ['Charge the battery.', 'Lower the battery current limit so the pack sags less.', 'Use the battery cut-off helper in Config so power fades before this point.', 'Check the battery connectors.']),
  F(3, 'DRV', 'Gate driver fault', 'danger',
    'The power stage reported a problem and shut down.',
    ['A short between motor phase wires, or from a phase to the frame.', 'A damaged MOSFET.', 'Current limits too high for the hardware.'],
    ['Disconnect the motor and check the phase wires and connectors.', 'Run the terminal command drv_reset_faults, then try again with low current.', 'If it repeats with the motor unplugged, the controller needs repair.']),
  F(4, 'ABS_OVER_CURRENT', 'Current spike too high', 'danger',
    'Motor current hit the absolute maximum and the controller cut power.',
    ['Motor detection values (resistance, inductance, flux linkage) are off.', 'Current limits close to the absolute limit, with no headroom for spikes.', 'Hall or encoder sensor problems at low speed.', 'Field weakening or high ERPM pushing the current controller.'],
    ['Re-run motor detection with the wheel off the ground.', 'Keep Motor Current Max well below Absolute Maximum Current (about 30 % headroom).', 'Check sensor wiring, or try sensorless mode to compare.', 'Lower the current controller gains slightly if the motor is noisy.']),
  F(5, 'OVER_TEMP_FET', 'Controller too hot', 'warn',
    'The controller reached its temperature limit and stopped.',
    ['Long climbs or repeated full-power runs.', 'Poor airflow or no heat sinking.', 'Current limits higher than the controller can handle continuously.'],
    ['Let it cool down before riding on.', 'Improve cooling: mount it on metal, add thermal paste or airflow.', 'Lower the motor current limit, or start the thermal limit a little earlier.']),
  F(6, 'OVER_TEMP_MOTOR', 'Motor too hot', 'warn',
    'The motor reached its temperature limit and stopped.',
    ['Long climbs or heavy loads at high current.', 'Motor current limit too high for this motor.', 'The wrong motor temperature sensor type is set, giving false readings.'],
    ['Let the motor cool down.', 'Lower the motor current limit.', 'Check the motor temperature sensor type in Motor settings › Temperature.']),
  F(7, 'GATE_DRIVER_OVER_VOLTAGE', 'Gate driver voltage too high', 'danger',
    'An internal supply on the controller went too high.',
    ['A hardware problem on the controller.'],
    ['Power cycle the controller.', 'If it repeats, contact the controller maker.']),
  F(8, 'GATE_DRIVER_UNDER_VOLTAGE', 'Gate driver voltage too low', 'danger',
    'An internal supply on the controller dropped too low.',
    ['A weak or loose battery connection.', 'Very low battery voltage.', 'A hardware problem on the controller.'],
    ['Check the battery connectors and wiring.', 'Charge the battery.', 'If it repeats, contact the controller maker.']),
  F(9, 'MCU_UNDER_VOLTAGE', 'Processor voltage too low', 'danger',
    'The controller’s logic supply dropped.',
    ['Accessories drawing too much from the 5 V or 3.3 V outputs.', 'A short on a sensor or accessory cable.'],
    ['Unplug lights, displays and other accessories and try again.', 'Check sensor and accessory cables for shorts.']),
  F(10, 'BOOTING_FROM_WATCHDOG_RESET', 'Controller restarted unexpectedly', 'warn',
    'The firmware stopped responding and restarted itself.',
    ['A firmware bug or a LispBM script that blocks too long.', 'Electrical noise or a supply dip.'],
    ['Note what you were doing when it happened.', 'Update to the latest firmware.', 'Disable custom scripts or packages to see if it stops.']),
  F(11, 'ENCODER_SPI', 'Encoder not answering', 'danger', 'The encoder stopped answering.', ['Loose or broken encoder cable.', 'Wrong encoder type selected.'], ENCODER_FIXES),
  F(12, 'ENCODER_SINCOS_BELOW_MIN_AMPLITUDE', 'Encoder signal too weak', 'danger', 'The sin/cos encoder signal is too small.', ['Encoder too far from the magnet, or a weak magnet.', 'Wiring problem.'], ['Check the encoder mounting and gap.', ...ENCODER_FIXES]),
  F(13, 'ENCODER_SINCOS_ABOVE_MAX_AMPLITUDE', 'Encoder signal too strong', 'danger', 'The sin/cos encoder signal is too large.', ['Encoder gain or amplitude settings don’t match the sensor.'], ['Check the sin/cos encoder settings.', ...ENCODER_FIXES]),
  F(14, 'FLASH_CORRUPTION', 'Firmware storage corrupted', 'danger', 'The controller found damage in its stored firmware.', ['A failed firmware update or a power loss while writing.'], ['Re-flash the firmware.', 'Restore your settings from a backup afterwards.']),
  F(15, 'HIGH_OFFSET_CURRENT_SENSOR_1', 'Current sensor 1 reads wrong at rest', 'danger', 'Current sensor 1 measured too much current with the motor off.', ['The motor was turning when the controller started.', 'A damaged current sensor.', 'Electrical noise.'], ['Power the controller on with the wheel still.', 'If it repeats, the controller may need repair.']),
  F(16, 'HIGH_OFFSET_CURRENT_SENSOR_2', 'Current sensor 2 reads wrong at rest', 'danger', 'Current sensor 2 measured too much current with the motor off.', ['The motor was turning when the controller started.', 'A damaged current sensor.', 'Electrical noise.'], ['Power the controller on with the wheel still.', 'If it repeats, the controller may need repair.']),
  F(17, 'HIGH_OFFSET_CURRENT_SENSOR_3', 'Current sensor 3 reads wrong at rest', 'danger', 'Current sensor 3 measured too much current with the motor off.', ['The motor was turning when the controller started.', 'A damaged current sensor.', 'Electrical noise.'], ['Power the controller on with the wheel still.', 'If it repeats, the controller may need repair.']),
  F(18, 'UNBALANCED_CURRENTS', 'Phase currents don’t add up', 'danger', 'The three motor phase currents are out of balance.', ['A loose or burnt phase connector.', 'A damaged motor winding.', 'A failing current sensor.'], ['Check and reseat the three phase connectors.', 'Inspect the motor wires where they enter the motor.', 'Re-run motor detection; compare resistance with the other motor if you have two.']),
  F(19, 'BRK', 'Hardware over-current shutdown', 'danger', 'The power stage cut out to protect itself.', ['A short on the motor wires.', 'A very large current spike.'], ['Check the phase wires for shorts.', 'Lower current limits and re-run motor detection.']),
  resolver(20, 'RESOLVER_LOT', 'Resolver lost tracking'),
  resolver(21, 'RESOLVER_DOS', 'Resolver signal degraded'),
  resolver(22, 'RESOLVER_LOS', 'Resolver signal lost'),
  F(23, 'FLASH_CORRUPTION_APP_CFG', 'App settings corrupted', 'danger', 'The stored app settings are damaged.', ['A power loss while saving settings.'], ['Restore app settings from a backup (Config › Backups), then write them.']),
  F(24, 'FLASH_CORRUPTION_MC_CFG', 'Motor settings corrupted', 'danger', 'The stored motor settings are damaged.', ['A power loss while saving settings.'], ['Restore motor settings from a backup (Config › Backups), then write them.']),
  F(25, 'ENCODER_NO_MAGNET', 'Encoder magnet not found', 'danger', 'The encoder can’t sense its magnet.', ['The magnet fell off or is too far from the sensor.'], ['Check the magnet is fitted and centred over the sensor.', ...ENCODER_FIXES]),
  F(26, 'ENCODER_MAGNET_TOO_STRONG', 'Encoder magnet too strong', 'danger', 'The encoder magnet is too close or too strong.', ['The magnet sits too close to the sensor.'], ['Increase the gap between magnet and sensor slightly.']),
  F(27, 'PHASE_FILTER', 'Phase filter check failed', 'danger', 'The phase voltage filter self-test failed.', ['A hardware problem on the controller.', 'Phase filters enabled on hardware that doesn’t have them.'], ['Power cycle and try again.', 'Check the phase filter setting in Motor settings.', 'Contact the controller maker if it repeats.']),
  F(28, 'ENCODER_FAULT', 'Encoder fault', 'danger', 'The encoder reported an error.', ['Wiring problem or a failing encoder.'], ENCODER_FIXES),
  F(29, 'LV_OUTPUT_FAULT', 'Low-voltage output fault', 'warn', 'Something on the low-voltage outputs drew too much power.', ['Lights, a display or another accessory drawing too much.', 'A short on an accessory cable.'], ['Unplug accessories one by one to find the cause.']),
  F(30, 'ENCODER_SLIP', 'Encoder slipped', 'danger', 'The encoder position no longer matches the motor.', ['The encoder or magnet moved on its mount.'], ['Check the encoder mounting.', 'Re-run motor detection.']),
  F(31, 'OVERSPEED', 'Motor over speed', 'warn', 'The motor spun faster than the speed limit allows.', ['Riding downhill fast, or a speed limit set low.'], ['Check the maximum ERPM settings.', 'Slow down on long descents.']),
  F(32, 'UNDERSPEED', 'Motor under speed', 'warn', 'The motor turned slower than the current mode needs.', ['The motor was blocked or overloaded.'], ['Check nothing is blocking the wheel.']),
  F(33, 'ABS_OVERSPEED', 'Motor far over speed', 'danger', 'The motor went past the absolute speed limit and the controller shut down.', ['Very fast descent or a lost sensor reading.'], ['Check the speed limit settings and sensors before riding again.']),
]

export function faultInfo(code: number): FaultInfo {
  return (
    FAULTS[code] ??
    F(code, `UNKNOWN_${code}`, `Unknown fault ${code}`, 'warn', 'This firmware reported a fault this app does not know yet.', [], ['Update the app, or look the code up in the firmware’s datatypes.h.'])
  )
}

/** Looks up "FAULT_CODE_OVER_TEMP_FET" (or "OVER_TEMP_FET"). */
export function faultByName(name: string): FaultInfo | null {
  const id = name.trim().toUpperCase().replace(/^FAULT_CODE_/, '')
  return FAULTS.find((f) => f.id === id) ?? null
}

/** The firmware's own name for a code, as `fault` and `faults` print it. */
export function faultFirmwareName(code: number): string {
  return `FAULT_CODE_${faultInfo(code).id}`
}
