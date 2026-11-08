import { useEffect, useState } from 'react'
import type { ConfigKind } from '../../config/types'
import { listBackups, onBackupsChanged, type Backup } from '../../state/backups'

/** Backups, newest first, refreshed whenever one is added, renamed or deleted. */
export function useBackups(filter: { deviceUuid?: string | null; kind?: ConfigKind } = {}) {
  const [list, setList] = useState<Backup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { deviceUuid, kind } = filter
  useEffect(() => {
    let live = true
    const load = () =>
      listBackups({ deviceUuid, kind })
        .then((l) => {
          if (!live) return
          setList(l)
          setError(null)
        })
        .catch((e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : String(e))
        })
    void load()
    const off = onBackupsChanged(() => void load())
    return () => {
      live = false
      off()
    }
  }, [deviceUuid, kind])
  return { backups: list, error }
}
