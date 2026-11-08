// Settings the AI may never propose changes to, whatever it says. The rider can
// still change them in the config editor or with the setup wizards. This list is
// the one place to add to.

interface Blocked {
  /** Exact name, or a pattern for a family of names. */
  match: string | RegExp
  why: string
}

const DETECTED = 'It is measured by motor detection; run detection instead of setting it by hand.'
const WIRING = 'It sets how the controller talks to the bus, remote or throttle; a wrong value can leave the vehicle without control.'
const INPUT = 'It is input wiring or calibration; use the input setup wizard.'

export const AI_BLOCKLIST: Blocked[] = [
  // How the motor is driven and what detection measured.
  { match: 'motor_type', why: 'It changes how the motor is driven.' },
  { match: 'pwm_mode', why: 'It changes how the motor is driven.' },
  { match: 'comm_mode', why: 'It changes how the motor is driven.' },
  { match: 'sensor_mode', why: 'It changes how the motor position is sensed; use motor detection.' },
  { match: 'foc_sensor_mode', why: 'It changes how the motor position is sensed; use motor detection.' },
  { match: /^foc_motor_(r|l|ld_lq_diff|flux_linkage)$/, why: DETECTED },
  { match: /^foc_observer_(gain|gain_slow|offset|type)$/, why: DETECTED },
  { match: /^foc_current_(kp|ki)$/, why: DETECTED },
  { match: /^foc_pll_(kp|ki)$/, why: DETECTED },
  { match: /^(foc_)?hall_table__\d+$/, why: DETECTED },
  { match: /^foc_offsets_/, why: 'It is a calibration the controller measures itself.' },
  { match: /^foc_encoder_|^m_encoder_/, why: 'It is encoder calibration.' },

  // Protection and hardware limits.
  { match: 'l_abs_current_max', why: 'It is the over-current protection.' },
  { match: 'l_slow_abs_current', why: 'It is part of the over-current protection.' },
  { match: 'l_max_vin', why: 'It is the hardware over-voltage protection.' },
  { match: 'l_min_vin', why: 'It is the hardware under-voltage protection.' },
  { match: /^m_drv8301_oc_/, why: 'It is the gate driver’s over-current protection.' },
  { match: 'foc_phase_filter_disable_fault', why: 'It turns off a fault check.' },
  { match: 'm_fault_stop_time_ms', why: 'It sets how faults are handled.' },
  { match: /^(foc_f_zv|foc_dt_us|m_bldc_f_sw_min|m_bldc_f_sw_max|m_dc_f_sw)$/, why: 'Switching frequency and dead time are hardware settings.' },
  { match: /^foc_(current_sample_mode|control_sample_mode)$/, why: 'It is a hardware setting.' },
  { match: /^(m_motor_temp_sens_type|m_ntc_motor_beta|m_ptc_motor_coeff|m_ntcx_ptcx_res|m_ntcx_ptcx_temp_base)$/, why: 'A wrong sensor setting would hide the motor’s real temperature.' },
  { match: 'm_sensor_port_mode', why: 'It is sensor wiring.' },
  { match: 'm_invert_direction', why: 'Use the direction wizard, which tests it with the wheel off the ground.' },
  { match: /^bms\./, why: 'It is battery protection set by the BMS integration.' },

  // Communication, inputs and safety timeouts (app settings).
  { match: /^(controller_id|can_mode|can_baud_rate|pairing_done|permanent_uart_enabled|uart_baudrate|shutdown_mode|kill_sw_mode|servo_out_enable|app_to_use)$/, why: WIRING },
  { match: /^can_status_/, why: WIRING },
  { match: /^(timeout_msec|timeout_brake_current)$/, why: 'It is the safety stop when the remote or throttle signal is lost.' },
  { match: /^app_(adc|ppm)_conf\.(ctrl_type|safe_start|hyst|use_filter|buttons|median_filter|multi_esc|update_rate_hz)$/, why: INPUT },
  { match: /^app_adc_conf\.voltage/, why: INPUT },
  { match: /^app_ppm_conf\.pulse_/, why: INPUT },
  { match: /^app_(nrf|uart|chuk)_conf\./, why: WIRING },
  { match: /^imu_conf\./, why: 'It is IMU calibration and mounting.' },
]

/** Why the AI may not change this setting, or null when it may. */
export function blockedReason(name: string): string | null {
  for (const b of AI_BLOCKLIST) {
    if (typeof b.match === 'string' ? b.match === name : b.match.test(name)) return b.why
  }
  return null
}
