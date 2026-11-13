import { Link } from '@tanstack/react-router'
import {
  Archive,
  ChevronDown,
  Download,
  Eraser,
  Loader2,
  Lock,
  Plug,
  Redo2,
  RefreshCw,
  Search,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sameOnWire } from '../../config/codec'
import { curatedHelp } from '../../config/help'
import { fwKey } from '../../config/registry'
import { SEPARATOR, type ConfigDefs, type ConfigKind, type ConfigValue, type ConfigValues } from '../../config/types'
import { validateConfig, type Issue } from '../../config/validate'
import { detectKind, exportConfigXml, importConfigXml } from '../../config/xmlFile'
import { downloadText, pickTextFile, safeFileName, stamp } from '../../lib/files'
import { cx, errorText } from '../../lib/format'
import { pendingCount, useConfig, type DeviceConfig } from '../../state/config'
import { useSession } from '../../state/session'
import { Button, PageTitle } from '../../ui/Primitives'
import { ReconnectBanner } from '../../ui/ReconnectBanner'
import { Tabs } from '../../ui/Tabs'
import { Toggle } from '../../ui/Toggle'
import { BatteryHelper } from './BatteryHelper'
import { sectionId, useConfigUi, type CompareWith } from './configUi'
import { ImportDialog, type PendingImport } from './ImportDialog'
import { LiveStrip } from './LiveStrip'
import { ParamRow } from './ParamRow'
import { useBackups } from './useBackups'
import { WriteDialog } from './WriteDialog'

interface Section {
  id: string
  group: string
  subgroup: string
  items: string[]
}

function sectionsOf(defs: ConfigDefs): Section[] {
  const out: Section[] = []
  for (const g of defs.groups) {
    for (const sg of g.subgroups) out.push({ id: sectionId(g.name, sg.name), group: g.name, subgroup: sg.name, items: sg.items })
  }
  // Anything the firmware sends that VESC Tool doesn't group still gets a home.
  const grouped = new Set(out.flatMap((s) => s.items))
  const rest = defs.order.filter((n) => !grouped.has(n))
  if (rest.length) out.push({ id: sectionId('Other', 'Ungrouped'), group: 'Other', subgroup: 'Ungrouped', items: rest })
  return out
}

interface Group {
  name: string
  sections: Section[]
}

function groupsOf(sections: Section[]): Group[] {
  const out: Group[] = []
  for (const s of sections) {
    const g = out.find((x) => x.name === s.group)
    if (g) g.sections.push(s)
    else out.push({ name: s.group, sections: [s] })
  }
  return out
}

const PANEL = 'config-panel'
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const groupTabId = (name: string) => `config-group-${slug(name)}`
const subTabId = (id: string) => `config-section-${slug(id)}`

/** The tab last open in each group, and in each of motor and app, so going back lands where you were. */
const lastIn = new Map<string, string>()

function resultsText(n: number, query: string | null, changedOnly: boolean, compareLabel: string) {
  const one = n === 1
  const what = `${n} setting${one ? '' : 's'}`
  if (query) return `${what} match${one ? 'es' : ''} “${query}”`
  if (changedOnly) return `${what} changed`
  return `${what} differ${one ? 's' : ''} from the ${compareLabel === 'Default' ? 'defaults' : 'backup'}`
}

