import { useEffect, useState } from 'react'
import type { ConfigKind } from '../../config/types'
import { listBackups, onBackupsChanged, type Backup } from '../../state/backups'
import { errorText } from '../../lib/format'

/** Backups, newest first, refreshed whenever one is added, renamed or deleted. */
export function useBackups({ deviceUuid, kind }: { deviceUuid?: string | null; kind?: ConfigKind } = {}) {
  const [backups, setBackups] = useState<Backup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      listBackups({ deviceUuid, kind })
        .then((found) => {
          if (!live) return
          setBackups(found)
          setError(null)
        })
        .catch((e: unknown) => {
          if (live) setError(errorText(e))
        })
    void load()
    const off = onBackupsChanged(() => void load())
    return () => {
      live = false
      off()
    }
  }, [deviceUuid, kind])
  return { backups, error }
}
