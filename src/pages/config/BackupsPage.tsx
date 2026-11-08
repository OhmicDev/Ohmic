import { useNavigate } from '@tanstack/react-router'
import { Download, FileUp, GitCompareArrows, History, Loader2, Save, Share2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { decodeConfig, sameOnWire } from '../../config/codec'
import { fwKey, loadDefs, SUPPORTED_FW } from '../../config/registry'
import type { ConfigDefs, ConfigKind, ConfigValues } from '../../config/types'
import { validateValue } from '../../config/validate'
import { detectKind, exportConfigXml, importConfigXml } from '../../config/xmlFile'
import { canShareFiles, downloadText, pickTextFile, safeFileName, shareText, stamp } from '../../lib/files'
import { cx } from '../../lib/format'
import { addBackup, deleteBackup, type Backup } from '../../state/backups'
import { useConfig, type DeviceConfig } from '../../state/config'
import { withoutRideMode } from '../../state/rideModes'
import { activeClient } from '../../state/session'
import { Dialog } from '../../ui/Dialog'
import { BackLink, Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { useConfigUi } from './configUi'
import { describeValue } from './describe'
import { useBackups } from './useBackups'

const kindWord = (k: ConfigKind) => (k === 'mcconf' ? 'Motor' : 'App')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** Definitions for a backup's firmware, loaded on demand. */
function useDefs(fw: string | undefined, kind: ConfigKind | undefined): ConfigDefs | null {
  const [state, setState] = useState<{ id: string; defs: ConfigDefs | null } | null>(null)
  const id = fw && kind ? `${fw}/${kind}` : ''
  useEffect(() => {
    if (!fw || !kind) return
    let live = true
    void loadDefs(fw, kind)?.then((d) => live && setState({ id: `${fw}/${kind}`, defs: d }))
    return () => {
      live = false
    }
  }, [fw, kind])
  return state?.id === id ? state.defs : null
}

/** The connected controller a backup belongs to, if it's here. */
function useOwner(b: Backup): DeviceConfig | null {
  const devices = useConfig((s) => s.devices)
  return b.deviceUuid ? (devices[`uuid:${b.deviceUuid}`] ?? null) : null
}

async function exportBackup(b: Backup, share: boolean) {
  const defs = await loadDefs(b.fw, b.kind)
  if (!defs) return
  const name = `${safeFileName(b.deviceName)}_${b.kind}_${stamp(b.createdAt)}.xml`
  const xml = exportConfigXml(defs, b.values)
  if (share) await shareText(name, xml)
  else downloadText(name, xml)
}

function CompareDialog({ a, b, onClose }: { a: Backup | null; b: { label: string; values: ConfigValues } | null; onClose: () => void }) {
  const defs = useDefs(a?.fw, a?.kind)
  const names = defs && a && b ? defs.order.filter((n) => !sameOnWire(defs.params[n], a.values[n], b.values[n])) : []
  return (
    <Dialog
      open={!!a && !!b}
      onClose={onClose}
      size="lg"
      title="Compare settings"
      subtitle={a && b ? `${new Date(a.createdAt).toLocaleString()} vs ${b.label}` : undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {!defs ? (
        <Loader2 className="size-5 animate-spin text-muted" />
      ) : names.length === 0 ? (
        <p className="text-sm text-ok">Identical: every setting matches.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label px-3 py-2 text-[9.5px]">{plural(names.length, 'difference')}</th>
                <th className="label px-3 py-2 text-right text-[9.5px]">Backup</th>
                <th className="label px-3 py-2 text-right text-[9.5px]">{b?.label}</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5">
                    {defs.params[n].label}
                    <div className="font-mono text-[11px] text-faint">{n}</div>
                  </td>
                  <td className="num px-3 py-1.5 text-right">{describeValue(defs.params[n], a!.values[n])}</td>
                  <td className="num px-3 py-1.5 text-right font-semibold">{describeValue(defs.params[n], b!.values[n])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}

function BackupCard({
  b,
  selected,
  onSelect,
  onCompareLive,
  onRestore,
  onDelete,
}: {
  b: Backup
  selected: boolean
  onSelect: () => void
  onCompareLive: (values: ConfigValues) => void
  onRestore: (owner: DeviceConfig) => void
  onDelete: () => void
}) {
  const owner = useOwner(b)
  const defs = useDefs(b.fw, b.kind)
  const show = (name: string, v: ConfigValues[string]) => (defs?.params[name] ? describeValue(defs.params[name], v) : String(v))
  const live = owner?.[b.kind]
  const canRestore = live?.status === 'ready' && live.defs?.kind === b.kind
  const [open, setOpen] = useState(false)
  const shown = open ? b.changes : b.changes.slice(0, 3)

  return (
    <article className={cx('card p-4 transition-colors md:p-5', selected && 'border-accent/50')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={b.reason === 'before-write' ? 'accent' : 'muted'}>{kindWord(b.kind)}</Badge>
            <h3 className="font-semibold">{b.title}</h3>
          </div>
          <p className="mt-1 text-xs text-muted">
            {b.deviceName} · firmware {b.fw} · {timeAgo(b.createdAt)} ({new Date(b.createdAt).toLocaleString()})
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={selected} onChange={onSelect} className="size-4 accent-[var(--accent)]" />
          Select to compare
        </label>
      </div>

      {b.changes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {shown.map((c) => (
            <li key={c.name} className="text-muted">
              <span className="text-text">{c.label}</span>: {show(c.name, c.from)} → {show(c.name, c.to)}
            </li>
          ))}
          {b.changes.length > 3 && (
            <li>
              <button onClick={() => setOpen(!open)} className="text-xs text-accent hover:underline">
                {open ? 'Show less' : `and ${b.changes.length - 3} more`}
              </button>
            </li>
          )}
        </ul>
      )}
      {b.reason === 'before-write' && (
        <p className="mt-2 text-xs text-faint">These are the settings the controller had just before that write.</p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Button
          className="h-9"
          disabled={!canRestore}
          title={canRestore ? 'Load these settings into your edits, then review and write' : 'Connect this controller to restore'}
          onClick={() => owner && onRestore(owner)}
        >
          <History className="size-4" /> Restore
        </Button>
        <Button
          variant="ghost"
          className="h-9"
          disabled={!live?.device}
          onClick={() => live?.device && onCompareLive(live.device)}
          title={live?.device ? 'Compare with what the controller has now' : 'Connect this controller to compare'}
        >
          <GitCompareArrows className="size-4" /> vs controller
        </Button>
        <Button variant="ghost" className="h-9" onClick={() => void exportBackup(b, false)}>
          <Download className="size-4" /> Export
        </Button>
        {canShareFiles() && (
          <Button variant="ghost" className="h-9" onClick={() => void exportBackup(b, true)}>
            <Share2 className="size-4" /> Share
          </Button>
        )}
        <Button variant="ghost" className="ml-auto h-9 text-danger hover:text-danger" onClick={onDelete}>
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>
    </article>
  )
}

export function BackupsPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<'all' | ConfigKind>('all')
  const [device, setDevice] = useState<string>('all')
  const { backups, error } = useBackups()
  const [selected, setSelected] = useState<number[]>([])
  const [compare, setCompare] = useState<{ a: Backup; b: { label: string; values: ConfigValues } } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const devices = useConfig((s) => s.devices)
  const order = useConfig((s) => s.order)
  const ui = useConfigUi()

  const deviceNames = new Map<string, string>()
  for (const b of backups ?? []) deviceNames.set(b.deviceUuid ?? 'none', b.deviceName)
  const list = (backups ?? []).filter((b) => (kind === 'all' || b.kind === kind) && (device === 'all' || (b.deviceUuid ?? 'none') === device))

  const restore = (b: Backup, owner: DeviceConfig) => {
    const k = owner[b.kind]
    if (!k.defs || !k.draft) return
    const patch: ConfigValues = {}
    let skipped = 0
    for (const n of k.defs.order) {
      const p = k.defs.params[n]
      const v = b.values[n]
      if (v === undefined) continue
      if (validateValue(p, v) && !sameOnWire(p, v, k.device?.[n])) {
        skipped++
        continue
      }
      if (!sameOnWire(p, v, k.draft[n])) patch[n] = v
    }
    if (Object.keys(patch).length === 0) {
      setNotice(`${owner.name} already has these ${kindWord(b.kind).toLowerCase()} settings.`)
      return
    }
    useConfig.getState().edit(owner.key, b.kind, patch)
    ui.set({ deviceKey: owner.key, kind: b.kind, section: null, query: '', changedOnly: true, reviewRequested: true })
    if (skipped) setNotice(`${skipped} value(s) from the backup are outside this firmware’s limits and were left out.`)
    void navigate({ to: '/config' })
  }

  /** Saves a fresh copy of what the selected controller has right now. */
  const backupNow = async () => {
    const key = ui.deviceKey && devices[ui.deviceKey] ? ui.deviceKey : order[0]
    const d = key ? devices[key] : null
    const client = activeClient()
    if (!d || !client) return
    setBusy(true)
    try {
      let saved = 0
      for (const kk of ['mcconf', 'appconf'] as const) {
        const defs = d[kk].defs
        if (!defs || (d[kk].status !== 'ready' && d[kk].status !== 'readonly')) continue
        const raw = await client.getConfig(kk, { target: d.target })
        // A running ride mode shows up as settings; back up the stored ones instead.
        const decoded = decodeConfig(defs, raw)
        const stored = kk === 'mcconf' ? withoutRideMode(d.key, decoded) : null
        await addBackup({
          reason: 'manual',
          title: 'Saved by hand',
          changes: [],
          kind: kk,
          deviceUuid: d.fw.uuid || null,
          deviceName: d.name,
          hwName: d.fw.hwName,
          fw: fwKey(d.fw.major, d.fw.minor),
          signature: defs.signature,
          raw: stored ? null : raw,
          values: stored ?? decoded,
        })
        saved++
      }
      setNotice(saved ? `Saved ${plural(saved, 'backup')} of ${d.name}.` : 'Nothing to back up yet.')
    } catch (e) {
      setNotice(`Couldn’t back up: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** Keeps a VESC Tool file as a backup, so it can be compared and restored later. */
  const importFile = async () => {
    const file = await pickTextFile()
    if (!file) return
    const k = detectKind(file.text)
    if (!k) {
      setNotice('That isn’t a VESC Tool settings file.')
      return
    }
    // Read it against the connected controller's firmware if there is one, else the newest we know.
    const live = order.map((key) => devices[key][k]).find((s) => s.defs)
    const defs = live?.defs ?? (await loadDefs(SUPPORTED_FW[SUPPORTED_FW.length - 1], k))
    if (!defs) return
    try {
      const r = importConfigXml(defs, file.text)
      await addBackup({
        reason: 'imported',
        title: `Imported ${file.name}`,
        changes: [],
        kind: k,
        deviceUuid: null,
        deviceName: 'From file',
        hwName: '',
        fw: defs.fw,
        signature: defs.signature,
        raw: null,
        values: { ...Object.fromEntries(defs.order.map((n) => [n, defs.params[n].def])), ...r.values },
      })
      setNotice(
        `Imported ${plural(Object.keys(r.values).length, 'setting')}` +
          (r.missing.length ? `; ${plural(r.missing.length, 'setting')} missing from the file use VESC Tool’s defaults.` : '.'),
      )
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  const sel = selected.map((id) => backups?.find((b) => b.id === id)).filter((b): b is Backup => !!b)
  const canCompareTwo = sel.length === 2 && sel[0].kind === sel[1].kind

  return (
    <>
      <BackLink to="/tune">Tune</BackLink>
      <PageTitle
        title="Backups"
        subtitle="One is saved automatically before every write. They’re kept in this browser, on this device."
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" onClick={() => void importFile()}>
              <FileUp className="size-4" /> Import file
            </Button>
            <Button onClick={() => void backupNow()} disabled={busy || order.length === 0} title={order.length ? undefined : 'Connect a controller first'}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Back up now
            </Button>
          </div>
        }
      />

      {notice && (
        <p role="status" className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-sm">
          {notice}
          <button onClick={() => setNotice(null)} className="text-muted hover:text-text">
            Dismiss
          </button>
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Settings"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'mcconf', label: 'Motor' },
            { value: 'appconf', label: 'App' },
          ]}
        />
        {deviceNames.size > 1 && (
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="focus-ring h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm"
            aria-label="Controller"
          >
            <option value="all">All controllers</option>
            {[...deviceNames].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <Button className="ml-auto" disabled={!canCompareTwo} onClick={() => setCompare({ a: sel[0], b: { label: new Date(sel[1].createdAt).toLocaleString(), values: sel[1].values } })}>
          <GitCompareArrows className="size-4" /> Compare selected ({sel.length}/2)
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-danger">Couldn’t open backup storage: {error}</p>
      ) : !backups ? (
        <Loader2 className="size-5 animate-spin text-muted" />
      ) : list.length === 0 ? (
        <div className="card p-6 text-sm text-muted md:p-8">
          No backups yet. One is made automatically the first time you write settings, or press “Back up now”.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((b) => (
            <BackupCard
              key={b.id}
              b={b}
              selected={selected.includes(b.id)}
              onSelect={() => setSelected((s) => (s.includes(b.id) ? s.filter((x) => x !== b.id) : [...s, b.id].slice(-2)))}
              onCompareLive={(values) => setCompare({ a: b, b: { label: 'Controller now', values } })}
              onRestore={(owner) => restore(b, owner)}
              onDelete={() => setConfirmDelete(b)}
            />
          ))}
        </div>
      )}

      <CompareDialog a={compare?.a ?? null} b={compare?.b ?? null} onClose={() => setCompare(null)} />
      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title="Delete this backup?"
        subtitle={confirmDelete ? `${confirmDelete.title} · ${new Date(confirmDelete.createdAt).toLocaleString()}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDelete) void deleteBackup(confirmDelete.id)
                setSelected((s) => s.filter((x) => x !== confirmDelete?.id))
                setConfirmDelete(null)
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">It’s removed from this browser for good. Export it first if you might want it later.</p>
      </Dialog>
    </>
  )
}
