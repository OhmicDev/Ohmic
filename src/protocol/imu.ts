// COMM_GET_IMU_DATA (bldc comm/commands.c). The request carries a u16 mask;
// the reply echoes it, then one float32_auto per set bit, then the controller ID.
// Angles are radians, acceleration in g, rotation in degrees per second.

import { BufferReader, BufferWriter } from './buffer'
import { COMM } from './commands'

export const IMU_FIELDS = [
  'roll', 'pitch', 'yaw',
  'accX', 'accY', 'accZ',
  'gyroX', 'gyroY', 'gyroZ',
  'magX', 'magY', 'magZ',
  'q0', 'q1', 'q2', 'q3',
] as const

type ImuField = (typeof IMU_FIELDS)[number]
export type ImuData = Record<ImuField, number>

/** Angles, acceleration and rotation: what the live data screen uses. */
export const IMU_MASK_MOTION = 0x01ff

export function emptyImu(): ImuData {
  return Object.fromEntries(IMU_FIELDS.map((f) => [f, 0])) as ImuData
}

export function encodeImuRequest(mask: number): Uint8Array {
  return new BufferWriter().u16(mask).toUint8Array()
}

export function decodeImu(r: BufferReader): { mask: number; data: ImuData; controllerId: number | null } {
  const mask = r.u16()
  const data = emptyImu()
  IMU_FIELDS.forEach((f, bit) => {
    if (mask & (1 << bit) && r.has(4)) data[f] = r.f32auto()
  })
  return { mask, data, controllerId: r.has(1) ? r.u8() : null }
}

/** Reply as the firmware builds it (used by the simulator and tests). */
export function encodeImu(data: ImuData, mask: number, controllerId: number): Uint8Array {
  const w = new BufferWriter().u8(COMM.GET_IMU_DATA).u16(mask)
  IMU_FIELDS.forEach((f, bit) => {
    if (mask & (1 << bit)) w.f32auto(data[f])
  })
  return w.u8(controllerId).toUint8Array()
}

// COMM_GET_IMU_CALIBRATION: request [f32 yaw ×1e3] (degrees, the board's mounting yaw,
// which gravity can't tell). The firmware samples the IMU at rest and replies with nine
// f32 ×1e6 values, which VESC Tool puts into the app settings as below.
export const IMU_CAL_PARAMS = [
  'imu_conf.rot_roll',
  'imu_conf.rot_pitch',
  'imu_conf.rot_yaw',
  'imu_conf.accel_offsets__0',
  'imu_conf.accel_offsets__1',
  'imu_conf.accel_offsets__2',
  'imu_conf.gyro_offsets__0',
  'imu_conf.gyro_offsets__1',
  'imu_conf.gyro_offsets__2',
] as const

export type ImuCalibration = number[]

export function encodeImuCalibrationRequest(yawDeg: number): Uint8Array {
  return new BufferWriter().f32(yawDeg, 1e3).toUint8Array()
}

export function decodeImuCalibration(r: BufferReader): ImuCalibration {
  return IMU_CAL_PARAMS.map(() => r.f32(1e6))
}

export function encodeImuCalibration(cal: ImuCalibration): Uint8Array {
  const w = new BufferWriter().u8(COMM.GET_IMU_CALIBRATION)
  for (const v of cal) w.f32(v, 1e6)
  return w.toUint8Array()
}
