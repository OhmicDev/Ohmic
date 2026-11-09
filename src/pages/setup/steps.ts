import { BatteryCharging, Cpu, Gauge, RotateCw, type LucideIcon } from 'lucide-react'
import { SETUP_ORDER, type SetupStep, type StepsDone } from '../../state/setupProgress'

type StepRoute = '/setup/motor' | '/setup/input' | '/setup/direction' | '/setup/battery'

export const STEPS: Record<SetupStep, { to: StepRoute; icon: LucideIcon; title: string; hint: string }> = {
  motor: { to: '/setup/motor', icon: Cpu, title: 'Motor detection', hint: 'Measures the motor and sets the controller up to match.' },
  input: { to: '/setup/input', icon: Gauge, title: 'Throttle and brake', hint: 'Calibrates a thumb throttle, brake lever or RC remote.' },
  direction: {
    to: '/setup/direction',
    icon: RotateCw,
    title: 'Motor direction',
    hint: 'Turns each wheel slowly so you can check it goes forward.',
  },
  battery: { to: '/setup/battery', icon: BatteryCharging, title: 'Battery', hint: 'Cells, capacity, current and safe cut-off voltages.' },
}

export const countDone = (done: StepsDone | undefined) => SETUP_ORDER.filter((s) => done?.[s]).length
