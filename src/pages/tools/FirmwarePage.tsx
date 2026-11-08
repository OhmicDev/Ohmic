import { Link } from '@tanstack/react-router'
import { Check, CircleAlert, Cpu, FileUp, Loader2, TriangleAlert, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { firmwareFor, suggestedVersion, type ArchiveVersion } from '../../firmware/archive'
import { FirmwareFileError, prepareFirmware, type PreparedImage } from '../../firmware/image'
import { cx } from '../../lib/format'
import {
  archiveName,
  batteryProblem,
  cancelUpdate,
  clearUpdate,
  fileNamesHardware,
  planArchive,
  planBootloader,
  planFile,
  startUpdate,
  updateBlock,
  updateCandidates,
  useFirmware,
  type FwSource,
  type JobState,
  type PlannedJob,
  type UpdateCandidate,
} from '../../state/firmware'
import { useConfig } from '../../state/config'
import { useSession } from '../../state/session'
import { useTelemetry } from '../../state/telemetry'
import { Dialog } from '../../ui/Dialog'
import { BackLink, Badge, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { OfflineNote } from '../../ui/OfflineNote'

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString()} KB`

interface CustomFile {
  name: string
  bytes: Uint8Array
  prepared: PreparedImage | null
  error: string | null
}

export function FirmwarePage() {
  const connected = useSession((s) => s.status === 'connected')
  // Re-render when the devices or their settings change; the candidates come from both.
  useSession((s) => s.devices)
  useConfig((s) => s.devices)
  const running = useFirmware((s) => s.running)
  const jobs = useFirmware((s) => s.jobs)
  const candidates = updateCandidates()
  const [picked, setPicked] = useState<string[] | null>(null)
  const selected = candidates.filter((c) => (picked ?? candidates.map((x) => x.key)).includes(c.key))
  const [source, setSource] = useState<FwSource>('archive')
  const [version, setVersion] = useState<string | null>(null)
  const [file, setFile] = useState('VESC_default.bin')
  const [experts, setExperts] = useState(false)
  const [custom, setCustom] = useState<CustomFile | null>(null)
  const [confirming, setConfirming] = useState(false)
  useNow(1000) // checks (battery, motion) refresh with live data

  // Versions every selected controller has in the archive, newest first.
  const lists = selected.map((c) => firmwareFor(archiveName(c.fw.hwName)))
  const versions: ArchiveVersion[] = lists.length ? lists[0].filter((v) => lists.every((l) => l.some((x) => x.version === v.version))) : []
  const chosenVersion = versions.find((v) => v.version === version) ?? suggestedVersion(versions)
  const builds = (chosenVersion?.files ?? []).filter((f) => experts || !f.noHwLimits)
  const chosenFile = builds.find((f) => f.file === file) ?? builds[0] ?? null

  const plan: PlannedJob[] =
    source === 'archive'
      ? chosenVersion && chosenFile
        ? planArchive(selected, { version: chosenVersion.version, file: chosenFile.file })
        : []
      : source === 'file'
        ? custom?.prepared
          ? planFile(selected, custom.name)
          : []
        : planBootloader(selected)
  const block = running ? null : updateBlock(plan) ?? (source === 'file' && !custom?.prepared ? 'Choose a firmware file.' : null)
  const showProgress = jobs.length > 0

  const pickFile = async (f: File | undefined) => {
    if (!f) return
    const bytes = new Uint8Array(await f.arrayBuffer())
    try {
      setCustom({ name: f.name, bytes, prepared: prepareFirmware(bytes), error: null })
    } catch (e) {
      setCustom({ name: f.name, bytes, prepared: null, error: e instanceof FirmwareFileError ? e.message : String(e) })
    }
  }

  const go = () => {
    setConfirming(false)
    void startUpdate(plan, { source, file: custom?.bytes })
  }

  return (
    <>
      <BackLink to="/more">More</BackLink>
      <PageTitle
        title="Firmware"
        subtitle="See what each controller runs and update it from VESC’s official archive or your own file, one controller or all of them."
        actions={<DemoPark />}
      />
      <OfflineNote what="firmware" />

      {showProgress && <ProgressCard />}

      {!connected ? (
        <p className="card p-5 text-sm text-muted">Connect to see and update your controllers’ firmware.</p>
      ) : !candidates.length ? (
        <p className="card p-5 text-sm text-muted">No motor controller answered. Updating a VESC Express, BMS or other module needs VESC Tool for now.</p>
      ) : (
        !running && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <section className="card p-5" aria-label="Controllers">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Controllers</h2>
                  {candidates.length > 1 && (
                    <button className="focus-ring rounded text-xs text-accent hover:underline" onClick={() => setPicked(selected.length === candidates.length ? [] : candidates.map((c) => c.key))}>
                      {selected.length === candidates.length ? 'Select none' : 'Select all'}
                    </button>
                  )}
                </div>
                <ul className="space-y-2">
                  {candidates.map((c) => (
                    <ControllerRow
                      key={c.key}
                      c={c}
                      checked={selected.includes(c)}
                      onToggle={() => {
                        const keys = selected.map((x) => x.key)
                        setPicked(keys.includes(c.key) ? keys.filter((k) => k !== c.key) : [...keys, c.key])
                      }}
                    />
                  ))}
                </ul>
              </section>

              <section className="card space-y-4 p-5" aria-label="Firmware source">
                <Segmented<FwSource>
                  label="Firmware source"
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: 'archive', label: 'Official' },
                    { value: 'file', label: 'File' },
                    { value: 'bootloader', label: 'Bootloader' },
                  ]}
                />
                {source === 'archive' && (
                  <ArchivePicker
                    versions={versions}
                    chosen={chosenVersion}
                    onVersion={setVersion}
                    builds={builds}
                    chosenFile={chosenFile?.file ?? null}
                    onFile={setFile}
                    experts={experts}
                    onExperts={setExperts}
                  />
                )}
                {source === 'file' && <FilePicker custom={custom} onPick={pickFile} selected={selected} />}
                {source === 'bootloader' && (
                  <p className="text-sm text-muted">
                    Installs VESC Tool’s bootloader for each controller’s hardware. Normal updates don’t need this: use it when a controller won’t take new firmware (older
                    bootloaders can’t unpack the compressed 6.0 and newer images). The firmware it runs now stays.
                  </p>
                )}
              </section>
            </div>

            <section className="card h-fit space-y-4 p-5" aria-label="Update plan">
              <h2 className="text-sm font-semibold">What happens</h2>
              {plan.length ? (
                <ul className="space-y-2 text-sm">
                  {plan.map((j) => (
                    <li key={j.key} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                      <div className="font-medium">{j.name}</div>
                      <div className="num text-muted">
                        {j.from} → {j.to ?? j.label}
                        {j.to && <span className="ml-1.5 text-faint">{j.label.replace(/^[\d.]+ · /, '')}</span>}
                      </div>
                      {j.problem && <div className="mt-1 text-warn">{j.problem}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Pick a controller and what to install.</p>
              )}
              <ul className="space-y-1.5 text-sm text-muted">
                <li>• Settings are backed up first. A new version may reset them to defaults; you can restore them from Backups.</li>
                <li>• Controllers on CAN go first, the one on the cable last.</li>
                <li>• The current firmware keeps running until the new one is fully written and checked.</li>
              </ul>
              {block && <p className="text-sm text-warn">{block}</p>}
              <Button variant="primary" className="h-12 w-full" disabled={!!block || !plan.length} onClick={() => setConfirming(true)}>
                <Cpu className="size-4" /> {source === 'bootloader' ? 'Install bootloader' : `Update ${plan.length === 1 ? plan[0].name : `${plan.length} controllers`}`}
              </Button>
            </section>
          </div>
        )
      )}

      <ConfirmDialog open={confirming} plan={plan} source={source} custom={custom} onCancel={() => setConfirming(false)} onGo={go} />
    </>
  )
}

function ControllerRow({ c, checked, onToggle }: { c: UpdateCandidate; checked: boolean; onToggle: () => void }) {
  const newest = firmwareFor(archiveName(c.fw.hwName))[0]?.version ?? null
  useTelemetry((s) => s.devices[c.key]?.vIn)
  const battery = batteryProblem(c)
  const v = useTelemetry.getState().devices[c.key]?.vIn
  return (
    <li>
      <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5', checked ? 'border-accent/40 bg-accent/5' : 'border-line')}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 size-4 accent-[var(--accent)]" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {c.name}
            {newest && newest !== c.version ? <Badge tone="accent">{newest} available</Badge> : newest ? <Badge>Up to date</Badge> : <Badge tone="warn">Not in archive</Badge>}
          </span>
          <span className="num mt-0.5 block text-muted">
            Firmware {c.version} · {c.fw.hwName}
            {v !== undefined && ` · ${v.toFixed(1)} V`}
          </span>
          {battery && <span className="mt-0.5 block text-warn">{battery}</span>}
        </span>
      </label>
    </li>
  )
}

function ArchivePicker({
  versions,
  chosen,
  onVersion,
  builds,
  chosenFile,
  onFile,
  experts,
  onExperts,
}: {
  versions: ArchiveVersion[]
  chosen: ArchiveVersion | null
  onVersion: (v: string) => void
  builds: ArchiveVersion['files']
  chosenFile: string | null
  onFile: (f: string) => void
  experts: boolean
  onExperts: (on: boolean) => void
}) {
  if (!versions.length) return <p className="text-sm text-warn">The archive has no firmware for every selected controller’s hardware. Select fewer, or use a file.</p>
  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-1.5">Version</div>
        <div role="radiogroup" aria-label="Version" className="flex flex-wrap gap-1.5">
          {versions.map((v, i) => (
            <button
              key={v.version}
              role="radio"
              aria-checked={chosen?.version === v.version}
              onClick={() => onVersion(v.version)}
              className={cx(
                'focus-ring num h-9 rounded-lg border px-3 text-sm',
                chosen?.version === v.version ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text',
              )}
            >
              {v.version}
              {i === 0 && <span className="ml-1 text-[11px] text-faint">newest</span>}
            </button>
          ))}
        </div>
        {chosen && !chosen.configurable && (
          <p className="mt-2 text-sm text-warn">Ohmic can’t edit settings on {chosen.version} yet: they’ll show read-only until it can. Pick an older version to keep editing.</p>
        )}
      </div>
      <div>
        <div className="label mb-1.5">Build</div>
        <div role="radiogroup" aria-label="Build" className="flex flex-wrap gap-1.5">
          {builds.map((f) => (
            <button
              key={f.file}
              role="radio"
              aria-checked={chosenFile === f.file}
              onClick={() => onFile(f.file)}
              className={cx(
                'focus-ring h-9 rounded-lg border px-3 text-sm',
                chosenFile === f.file ? (f.noHwLimits ? 'border-danger/50 bg-danger/10' : 'border-accent/50 bg-accent/10') : 'border-line-strong text-muted hover:text-text',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Toggle checked={experts} onChange={onExperts} label="Show builds for experts" />
          Show builds for experts (no hardware limits)
        </label>
      </div>
    </div>
  )
}

function FilePicker({ custom, onPick, selected }: { custom: CustomFile | null; onPick: (f: File | undefined) => void; selected: UpdateCandidate[] }) {
  return (
    <div className="space-y-3">
      <label className="focus-within:ring-accent flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-4 text-sm hover:border-text/25">
        <FileUp className="size-5 text-accent" />
        <span className="flex-1">
          <span className="block font-medium">{custom ? custom.name : 'Choose a .bin file'}</span>
          <span className="block text-muted">{custom ? kb(custom.bytes.length) : 'Firmware for a VESC motor controller'}</span>
        </span>
        <input type="file" accept=".bin,application/octet-stream" className="sr-only" onChange={(e) => onPick(e.target.files?.[0])} />
      </label>
      {custom?.error && <p className="text-sm text-warn">{custom.error}</p>}
      {custom?.prepared && (
        <>
          <p className="text-sm text-muted">
            {kb(custom.prepared.image.length)} image{custom.prepared.compressed && `, compressed to ${kb(custom.prepared.uploadBytes)} for the bootloader`}. A file doesn’t say its version, so
            Ohmic checks what the controller reports afterwards.
          </p>
          <ul className="space-y-1 text-sm">
            {selected.map((c) => {
              const named = fileNamesHardware(custom.prepared!, c.fw.hwName)
              return (
                <li key={c.key} className={cx('flex items-start gap-1.5', named ? 'text-muted' : 'text-warn')}>
                  {named ? <Check className="mt-0.5 size-4 shrink-0 text-ok" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
                  {named ? `Mentions ${c.fw.hwName}, the hardware of ${c.name}.` : `Doesn’t mention ${c.fw.hwName}. It may be for other hardware: firmware for the wrong board can damage it.`}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function ConfirmDialog({
  open,
  plan,
  source,
  custom,
  onCancel,
  onGo,
}: {
  open: boolean
  plan: PlannedJob[]
  source: FwSource
  custom: CustomFile | null
  onCancel: () => void
  onGo: () => void
}) {
  const [stay, setStay] = useState(false)
  const [limits, setLimits] = useState(false)
  const [wrongHw, setWrongHw] = useState(false)
  const noLimits = plan.some((j) => j.noHwLimits)
  const unmatched = source === 'file' && custom?.prepared ? plan.filter((j) => !fileNamesHardware(custom.prepared!, j.hwName)) : []
  const ready = stay && (!noLimits || limits) && (!unmatched.length || wrongHw)
  const close = () => {
    setStay(false)
    setLimits(false)
    setWrongHw(false)
    onCancel()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title={source === 'bootloader' ? 'Install the bootloader?' : 'Update firmware?'}
      subtitle={plan.map((j) => `${j.name}: ${j.from} → ${j.to ?? j.label}`).join(' · ')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={noLimits ? 'danger' : 'primary'}
            disabled={!ready}
            onClick={() => {
              setStay(false)
              setLimits(false)
              setWrongHw(false)
              onGo()
            }}
          >
            Start update
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-5 text-sm">
        <Tick checked={stay} onChange={setStay}>
          I’ll keep the battery on and the cable or Bluetooth connected, and keep this page open, until it says it’s done.
        </Tick>
        {noLimits && (
          <Tick checked={limits} onChange={setLimits} danger>
            I understand the “no hardware limits” build removes this hardware’s own current and voltage protection. Settings beyond what the board can take can destroy it,
            and it’s for experts who know their hardware.
          </Tick>
        )}
        {unmatched.length > 0 && (
          <Tick checked={wrongHw} onChange={setWrongHw} danger>
            I’m sure this file is for {unmatched.map((j) => j.hwName).join(' and ')}, even though it doesn’t mention it.
          </Tick>
        )}
      </div>
    </Dialog>
  )
}

function Tick({ checked, onChange, danger, children }: { checked: boolean; onChange: (v: boolean) => void; danger?: boolean; children: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3', danger ? 'border-danger/40 bg-danger/5' : 'border-line')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span>{children}</span>
    </label>
  )
}

const PHASE_LABEL: Record<JobState['phase'], string> = {
  waiting: 'Waiting',
  downloading: 'Getting the firmware',
  'backing-up': 'Backing up settings',
  erasing: 'Erasing the update area',
  writing: 'Writing',
  restarting: 'Restarting into the new firmware',
  verifying: 'Checking',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Not changed',
}

function ProgressCard() {
  const { running, cancelling, jobs, error } = useFirmware()
  const anyReset = jobs.some((j) => j.settingsReset)
  return (
    <section className="card mb-4 space-y-3 p-5" aria-label="Update progress" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {running ? <Loader2 className="size-4 animate-spin text-accent" /> : error ? <CircleAlert className="size-4 text-warn" /> : <Check className="size-4 text-ok" />}
          {running ? 'Updating: don’t disconnect or switch off' : error ? 'Update stopped' : 'Update finished'}
        </h2>
        {running ? (
          <Button variant="ghost" className="h-9" disabled={cancelling} onClick={cancelUpdate}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : (
          <Button variant="ghost" className="h-9" onClick={clearUpdate}>
            <X className="size-4" /> Close
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {jobs.map((j) => (
          <li key={j.key} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{j.name}</span>
              <span className={cx('text-xs', j.phase === 'failed' ? 'text-danger' : j.phase === 'done' ? 'text-ok' : 'text-muted')}>
                {j.phase === 'done' && j.after ? `Now on ${j.after}` : PHASE_LABEL[j.phase]}
                {j.phase === 'writing' && ` ${Math.round(j.progress * 100)} %`}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.progress * 100)} aria-label={`${j.name} progress`}>
              <div className={cx('h-full rounded-full transition-[width]', j.phase === 'failed' ? 'bg-danger' : 'bg-accent')} style={{ width: `${Math.round(j.progress * 100)}%` }} />
            </div>
            <div className="num mt-1 text-xs text-faint">
              {j.from} → {j.to ?? j.label}
              {j.uploadBytes > 0 && ` · ${kb(j.uploadBytes)}${j.compressed ? ' compressed' : ''}`}
              {j.backups.length > 0 && ' · settings backed up'}
            </div>
            {j.error && <p className="mt-1.5 text-sm text-warn">{j.error}</p>}
          </li>
        ))}
      </ul>
      {error && !jobs.some((j) => j.error && error.endsWith(j.error)) && <p className="text-sm text-warn">{error}</p>}
      {!running && anyReset && (
        <p className="text-sm text-muted">
          The new version stores settings differently, so they may be back to defaults. Check them before riding, and restore yours from{' '}
          <Link to="/config/backups" className="text-accent hover:underline">
            Backups
          </Link>{' '}
          if needed (they were saved just before the update).
        </p>
      )}
    </section>
  )
}
