// Plain-language help for the settings people change most. The original VESC
// Tool description is always shown too; this only adds an easier explanation.

export interface Curated {
  plain: string
  /** Friendlier names for an enum's options, in the same order. */
  options?: string[]
}

const DETECTED = 'Measured by motor detection, so run detection rather than typing a value.'

export const CURATED: Record<string, Curated> = {
  motor_type: {
    plain:
      'How the controller drives the motor. FOC is smooth and quiet and is what almost every scooter, e-bike and board uses. BLDC is older and louder. DC is for brushed motors.',
  },
  l_current_max: {
    plain:
      'The most current the motor may take when accelerating. Higher means more torque and harder launches, but more heat in the motor and controller. This is motor current, not battery current.',
  },
  l_current_min: {
    plain: 'The most braking current, as a negative number. More negative means stronger regenerative braking.',
  },
  l_in_current_max: {
    plain:
      'The most current the controller may pull from the battery. This sets peak power and protects the battery, so keep it within what your pack and its BMS can deliver.',
  },
  l_in_current_min: {
    plain:
      'The most current pushed back into the battery when braking, as a negative number. Too much can overcharge a full pack or trip the BMS.',
  },
  l_abs_current_max: {
    plain:
      'A safety cut. If motor current ever spikes past this, the controller stops the motor and records an over-current fault. Keep it well above the motor current limit.',
  },
  l_slow_abs_current: {
    plain: 'Uses a filtered current for the safety cut above, so very short spikes don’t trigger a fault.',
  },
  l_current_max_scale: {
    plain:
      'Scales the motor current limit, which is handy for ride modes: 50 % gives half the torque without changing the limit itself.',
  },
  l_current_min_scale: { plain: 'Scales the braking current limit, the same way.' },
  l_max_erpm: {
    plain: 'Top speed limit, in electrical RPM (motor RPM × pole pairs).',
  },
  l_min_erpm: { plain: 'Reverse speed limit, in electrical RPM. It is negative.' },
  l_max_duty: {
    plain:
      'The largest share of battery voltage the controller will apply to the motor. Leave a little headroom below 100 % so current control stays stable at top speed.',
  },
  l_watt_max: { plain: 'Power limit while accelerating, in watts, on top of the current limits.' },
  l_watt_min: { plain: 'Power limit while braking, in watts (negative).' },
  l_min_vin: {
    plain:
      'Below this battery voltage the controller shuts the motor off with a fault. It is a last-resort guard: the battery cut-off settings should reduce power well before this.',
  },
  l_max_vin: {
    plain: 'Above this battery voltage the controller stops with a fault, which protects it from overvoltage when braking on a full pack.',
  },
  l_battery_cut_start: {
    plain:
      'As the battery drains toward this voltage, the controller starts reducing power. The pack isn’t over-drained and the ride doesn’t end in a sudden shutdown.',
  },
  l_battery_cut_end: {
    plain: 'At this voltage the power is fully cut. Set it a little above your battery’s absolute minimum.',
  },
  l_battery_regen_cut_start: {
    plain: 'With a nearly full battery, regenerative braking is reduced between this voltage and the end voltage, so a full pack isn’t overcharged.',
  },
  l_battery_regen_cut_end: { plain: 'Regenerative braking is fully off at this battery voltage.' },
  l_temp_fet_start: { plain: 'Controller temperature where power starts being reduced to protect it.' },
  l_temp_fet_end: { plain: 'Controller temperature where power reaches zero.' },
  l_temp_motor_start: {
    plain: 'Motor temperature where power starts being reduced. Needs a temperature sensor in the motor.',
  },
  l_temp_motor_end: { plain: 'Motor temperature where power reaches zero.' },
  si_motor_poles: {
    plain:
      'Number of magnet poles in the motor (not pole pairs). Speed and distance are wrong without it. Hub motors often have 20 to 56: count the magnets or check the motor’s spec.',
  },
  si_wheel_diameter: { plain: 'Outside diameter of the tyre, used for speed and distance.' },
  si_gear_ratio: { plain: 'Motor turns per wheel turn. 1 for hub motors.' },
  si_battery_cells: {
    plain: 'Cells in series: the “S” in 13S. Used for battery percentage and the cut-off helper.',
  },
  si_battery_ah: { plain: 'Battery capacity in amp-hours, used for range estimates.' },
  si_battery_type: {
    plain: 'Battery chemistry, used to turn voltage into a charge percentage.',
    options: ['Li-ion (3.0 to 4.2 V per cell)', 'LiFePO4 (2.6 to 3.6 V per cell)', 'Lead acid'],
  },
  foc_motor_r: { plain: `Resistance of the motor windings. ${DETECTED}` },
  foc_motor_l: { plain: `Inductance of the motor windings. ${DETECTED}` },
  foc_motor_ld_lq_diff: { plain: `How much the inductance changes with rotor position. ${DETECTED}` },
  foc_motor_flux_linkage: {
    plain: `Strength of the motor’s magnets. ${DETECTED} A wrong value causes stutter or a motor that won’t start.`,
  },
  foc_current_kp: { plain: `Gain of the current control loop, worked out from resistance and inductance. ${DETECTED}` },
  foc_current_ki: { plain: `Integral gain of the current control loop. ${DETECTED}` },
  foc_observer_gain: {
    plain: `How strongly the sensorless rotor position estimate corrects itself. ${DETECTED}`,
  },
  foc_sensor_mode: {
    plain:
      'How the controller knows where the rotor is: worked out from motor voltage (sensorless), hall sensors, an encoder, or HFI, which also works at standstill.',
  },
  foc_fw_current_max: {
    plain:
      'Field weakening: extra current used to go faster than the battery voltage would normally allow. It adds heat and battery draw. 0 turns it off.',
  },
  foc_fw_duty_start: { plain: 'Duty cycle where field weakening starts to kick in.' },
  m_invert_direction: { plain: 'Swaps which way the motor turns for “forward”.' },
  controller_id: {
    plain:
      'This controller’s address on the CAN bus. Every controller on the bus needs a different number. Changing it moves the controller to the new address.',
  },
  app_to_use: {
    plain: 'Which input controls the motor: an RC receiver (PPM), a thumb throttle (ADC), a remote or display over UART, and so on.',
  },
  timeout_msec: {
    plain: 'If the throttle signal stops for this long, the motor stops. A safety net for a lost remote.',
  },
  timeout_brake_current: { plain: 'Braking current applied when the timeout above triggers.' },
}

export function curatedHelp(name: string): Curated | undefined {
  return CURATED[name]
}

/** Enum option label: curated wording first, then VESC Tool's name made readable. */
export function optionLabel(name: string, index: number, raw: string | undefined): string {
  const nice = CURATED[name]?.options?.[index]
  if (nice) return nice
  if (!raw) return `Option ${index}`
  // Some VESC Tool enum names are C identifiers: BATTERY_TYPE_LIION_3_0__4_2
  if (/^[A-Z0-9_]+$/.test(raw) && raw.includes('_')) {
    return raw
      .toLowerCase()
      .replace(/_+/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  }
  return raw
}