function matcher(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return (defs: ConfigDefs, name: string) => {
    const p = defs.params[name]
    const hay = `${p.label} ${p.name} ${p.help} ${curatedHelp(name)?.plain ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  }
}

const KIND_OPTIONS: { value: ConfigKind; label: string }[] = [
  { value: 'mcconf', label: 'Motor' },
  { value: 'appconf', label: 'App' },
]

function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-4 p-6 md:p-8">
      <div className="max-w-xl text-sm leading-relaxed text-muted">{children}</div>
      {action}
    </div>
  )
}

function useUndoKeys(key: string | null, kind: ConfigKind) {
  useEffect(() => {
    if (!key) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        useConfig.getState().undo(key, kind)
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        useConfig.getState().redo(key, kind)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, kind])
}

export function ConfigPage() {
  const status = useSession((s) => s.status)
  const devices = useConfig((s) => s.devices)
  const order = useConfig((s) => s.order)
  const ui = useConfigUi()
  const key = ui.deviceKey && devices[ui.deviceKey] ? ui.deviceKey : (order[0] ?? null)
  const dev = key ? devices[key] : null
  useUndoKeys(key, ui.kind)

  const backupsLink = (
    <Link to="/config/backups">
      <Button variant="ghost">
        <Archive className="size-4" /> Backups
      </Button>
    </Link>
  )

  if (!dev) {
    const busy = status === 'connecting' || (status === 'connected' && order.length === 0)
    return (
      <>
        <PageTitle title="Tune" subtitle="Every motor and app setting, searchable, with help." actions={backupsLink} />
        {status === 'reconnecting' && <ReconnectBanner />}
        <EmptyState
          action={
            status === 'connected' ? null : (
              <Link to="/connect">
                <Button variant="primary">
                  <Plug className="size-4" /> Connect
                </Button>
              </Link>
            )
          }
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Looking for motor controllers…
            </span>
          ) : status === 'connected' ? (
            'This device has no motor controller to configure. If one is on the CAN bus, rescan from the Connect page.'
          ) : (
            'Connect to a controller to see and change its settings. Changes are reviewed and backed up before anything is written.'
          )}
        </EmptyState>
      </>
    )
  }

  return <Editor dev={dev} keys={order} devices={devices} backupsLink={backupsLink} />
}

function Editor({
  dev,
  keys,
  devices,
  backupsLink,
}: {
  dev: DeviceConfig
  keys: string[]
  devices: Record<string, DeviceConfig>
  backupsLink: React.ReactNode
}) {
  const ui = useConfigUi()
  const sessionStatus = useSession((s) => s.status)
  const kind = ui.kind
  const k = dev[kind]
  const { defs, draft, device } = k
  const readOnly = k.status !== 'ready' || sessionStatus !== 'connected'
  const [writing, setWriting] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const pending = pendingCount(k)
  const cfg = useConfig.getState

  // Restore from the Backups page asks for the review to open once the settings are here.
  const reviewOpen = writing || (ui.reviewRequested && k.status === 'ready' && pending > 0)
  const closeReview = () => {
    setWriting(false)
    if (useConfigUi.getState().reviewRequested) ui.set({ reviewRequested: false })
  }

  const { backups } = useBackups({ deviceUuid: dev.fw.uuid || null, kind })
  const compareWith = ui.compare
  const compareBackup = typeof compareWith === 'object' ? backups?.find((b) => b.id === compareWith.backupId) : undefined
  const compareValues: ConfigValues | null = compareWith === 'defaults' ? k.defaults : compareBackup ? compareBackup.values : null
  const compareLabel = compareWith === 'defaults' ? 'Default' : compareBackup ? 'Backup' : ''

  const sections = useMemo(() => (defs ? sectionsOf(defs) : []), [defs])
  const groups = useMemo(() => groupsOf(sections), [sections])
  const card = useRef<HTMLElement>(null)
  const issues = useMemo(() => {
    const map = new Map<string, Issue[]>()
    if (!defs || !draft) return map
    for (const i of validateConfig(defs, draft, { base: device ?? undefined })) map.set(i.param, [...(map.get(i.param) ?? []), i])
    return map
  }, [defs, draft, device])

  const onCommit = useCallback((name: string, value: ConfigValue) => cfg().edit(dev.key, kind, { [name]: value }), [cfg, dev.key, kind])

  const changedIn = (items: string[]) =>
    defs && draft && device ? items.filter((n) => !n.startsWith(SEPARATOR) && defs.params[n] && !sameOnWire(defs.params[n], draft[n], device[n])).length : 0

  const match = matcher(ui.query)
  const listMode = !!match || ui.changedOnly || (ui.differsOnly && !!compareValues)
  const section = sections.find((s) => s.id === ui.section) ?? sections[0]
  const group = groups.find((g) => g.name === section?.group)

  const show = (id: string) => {
    const s = sections.find((x) => x.id === id)
    if (!s) return
    lastIn.set(kind, id)
    lastIn.set(`${kind}/${s.group}`, id)
    ui.set({ section: id, query: '', changedOnly: false, differsOnly: false })
    // Scrolled down into the last tab: start the new one at its top.
    const top = card.current?.getBoundingClientRect().top
    const head = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    if (top !== undefined && top < head) window.scrollTo({ top: window.scrollY + top - head - 8 })
  }
  const showGroup = (name: string) => {
    const g = groups.find((x) => x.name === name)
    if (!g) return
    const last = lastIn.get(`${kind}/${name}`)
    show(g.sections.some((s) => s.id === last) ? last! : g.sections[0].id)
  }
  const clearFilters = () => ui.set({ query: '', changedOnly: false, differsOnly: false })

  const visible = (name: string) => {
    if (!defs || !draft || name.startsWith(SEPARATOR) || !defs.params[name]) return false
    const p = defs.params[name]
    if (match && !match(defs, name)) return false
    if (ui.changedOnly && (!device || sameOnWire(p, draft[name], device[name]))) return false
    if (ui.differsOnly && compareValues && sameOnWire(p, draft[name], compareValues[name])) return false
    return true
  }

  const doImport = async () => {
    const file = await pickTextFile()
    if (!file) return
    const fileKind = detectKind(file.text)
    if (!fileKind) {
      setPendingImport({ fileName: file.name, result: null, error: 'This isn’t a VESC Tool settings file (motor or app configuration XML).' })
      return
    }
    const target = dev[fileKind]
    if (fileKind !== kind) ui.set({ kind: fileKind })
    if (!target.defs || target.status !== 'ready') {
      setPendingImport({ fileName: file.name, result: null, error: target.reason ?? 'These settings can’t be edited on this controller.' })
      return
    }
    try {
      setPendingImport({ fileName: file.name, result: importConfigXml(target.defs, file.text), error: null })
    } catch (e) {
      setPendingImport({ fileName: file.name, result: null, error: errorText(e) })
    }
  }

  const doExport = () => {
    if (!defs || !draft) return
    downloadText(`${safeFileName(dev.name)}_${kind}_${stamp()}.xml`, exportConfigXml(defs, draft))
  }

  const rows = (items: string[], showSeparators: boolean) =>
    items.map((name) => {
      if (name.startsWith(SEPARATOR)) {
        if (!showSeparators) return null
        const label = name.slice(SEPARATOR.length)
        return label ? (
          <div key={name} className="label border-b border-line bg-surface-2/40 px-4 py-2 text-[9.5px] md:px-5">
            {label}
          </div>
        ) : null
      }
      if (!visible(name) || !defs || !draft) return null
      return (
        <ParamRow
          key={name}
          p={defs.params[name]}
          value={draft[name]}
          device={device?.[name]}
          defaultValue={k.defaults?.[name]}
          compare={compareValues ? { label: compareLabel, value: compareValues[name] } : undefined}
          readOnly={readOnly}
          issues={issues.get(name)}
          onCommit={onCommit}
        />
      )
    })

  const listSections = listMode ? sections.map((s) => ({ s, items: s.items.filter(visible) })).filter((x) => x.items.length) : []
  const found = listSections.reduce((n, x) => n + x.items.length, 0)
  const showBattery = !listMode && kind === 'mcconf' && !!section?.items.includes('l_battery_cut_start') && !!draft

  return (
    <>
      <PageTitle
        title="Tune"
        subtitle={
          <>
            {dev.name} · firmware {fwKey(dev.fw.major, dev.fw.minor)}
            {defs && ` · ${defs.order.length} settings`}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" onClick={() => void doImport()} disabled={readOnly} title="Load a VESC Tool .xml settings file into your edits">
              <Upload className="size-4" /> Import
            </Button>
            <Button variant="ghost" onClick={doExport} disabled={!draft} title="Save these settings as a VESC Tool .xml file">
              <Download className="size-4" /> Export
            </Button>
            {backupsLink}
          </div>
        }
      />

      <div className="space-y-3">
        {sessionStatus === 'reconnecting' && <ReconnectBanner />}
        <LiveStrip target={dev.target} />

        <div className="flex flex-wrap items-center gap-2">
          {keys.length > 1 && (
            <label className="relative inline-flex min-w-0 max-sm:flex-1">
              <span className="sr-only">Controller</span>
              <select
                value={dev.key}
                onChange={(e) => ui.set({ deviceKey: e.target.value })}
                className="focus-ring h-9 w-full cursor-pointer appearance-none truncate rounded-lg border border-line bg-surface-2 pr-9 pl-3 text-[13px] font-medium md:h-10 md:text-sm"
              >
                {keys.map((kk) => {
                  const d = devices[kk]
                  const n = pendingCount(d.mcconf) + pendingCount(d.appconf)
                  return (
                    <option key={kk} value={kk}>
                      {d.name}
                      {n ? ` (${n} unsaved)` : ''}
                    </option>
                  )
                })}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
            </label>
          )}
          <Tabs
            look="segment"
            label="Settings"
            tabs={KIND_OPTIONS.map((o) => ({ id: o.value, label: o.label, count: pendingCount(dev[o.value]), countLabel: 'unsaved' }))}
            value={kind}
            onChange={(v) => ui.set({ kind: v, section: lastIn.get(v) ?? null })}
            tabId={(v) => `config-kind-${v}`}
          />
          <Button
            variant="ghost"
            onClick={() => void cfg().read(dev.key, [kind])}
            disabled={k.status === 'loading' || sessionStatus !== 'connected'}
            title="Read the settings from the controller again. Your edits are kept."
          >
            <RefreshCw className={cx('size-4', k.status === 'loading' && 'animate-spin')} />
            <span className="max-sm:sr-only">
              {k.readAt ? `Read ${new Date(k.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Read'}
            </span>
          </Button>
        </div>

        {k.status === 'readonly' && (
          <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
            <Lock className="mt-0.5 size-4 shrink-0" /> {k.reason} Writing is turned off.
          </p>
        )}
        {k.status === 'error' && (
          <EmptyState action={<Button onClick={() => void cfg().read(dev.key, [kind])}>Try again</Button>}>{k.reason}</EmptyState>
        )}
        {k.status === 'unsupported' && <EmptyState>{k.reason}</EmptyState>}
        {(k.status === 'idle' || (k.status === 'loading' && !draft)) && (
          <EmptyState>
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Reading {kind === 'mcconf' ? 'motor' : 'app'} settings from {dev.name}…
            </span>
          </EmptyState>
        )}

        {defs && draft && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 basis-full sm:basis-64">
                <span className="sr-only">Search settings</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  role="searchbox"
                  enterKeyHint="search"
                  value={ui.query}
                  onChange={(e) => ui.set({ query: e.target.value })}
                  placeholder={`Search ${defs.order.length} settings by name or description`}
                  className="focus-ring h-10 w-full rounded-lg border border-line bg-surface-2 pr-9 pl-9 text-sm placeholder:text-faint"
                />
                {ui.query && (
                  <button
                    onClick={() => ui.set({ query: '' })}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-text"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </label>
              <label className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm">
                <Toggle checked={ui.changedOnly} onChange={(v) => ui.set({ changedOnly: v })} label="Show changed only" />
                Changed only
              </label>
              <label className="relative inline-flex min-w-0 flex-1 sm:flex-none">
                <span className="sr-only">Compare with</span>
                <select
                  value={ui.compare === 'none' ? 'none' : ui.compare === 'defaults' ? 'defaults' : String(ui.compare.backupId)}
                  onChange={(e) => {
                    const v = e.target.value
                    const compare: CompareWith = v === 'none' ? 'none' : v === 'defaults' ? 'defaults' : { backupId: Number(v) }
                    ui.set({ compare, differsOnly: compare === 'none' ? false : ui.differsOnly })
                  }}
                  className="focus-ring h-10 w-full cursor-pointer appearance-none truncate rounded-lg border border-line bg-surface-2 pr-9 pl-3 text-sm sm:max-w-56"
                >
                  <option value="none">Compare: off</option>
                  <option value="defaults">Compare with defaults</option>
                  {(backups ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      Compare with backup: {new Date(b.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
              </label>
              {compareValues && (
                <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm">
                  <Toggle checked={ui.differsOnly} onChange={(v) => ui.set({ differsOnly: v })} label="Show only differences" />
                  Differences only
                </label>
              )}
            </div>

            {group && section && (
              <section ref={card} aria-label={`${kind === 'mcconf' ? 'Motor' : 'App'} settings`} className="card overflow-clip">
                {/* The tabs stay under the header while the settings scroll past. */}
                <div className="glass sticky top-[calc(3rem+env(safe-area-inset-top))] z-10 border-b border-line md:top-[calc(3.5rem+env(safe-area-inset-top))]">
                  <Tabs
                    label="Setting groups"
                    tabs={groups.map((g) => ({
                      id: g.name,
                      label: g.name,
                      count: g.sections.reduce((n, s) => n + changedIn(s.items), 0),
                      countLabel: 'changed',
                    }))}
                    value={listMode ? null : group.name}
                    onChange={showGroup}
                    tabId={groupTabId}
                    panelId={PANEL}
                    className="px-1.5 md:px-2.5"
                  />
                  {listMode ? (
                    <div className="flex min-h-12 items-center justify-between gap-3 border-t border-line/60 py-1.5 pr-2 pl-4 md:pl-5">
                      <p role="status" className="min-w-0 truncate text-[13px] text-muted">
                        {found === 0 ? 'Nothing to show' : resultsText(found, match ? ui.query.trim() : null, ui.changedOnly, compareLabel)}
                      </p>
                      <Button variant="ghost" className="h-8 shrink-0 px-2.5 text-xs" onClick={clearFilters}>
                        <X className="size-3.5" /> Clear
                      </Button>
                    </div>
                  ) : group.sections.length > 1 ? (
                    <Tabs
                      look="pill"
                      label={`${group.name} sections`}
                      tabs={group.sections.map((s) => ({ id: s.id, label: s.subgroup, count: changedIn(s.items), countLabel: 'changed' }))}
                      value={section.id}
                      onChange={show}
                      tabId={subTabId}
                      panelId={PANEL}
                      className="border-t border-line/60 px-2 py-2 md:px-3"
                    />
                  ) : null}
                </div>

                {listMode ? (
                  <div id={PANEL} aria-label="Search results">
                    {listSections.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-muted md:px-5">
                        {ui.changedOnly && !match ? 'No unsaved changes.' : 'Nothing matches. Try another word, or clear the filters.'}
                      </p>
                    ) : (
                      listSections.map(({ s, items }) => (
                        <div key={s.id}>
                          <h2 className="border-b border-line bg-surface-2/40 px-4 py-2 text-[13px] font-semibold md:px-5">
                            <span className="font-normal text-muted">{s.group} ›</span> {s.subgroup}
                          </h2>
                          {rows(items, false)}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div
                    key={section.id}
                    id={PANEL}
                    role="tabpanel"
                    aria-labelledby={group.sections.length > 1 ? subTabId(section.id) : groupTabId(group.name)}
                    className="page-in"
                  >
                    {showBattery && <BatteryHelper draft={draft} readOnly={readOnly} onApply={(patch) => cfg().edit(dev.key, kind, patch)} />}
                    {rows(section.items, true)}
                  </div>
                )}
              </section>
            )}

            <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 md:bottom-4">
              <div
                className={cx(
                  'glass flex flex-nowrap items-center gap-1.5 rounded-[var(--radius-card)] border border-line-strong p-1.5 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] md:gap-2 md:p-2',
                  pending > 0 && 'border-accent/40',
                )}
              >
                <Button variant="ghost" className="w-10 px-0" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!k.undo.length || readOnly} onClick={() => cfg().undo(dev.key, kind)}>
                  <Undo2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="w-10 px-0"
                  aria-label="Redo"
                  title="Redo (Ctrl+Shift+Z)"
                  disabled={!k.redo.length || readOnly}
                  onClick={() => cfg().redo(dev.key, kind)}
                >
                  <Redo2 className="size-4" />
                </Button>
                <span className="num min-w-0 flex-1 truncate px-1 text-sm text-muted">
                  {readOnly && k.status !== 'ready' ? (
                    'Read-only'
                  ) : pending ? (
                    <>
                      {pending} unsaved
                      <span className="max-md:hidden"> change{pending === 1 ? '' : 's'} · only in this app until you write</span>
                    </>
                  ) : (
                    <>
                      No <span className="max-sm:hidden">unsaved </span>changes
                    </>
                  )}
                </span>
                <Button
                  variant="ghost"
                  className="max-sm:w-10 max-sm:px-0"
                  aria-label="Discard"
                  disabled={!pending || readOnly}
                  onClick={() => cfg().discard(dev.key, kind)}
                  title="Throw away all edits (undo can bring them back)"
                >
                  <Eraser className="size-4" /> <span className="max-sm:hidden">Discard</span>
                </Button>
                <Button variant="primary" disabled={!pending || readOnly} onClick={() => setWriting(true)}>
                  <span className="max-sm:hidden">Review &amp; write</span>
                  <span className="sm:hidden">Write</span>
                  {pending ? `(${pending})` : ''}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {reviewOpen && <WriteDialog open onClose={closeReview} deviceKey={dev.key} kind={kind} />}
      <ImportDialog
        pending={pendingImport}
        defs={defs}
        draft={draft}
        onClose={() => setPendingImport(null)}
        onApply={(values) => cfg().edit(dev.key, kind, values)}
      />
    </>
  )
}
