import { Link } from '@tanstack/react-router'
import { Download, ScrollText, Upload } from 'lucide-react'
import { useState } from 'react'
import { APP_NAME, APP_VERSION } from '../../appInfo'
import { useT } from '../../i18n'
import { downloadText, pickTextFile, stamp } from '../../lib/files'
import { exportAll, importAll, readExport, type ImportPlan } from '../../state/dataTransfer'
import { PROTOCOL_LOG_LIMIT } from '../../state/protocolLog'
import { useSettings } from '../../state/settings'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'

const TABLE_LABELS: Record<string, string> = {
  backups: 'settings backups',
  packageBackups: 'package settings backups',
  rides: 'ride logs',
  rideChunks: 'ride data blocks',
  rideModes: 'ride modes',
  faults: 'fault records',
  tunes: 'motor sound tunes',
  aiLog: 'AI history entries',
  aiProfile: 'vehicle profile',
  drafts: 'script drafts',
}

/** Export and import of all app data, as one file. */
export function DataPanel() {
  const t = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const [plan, setPlan] = useState<{ name: string; plan: ImportPlan } | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const doExport = async () => {
    setBusy('Gathering your data…')
    setMessage(null)
    try {
      const file = await exportAll(`${APP_NAME} ${APP_VERSION}`)
      downloadText(`ohmic-data_${stamp()}.json`, JSON.stringify(file), 'application/json')
      const n = Object.values(file.tables).reduce((a, r) => a + (r?.length ?? 0), 0)
      setMessage({ tone: 'ok', text: `Exported ${n.toLocaleString()} records and your app settings.` })
    } catch (e) {
      setMessage({ tone: 'error', text: `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const doPick = async () => {
    setMessage(null)
    const f = await pickTextFile('.json,application/json')
    if (!f) return
    try {
      setPlan({ name: f.name, plan: readExport(f.text) })
    } catch (e) {
      setMessage({ tone: 'error', text: `${f.name}: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const doImport = async () => {
    if (!plan) return
    const p = plan.plan
    setPlan(null)
    setBusy('Importing…')
    try {
      const r = await importAll(p)
      setMessage({
        tone: 'ok',
        text: `Imported: ${r.added.toLocaleString()} added, ${r.replaced.toLocaleString()} updated${r.skipped ? `, ${r.skipped.toLocaleString()} already here` : ''}. App settings updated.`,
      })
    } catch (e) {
      setMessage({ tone: 'error', text: `Import failed, nothing was changed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="py-3">
      <p className="mb-3 max-w-md text-xs text-muted">{t('settings.data.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-9" disabled={!!busy} onClick={() => void doExport()}>
          <Download className="size-4" /> {t('settings.data.export')}
        </Button>
        <Button variant="ghost" className="h-9" disabled={!!busy} onClick={() => void doPick()}>
          <Upload className="size-4" /> {t('settings.data.import')}
        </Button>
      </div>
      {busy && (
        <p className="mt-2 text-xs text-muted" role="status">
          {busy}
        </p>
      )}
      {message && (
        <p className={`mt-2 text-xs ${message.tone === 'ok' ? 'text-ok' : 'text-danger'}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <Dialog
        open={!!plan}
        onClose={() => setPlan(null)}
        size="sm"
        title="Import this data?"
        subtitle={plan?.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void doImport()}>
              Import
            </Button>
          </>
        }
      >
        {plan && (
          <div className="space-y-3 text-sm text-muted">
            <p>Exported {plan.plan.exportedAt ? new Date(plan.plan.exportedAt).toLocaleString() : 'at an unknown time'}. It has:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {Object.entries(plan.plan.counts)
                .filter(([, n]) => n)
                .map(([k, n]) => (
                  <li key={k}>
                    <span className="num text-text">{n!.toLocaleString()}</span> {TABLE_LABELS[k] ?? k}
                  </li>
                ))}
              <li>app settings (theme, units, vehicle and so on)</li>
            </ul>
            <p>Nothing here is deleted. Records that are already here are updated from the file; the rest are added. Your AI access code stays as it is.</p>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** Developer options: the protocol log. */
export function DeveloperPanel() {
  const t = useT()
  const on = useSettings((s) => s.protocolLog)
  const set = useSettings((s) => s.setProtocolLog)
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('settings.protocolLog')}</div>
          <div className="mt-0.5 max-w-xs text-xs text-muted">{t('settings.protocolLog.hint', { count: PROTOCOL_LOG_LIMIT.toLocaleString() })}</div>
        </div>
        <Toggle checked={on} onChange={set} label={t('settings.protocolLog')} />
      </div>
      <div className="py-3">
        <Link to="/dev/protocol" className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-surface-3 hover:text-text">
          <ScrollText className="size-4" /> {t('settings.protocolLog.open')}
        </Link>
      </div>
    </>
  )
}
