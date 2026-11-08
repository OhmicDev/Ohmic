// Which setup steps were finished in this app, per vehicle. It only steers the Setup page
// and the dashboard's reminder; the controller's settings are what count.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useSession } from './session'

export type SetupStep = 'motor' | 'input' | 'direction' | 'battery'
export const SETUP_ORDER: SetupStep[] = ['motor', 'input', 'direction', 'battery']

/** When each step was last finished (ms since epoch). */
export type StepsDone = Partial<Record<SetupStep, number>>

interface SetupProgressState {
  /** By vehicle: the UUID of the controller the app connects to. */
  done: Record<string, StepsDone>
  /** Vehicles the rider said are already set up, so the dashboard stops suggesting it. */
  dismissed: Record<string, number>
  markDone: (vehicle: string, step: SetupStep) => void
  dismiss: (vehicle: string) => void
}

export const useSetupProgress = create<SetupProgressState>()(
  persist(
    (set) => ({
      done: {},
      dismissed: {},
      markDone: (vehicle, step) => set((s) => ({ done: { ...s.done, [vehicle]: { ...s.done[vehicle], [step]: Date.now() } } })),
      dismiss: (vehicle) => set((s) => ({ dismissed: { ...s.dismissed, [vehicle]: Date.now() } })),
    }),
    { name: 'ohmic.setup', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
)

/** The connected vehicle, named by the controller on the cable or Bluetooth link. */
export function useVehicleKey(): string | null {
  return useSession((s) => (s.fw ? s.fw.uuid || s.fw.hwName : null))
}

export function useStepsDone(vehicle: string | null): StepsDone | undefined {
  return useSetupProgress((s) => (vehicle ? s.done[vehicle] : undefined))
}

/** The first step not done yet, starting after `after` and wrapping round; null when all are done. */
export function nextStep(done: StepsDone | undefined, after?: SetupStep): SetupStep | null {
  const from = after ? SETUP_ORDER.indexOf(after) + 1 : 0
  for (let i = 0; i < SETUP_ORDER.length; i++) {
    const step = SETUP_ORDER[(from + i) % SETUP_ORDER.length]
    if (!done?.[step]) return step
  }
  return null
}

export function markSetupDone(step: SetupStep) {
  const { fw } = useSession.getState()
  const vehicle = fw ? fw.uuid || fw.hwName : null
  if (vehicle) useSetupProgress.getState().markDone(vehicle, step)
}
