import { useState } from 'react'
import { deleteRide, rideTitle, type RideLog } from '../../state/rideLogs'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'

export function DeleteRideDialog({ ride, onClose, onDeleted }: { ride: RideLog | null; onClose: () => void; onDeleted?: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={!!ride}
      onClose={onClose}
      size="sm"
      locked={busy}
      title="Delete this ride?"
      subtitle={ride ? rideTitle(ride) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!ride) return
              setBusy(true)
              try {
                await deleteRide(ride.id)
              } finally {
                setBusy(false)
              }
              onClose()
              onDeleted?.()
            }}
          >
            Delete ride
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">The ride and its route are removed from this browser. This can’t be undone, so export it first if you want to keep a copy.</p>
    </Dialog>
  )
}
