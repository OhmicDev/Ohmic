import { CloudOff, RefreshCw, X } from 'lucide-react'
import { useEffect } from 'react'
import { useT } from '../i18n'
import { usePwa } from '../state/pwa'
import { useSession } from '../state/session'
import { Button } from './Primitives'

/** "Update ready" and "works offline now", as a small card above the tab bar. */
export function UpdateToast() {
  const { needRefresh, offlineReady, update, dismiss } = usePwa()
  const t = useT()
  // Writing or flashing: don't invite a reload right now.
  const busy = useSession((s) => !!s.busy)

  useEffect(() => {
    if (!offlineReady || needRefresh) return
    const timer = setTimeout(dismiss, 6000)
    return () => clearTimeout(timer)
  }, [offlineReady, needRefresh, dismiss])

  if (!needRefresh && !offlineReady) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-line-strong bg-surface-2 p-3.5 shadow-2xl md:right-6 md:bottom-6 md:left-auto"
    >
      <RefreshCw className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        {needRefresh ? (
          <>
            <p className="font-medium">{t('pwa.updateReady')}</p>
            <p className="mt-0.5 text-xs text-muted">{t('pwa.updateHint')}</p>
            <div className="mt-2.5 flex gap-2">
              <Button variant="primary" className="h-8 px-3 text-xs" disabled={busy} onClick={() => void update()}>
                {t('pwa.reload')}
              </Button>
              <Button variant="ghost" className="h-8 px-3 text-xs" onClick={dismiss}>
                {t('pwa.later')}
              </Button>
            </div>
          </>
        ) : (
          <p>{t('pwa.offlineReady')}</p>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="focus-ring -m-1 rounded p-1 text-muted hover:text-text">
        <X className="size-4" />
      </button>
    </div>
  )
}

/** A thin strip under the header while the device is offline. */
export function OfflineStrip() {
  const online = usePwa((s) => s.online)
  const t = useT()
  if (online) return null
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-xs text-muted md:px-8">
      <CloudOff className="size-3.5 shrink-0" />
      {t('pwa.offline')}
    </div>
  )
}
