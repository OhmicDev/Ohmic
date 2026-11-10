import { Link } from '@tanstack/react-router'
import { Boxes, FileUp, Library, MonitorSmartphone, PackageCheck, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { sameOnWire } from '../../config/codec'
import { SEPARATOR, type ConfigValue } from '../../config/types'
import { validateConfig, type Issue } from '../../config/validate'
import { type WriteItem } from '../../config/write'
import { pickFiles } from '../../lib/files'
import { cx } from '../../lib/format'
import { demoPackages } from '../../packages/demoPackages'
import { richTextToPlain } from '../../packages/vescpkg'
import { customKey, useCustomConfig, type CustomConfig } from '../../state/customConfig'
import { deviceKey } from '../../state/config'
import { targetKey, targetLabel, type DeviceInfo } from '../../state/devices'
import { scriptMotionBlock, scriptSupport } from '../../state/lisp'
import { usePackages, type PackageEntry } from '../../state/packages'
import { useSession } from '../../state/session'
import { Dialog } from '../../ui/Dialog'
import { Markdown } from '../../ui/Markdown'
import { Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { ParamRow } from '../config/ParamRow'
import { WriteDialog } from '../config/WriteDialog'
import { pickTarget } from './pickTarget'
import { TargetPicker } from './TargetPicker'
import { BackToMore, Banner, Progress } from './ToolBits'

type Filter = 'all' | 'packages' | 'libraries'

const summary = (e: PackageEntry) => {
  const plain = richTextToPlain(e.pkg.description || '').trim()
  if (plain) return plain.split('\n')[0]
  const md = (e.pkg.descriptionMd || '').split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('!'))
  return md?.replace(/[*_`[\]]/g, '').trim() ?? ''
}

export function PackagesPage() {
  const p = usePackages()
  const devices = useSession((x) => x.devices)
  const connected = useSession((x) => x.status === 'connected')
  const isDemo = useSession((x) => x.transportKind === 'mock')
  const [target, setTarget] = useState('local')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('packages')
  const [details, setDetails] = useState<PackageEntry | null>(null)
  const [confirmInstall, setConfirmInstall] = useState<PackageEntry | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  useNow(1000) // keeps the "moving" check current

  const capable = devices.filter((d) => (d.fw?.major ?? 0) >= 6)
  const info = pickTarget(capable, target)
  const key = info ? targetKey(info.target) : 'local'
  const support = scriptSupport(info?.fw)
  const motion = connected ? scriptMotionBlock(devices, 'install or remove packages') : null
  const installed = p.installed[key]
  const all = useMemo(() => [...p.demo, ...p.files, ...p.archive.entries], [p.demo, p.files, p.archive.entries])
  const installedEntry = installed?.matchId ? all.find((e) => e.id === installed.matchId) : undefined
  const canChange = connected && !!info && support.ok && !motion && !p.busy

  useEffect(() => {
    if (usePackages.getState().archive.status === 'idle') void usePackages.getState().loadArchive()
  }, [])
  useEffect(() => usePackages.getState().setDemo(isDemo ? demoPackages() : []), [isDemo])
  useEffect(() => {
    if (connected && info) void usePackages.getState().checkInstalled(info.target)
  }, [connected, info?.target, info?.fw?.customConfigCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((e) => {
      if (filter === 'packages' && e.pkg.isLibrary) return false
      if (filter === 'libraries' && !e.pkg.isLibrary) return false
      return !q || e.pkg.name.toLowerCase().includes(q) || summary(e).toLowerCase().includes(q)
    })
  }, [all, query, filter])

  const openFile = async () => {
    const [f] = await pickFiles('.vescpkg')
    if (!f) return
    const entry = await p.openFile(f)
    if (entry) setDetails(entry)
  }

  return (
    <>
      <BackToMore />
      <PageTitle
        title="Packages"
        subtitle="Add features to a controller, from the VESC archive or a file."
        actions={
          <Button variant="ghost" onClick={() => void openFile()}>
            <FileUp className="size-4" /> Open .vescpkg
          </Button>
        }
      />

      <div className="mb-3">
        <TargetPicker devices={capable} value={key} onChange={setTarget} label="Package on" />
      </div>

      {!connected && <Banner tone="info">Connect to a controller to see what’s installed and to install packages. You can browse without one.</Banner>}
      {connected && !support.ok && <Banner tone="warn">{support.reason}</Banner>}
      {motion && connected && support.ok && <Banner tone="warn" action={isDemo ? <DemoPark /> : undefined}>{motion}</Banner>}
      {p.error && (
        <Banner tone="danger" onClose={p.dismiss}>
          {p.error}
        </Banner>
      )}
      {p.notice && !p.error && (
        <Banner tone="ok" onClose={p.dismiss}>
          {p.notice}
        </Banner>
      )}
      {p.busy && (
        <div className="card mb-3 p-4">
          <Progress what={p.busy.what} progress={p.busy.progress} />
        </div>
      )}

      {connected && info && (
        <section className="card mb-4 p-4" aria-label="Installed package">
          <div className="flex flex-wrap items-start gap-3">
            <PackageCheck className="mt-0.5 size-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                {!installed
                  ? 'Checking what’s installed…'
                  : installed.error
                    ? 'Couldn’t check what’s installed'
                    : installedEntry
                      ? installedEntry.pkg.name
                      : installed.program
                        ? 'A script not from a listed package'
                        : 'No package installed'}
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {installed?.error ??
                  (installedEntry
                    ? `Installed on ${targetLabel(info.target)}.`
                    : installed?.program
                      ? 'It may be your own script, or a package version that isn’t in the archive. See it in LispBM scripts.'
                      : installed
                        ? `${targetLabel(info.target)} runs no package script.`
                        : '')}
              </p>
              {installed?.hasQml && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                  <MonitorSmartphone className="mt-0.5 size-3.5 shrink-0" />
                  This package has its own screen made for VESC Tool (QML), which can’t run in a browser. The script works either way, and its settings are
                  below when it has any.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {installed?.program && !installedEntry && (
                <Link to="/lisp" className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted hover:bg-surface-3 hover:text-text">
                  Open script
                </Link>
              )}
              <Button variant="ghost" className="h-9" onClick={() => void p.checkInstalled(info.target)} disabled={!!p.busy} aria-label="Check again">
                <RefreshCw className="size-4" />
              </Button>
              {(installed?.program || installed?.hasQml) && (
                <Button variant="danger" className="h-9" disabled={!canChange} onClick={() => setConfirmRemove(true)}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {connected && info && (info.fw?.customConfigCount ?? 0) > 0 && (
        <div className="mb-4 space-y-4">
          {Array.from({ length: info.fw!.customConfigCount }, (_, i) => (
            <CustomConfigPanel key={`${deviceKey(info)}#${i}`} info={info} index={i} />
          ))}
        </div>
      )}

      <section aria-label="Package archive">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search packages"
              aria-label="Search packages"
              className="focus-ring h-10 w-full rounded-xl border border-line-strong bg-surface-2 pr-3 pl-9 text-sm placeholder:text-faint"
            />
          </div>
          <Segmented<Filter>
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'packages', label: 'Packages' },
              { value: 'libraries', label: 'Libraries' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>

        {p.archive.status === 'loading' && (
          <div className="card mb-3 p-4">
            <Progress what="Loading the package archive" progress={null} />
          </div>
        )}
        {p.archive.status === 'error' && (
          <Banner
            tone="warn"
            action={
              <Button variant="ghost" className="-my-1 h-8 px-2 text-xs" onClick={() => void p.loadArchive()}>
                <RefreshCw className="size-3.5" /> Try again
              </Button>
            }
          >
            {p.archive.error}
          </Banner>
        )}

        {listed.length === 0 && p.archive.status !== 'loading' ? (
          <p className="card p-6 text-center text-sm text-muted">{query ? 'No packages match.' : 'No packages to show yet.'}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {listed.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setDetails(e)}
                  className="card focus-ring flex h-full w-full flex-col gap-1.5 p-4 text-left transition-colors hover:border-line-strong"
                >
                  <span className="flex items-center gap-2">
                    {e.pkg.isLibrary ? <Library className="size-4 shrink-0 text-muted" /> : <Boxes className="size-4 shrink-0 text-accent" />}
                    <span className="min-w-0 flex-1 truncate font-semibold">{e.pkg.name}</span>
                  </span>
                  <span className="line-clamp-2 text-sm text-muted">{summary(e) || 'No description.'}</span>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {installed?.matchId === e.id && <Badge tone="accent">Installed</Badge>}
                    {e.source === 'demo' && <Badge tone="warn">Demo</Badge>}
                    {e.source === 'file' && <Badge>From file</Badge>}
                    {e.pkg.isLibrary && <Badge>Library</Badge>}
                    {e.pkg.qmlFile && <Badge>VESC Tool screen</Badge>}
                    {!e.pkg.lispData && !e.pkg.isLibrary && <Badge>No script</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {p.archive.status === 'ready' && (
          <p className="mt-3 text-xs text-faint">
            {p.archive.entries.length} packages from the VESC package archive (vesc-project.com), fetched {new Date(p.archive.fetchedAt!).toLocaleTimeString()}.
          </p>
        )}
      </section>

      <Dialog
        open={!!details}
        onClose={() => setDetails(null)}
        title={details?.pkg.name ?? ''}
        subtitle={details ? (details.pkg.isLibrary ? 'Library' : details.source === 'demo' ? 'Demo package, made up for the simulator' : details.source === 'file' ? 'From a file' : 'From the VESC package archive') : undefined}
        footer={
          details && (
            <>
              <Button variant="ghost" onClick={() => setDetails(null)}>
                Close
              </Button>
              {!details.pkg.isLibrary && (
                <Button
                  variant="primary"
                  disabled={!canChange}
                  onClick={() => {
                    setConfirmInstall(details)
                    setDetails(null)
                  }}
                >
                  {installed?.matchId === details.id ? 'Reinstall' : 'Install'}
                  {info && capable.length > 1 ? ` on ${targetLabel(info.target)}` : ''}
                </Button>
              )}
            </>
          )
        }
      >
        {details && <PackageDetails entry={details} connected={connected} />}
      </Dialog>

      <Dialog
        open={!!confirmInstall}
        onClose={() => setConfirmInstall(null)}
        size="sm"
        title={`Install ${confirmInstall?.pkg.name ?? ''}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmInstall(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const e = confirmInstall
                setConfirmInstall(null)
                if (e && info) void p.install(e, info.target)
              }}
            >
              Install
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-muted">
          <p>
            {info ? targetLabel(info.target) : 'The controller'} gets this package’s script{confirmInstall?.pkg.qmlFile ? ' and its VESC Tool screen' : ''}, and starts it straight
            away. It replaces any script or package that’s there now.
          </p>
          {installed?.program && !installedEntry && <p className="text-warn">The script on it now isn’t from a listed package. Save it from LispBM scripts first if you need it.</p>}
          <p>A package can control the motor. Only install packages you trust, and try a new one with the wheel off the ground.</p>
        </div>
      </Dialog>

      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        size="sm"
        title="Remove the package?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmRemove(false)
                if (info) void p.remove(info.target)
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">The script{installed?.hasQml ? ' and its screen' : ''} are erased from {info ? targetLabel(info.target) : 'the controller'}. Its settings go with it.</p>
      </Dialog>
    </>
  )
}

function PackageDetails({ entry, connected }: { entry: PackageEntry; connected: boolean }) {
  const { pkg } = entry
  const plain = pkg.descriptionMd ? null : richTextToPlain(pkg.description || '')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {pkg.lispData && <Badge>Script · {(pkg.lispData.length / 1024).toFixed(1)} KB</Badge>}
        {pkg.qmlFile && <Badge>VESC Tool screen</Badge>}
        {pkg.qmlFullscreen && <Badge>Full screen</Badge>}
      </div>
      {pkg.descriptionMd ? (
        <Markdown source={pkg.descriptionMd} />
      ) : plain ? (
        <div className="space-y-2 text-sm leading-relaxed whitespace-pre-line text-muted">{plain}</div>
      ) : (
        <p className="text-sm text-muted">No description.</p>
      )}
      {pkg.isLibrary && (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
          Libraries hold code other packages import. They aren’t installed on their own: a package that needs one includes it.
        </p>
      )}
      {pkg.qmlFile && !pkg.isLibrary && (
        <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
          Its screen is written for VESC Tool and can’t be shown in a browser. Ohmic still installs it, so VESC Tool shows it, and shows the package’s settings
          as a normal settings page.
        </p>
      )}
      {!connected && <p className="text-xs text-faint">Connect to install.</p>}
    </div>
  )
}

function CustomConfigPanel({ info, index }: { info: DeviceInfo; index: number }) {
  const key = customKey(deviceKey(info), index)
  const c = useCustomConfig((s) => s.configs[key]) as CustomConfig | undefined
  const [writing, setWriting] = useState<WriteItem[] | null>(null)

  useEffect(() => {
    if (!useCustomConfig.getState().configs[key]) void useCustomConfig.getState().load(info.target, index)
  }, [key, info.target, index])

  const onCommit = useCallback((name: string, value: ConfigValue) => useCustomConfig.getState().edit(key, name, value), [key])
  const issues = useMemo(() => {
    const m = new Map<string, Issue[]>()
    if (c?.defs && c.draft) for (const i of validateConfig(c.defs, c.draft, { base: c.device ?? undefined })) m.set(i.param, [...(m.get(i.param) ?? []), i])
    return m
  }, [c])

  if (!c) return null
  const { defs, draft, device } = c
  const changed = defs && draft && device ? defs.order.filter((n) => !sameOnWire(defs.params[n], draft[n], device[n])).length : 0
  const errors = [...issues.values()].flat().filter((i) => i.level === 'error').length

  return (
    <section className="card overflow-hidden" aria-label={`${c.name} settings`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{c.name}</h2>
          <p className="text-xs text-muted">Settings the installed package adds{c.readOnly ? ' · read only on this firmware' : ''}</p>
        </div>
        {c.status === 'ready' && (
          <>
            <Button variant="ghost" className="h-9" disabled={!changed} onClick={() => useCustomConfig.getState().discard(key)}>
              Undo edits
            </Button>
            <Button
              variant="primary"
              className="h-9"
              disabled={!changed || errors > 0}
              title={errors ? 'Fix the values marked in red first' : undefined}
              onClick={() => {
                const item = useCustomConfig.getState().writeItem(key)
                if (item) setWriting([item])
              }}
            >
              Write{changed ? ` ${changed}` : ''}
            </Button>
          </>
        )}
        <Button variant="ghost" className="h-9" aria-label="Read again" disabled={c.status === 'loading'} onClick={() => void useCustomConfig.getState().load(info.target, index)}>
          <RefreshCw className={cx('size-4', c.status === 'loading' && 'animate-spin')} />
        </Button>
      </div>
      {c.status === 'loading' && !defs && (
        <div className="p-4">
          <Progress what="Reading the package’s settings" progress={null} />
        </div>
      )}
      {c.status === 'error' && <p className="p-4 text-sm text-danger">{c.error}</p>}
      {defs && draft &&
        defs.groups.map((g) =>
          g.subgroups.map((sg) => (
            <div key={`${g.name}/${sg.name}`}>
              {(defs.groups.length > 1 || g.subgroups.length > 1) && (
                <div className="label border-b border-line bg-surface-2/40 px-4 py-2 text-[9.5px] md:px-5">
                  {g.name} · {sg.name}
                </div>
              )}
              {sg.items.map((name) => {
                if (name.startsWith(SEPARATOR)) {
                  const label = name.slice(SEPARATOR.length)
                  return label ? (
                    <div key={name} className="label border-b border-line bg-surface-2/40 px-4 py-2 text-[9.5px] md:px-5">
                      {label}
                    </div>
                  ) : null
                }
                const pd = defs.params[name]
                if (!pd) return null
                return (
                  <ParamRow
                    key={name}
                    p={pd}
                    value={draft[name]}
                    device={device?.[name]}
                    defaultValue={c.defaults?.[name]}
                    readOnly={c.readOnly}
                    issues={issues.get(name)}
                    onCommit={onCommit}
                  />
                )
              })}
            </div>
          )),
        )}
      <WriteDialog open={!!writing} onClose={() => setWriting(null)} fixedItems={writing ?? undefined} />
    </section>
  )
}
