import { CloudOff } from 'lucide-react'
import { useT } from '../i18n'
import { usePwa } from '../state/pwa'

/** Says plainly that a feature needs the internet, while the device is offline. */
export function OfflineNote({ what }: { what: 'ai' | 'firmware' }) {
  const online = usePwa((s) => s.online)
  const t = useT()
  if (online) return null
  return (
    <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
      <CloudOff className="mt-0.5 size-4 shrink-0" />
      {t(what === 'ai' ? 'pwa.offlineAi' : 'pwa.offlineFirmware')}
    </div>
  )
}
