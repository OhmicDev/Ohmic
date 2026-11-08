import { TriangleAlert } from 'lucide-react'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'

/** Shown the first time ABS is turned on: what it does, and what it doesn't. */
export function AbsIntroDialog({ open, onClose, onAccept }: { open: boolean; onClose: () => void; onAccept: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Turn on ABS?"
      subtitle="Experimental · motor braking only"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button variant="primary" onClick={onAccept}>
            I understand, turn it on
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          When a wheel starts to skid under motor braking, ABS eases that motor’s braking for a split second so the tyre grips
          again, then brings it back. It runs on each controller 100 times a second, so it keeps working if your phone
          disconnects.
        </p>
        <ul className="space-y-1.5 text-muted">
          <li>· It only changes motor (regen) braking. Your mechanical brakes are not affected.</li>
          <li>· Below about 7 km/h it never interferes, so you can always come to a stop.</li>
          <li>· A single release is capped at one second; then full braking returns.</li>
          <li>· It switches off when the vehicle is powered off. Turn it on again after each power-up.</li>
        </ul>
        <p className="flex gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            This is new and hasn’t been tested on every vehicle. Try it at low speed somewhere safe before relying on it, and
            never ride beyond what your brakes can do without it.
          </span>
        </p>
      </div>
    </Dialog>
  )
}
