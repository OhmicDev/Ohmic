import { CircleAlert, Download, Eraser, FileUp, Play, Square, Trash2, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { downloadText, pickFiles, safeFileName } from '../../lib/files'
import { cx, fmt } from '../../lib/format'
import { bracketProblem } from '../../lib/lispHighlight'
import { LISP_EXAMPLES } from '../../onboard/lispExamples'
import { lispStorageBlob, packLispProgram } from '../../protocol/lisp'
import { deviceKey } from '../../state/config'
import { targetKey, targetLabel } from '../../state/devices'
import { loadLispDraft, maxScriptBytes, scriptMotionBlock, scriptSupport, useLisp, type ConsoleLine } from '../../state/lisp'
import { useAbs, useRegen } from '../../state/onboard'
import { useSession } from '../../state/session'
import { CodeEditor } from '../../ui/CodeEditor'
import { Dialog } from '../../ui/Dialog'
import { Badge, Button, PageTitle } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { DemoPark } from '../config/LiveStrip'
import { pickTarget } from './pickTarget'
import { TargetPicker } from './TargetPicker'
import { BackToMore, Banner, Progress } from './ToolBits'

export function LispPage() {
  const s = useLisp()
  const devices = useSession((x) => x.devices)
  const connected = useSession((x) => x.status === 'connected')
  const isDemo = useSession((x) => x.transportKind === 'mock')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmLoad, setConfirmLoad] = useState<{ title: string; code: string; fileName: string | null } | null>(null)
  const absOn = useAbs((x) => x.status)
  const regenOn = useRegen((x) => x.status)
  const now = useNow(1000)

  useEffect(() => void loadLispDraft(), [])

  const capable = devices.filter((d) => scriptSupport(d.fw).ok || (d.fw?.major ?? 0) >= 6)
  const info = pickTarget(capable, s.target)
  const key = info ? targetKey(info.target) : 'local'
  useEffect(() => {
    if (info && key !== s.target) s.setTarget(key)
  }, [info, key, s])

  // Stats once a second while the page is open.
  useEffect(() => {
    if (!connected) return
    const t = setInterval(() => void useLisp.getState().pollStats(), 1000)
    void useLisp.getState().pollStats()
    return () => clearInterval(t)
  }, [connected, key])

  const support = scriptSupport(info?.fw)
  const motion = connected ? scriptMotionBlock(devices, 'upload or start a script') : null
  void now // re-check the motion block once a second
  const stats = s.stats[key]
  const bytes = useMemo(() => lispStorageBlob(packLispProgram(s.code)).length, [s.code])
  const max = maxScriptBytes(info?.fw)
  const brackets = useMemo(() => (s.code.length < 200_000 ? bracketProblem(s.code) : null), [s.code])
  const dk = info ? deviceKey(info) : ''
  const onboardOn = (absOn[dk]?.on ?? false) || (regenOn[dk]?.on ?? false)
  const busy = !!s.busy
  const canWrite = connected && !!info && support.ok && !motion && !busy

  const load = (code: string, fileName: string | null, title: string) => {
    if (s.dirty && s.code.trim() && s.code !== code) setConfirmLoad({ title, code, fileName })
    else s.setCode(code, { fileName, clean: true })
  }

  const openFile = async () => {
    const [f] = await pickFiles('.lisp,.lbm,.txt,text/plain')
    if (!f) return
    load(await f.text(), f.name, `Open ${f.name}?`)
  }

  const readBack = async () => {
    const code = await s.readBack()
    if (code) load(code, `${safeFileName(info?.fw?.hwName || 'controller')}.lisp`, `Replace the editor with the script from ${targetLabel(info!.target)}?`)
  }

  return (
    <>
      <BackToMore />
      <PageTitle
        title="LispBM scripts"
        subtitle="Scripts run on the controller itself, even when the app is closed. Write or open one, upload it, and watch what it prints."
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TargetPicker devices={capable} value={key} onChange={s.setTarget} label="Script on" />
        {connected && info && <EngineChip running={stats?.running ?? null} />}
      </div>

      {!connected && (
        <p className="card mb-3 p-4 text-sm text-muted">
          Connect to a controller to upload, run and read scripts. You can write and save scripts without one.
        </p>
      )}
      {connected && !support.ok && <Banner tone="warn">{support.reason}</Banner>}
      {connected && onboardOn && (
        <Banner tone="warn">
          ABS or regen is on for this controller. They run in the same script engine, so uploading, starting or stopping a script turns them off. Turn them
          back on afterwards from Ride.
        </Banner>
      )}
      {motion && connected && support.ok && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          <span className="min-w-0 flex-1">{motion}</span>
          {isDemo && <DemoPark />}
        </div>
      )}
      {s.error && (
        <Banner tone="danger" onClose={s.dismiss}>
          {s.error}
        </Banner>
      )}
      {s.notice && !s.error && (
        <Banner tone="ok" onClose={s.dismiss}>
          {s.notice}
        </Banner>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="card overflow-hidden" aria-label="Script editor">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <label className="sr-only" htmlFor="lisp-example">
              Examples
            </label>
            <select
              id="lisp-example"
              value=""
              onChange={(e) => {
                const ex = LISP_EXAMPLES.find((x) => x.id === e.target.value)
                if (ex) load(ex.code, `${ex.id}.lisp`, `Replace the editor with “${ex.title}”?`)
              }}
              className="focus-ring h-9 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-sm text-text"
            >
              <option value="">Examples…</option>
              {LISP_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title}
                </option>
              ))}
            </select>
            <Button variant="ghost" className="h-9 px-2.5" onClick={() => void openFile()}>
              <FileUp className="size-4" /> Open
            </Button>
            <Button variant="ghost" className="h-9 px-2.5" onClick={() => downloadText(s.fileName || 'script.lisp', s.code, 'text/plain')}>
              <Download className="size-4" /> Save
            </Button>
            <Button variant="ghost" className="h-9 px-2.5" disabled={!connected || !info || busy} onClick={() => void readBack()}>
              Read from controller
            </Button>
            <span className="ml-auto truncate text-xs text-faint">
              {s.fileName ?? 'Untitled'}
              {s.dirty ? ' · edited' : ''}
            </span>
          </div>

          <CodeEditor value={s.code} onChange={(v) => s.setCode(v)} onSubmit={() => canWrite && void s.upload()} label="LispBM script" errorLine={brackets?.line ?? null} />

          <div className="space-y-2.5 border-t border-line px-3 py-3">
            {s.busy && <Progress what={s.busy.what} progress={s.busy.progress} />}
            {brackets && (
              <p className="flex items-start gap-1.5 text-xs text-warn">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> Line {brackets.line}: {brackets.message}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" className="h-9" disabled={!canWrite} onClick={() => void s.upload()}>
                <Upload className="size-4" /> Upload and run
              </Button>
              <Button className="h-9" disabled={!canWrite} onClick={() => void s.setRunning(true)}>
                <Play className="size-4" /> Run stored
              </Button>
              <Button className="h-9" disabled={!connected || !info || busy} onClick={() => void s.setRunning(false)}>
                <Square className="size-4" /> Stop
              </Button>
              <Button variant="ghost" className="h-9" disabled={!canWrite} onClick={() => setConfirmRemove(true)}>
                <Trash2 className="size-4" /> Remove from controller
              </Button>
              <span className={cx('num ml-auto text-xs', bytes > max ? 'text-danger' : 'text-faint')}>
                {fmt(bytes / 1024, 1)} of {fmt(max / 1024, 0)} KB
              </span>
            </div>
          </div>
        </section>

        <div className="space-y-4">
          <Console lines={s.lines} showOhmic={s.showOhmic} target={key} multi={capable.length > 1} connected={connected} />
          <StatsPanel entry={stats} />
        </div>
      </div>

      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        size="sm"
        title="Remove the stored script?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmRemove(false)
                void s.removeStored()
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {info ? targetLabel(info.target) : 'The controller'} stops its script and erases it. If it came from a package, the package stops working until you
          install it again. Save a copy first if you need it (Read from controller, then Save).
        </p>
      </Dialog>

      <Dialog
        open={!!confirmLoad}
        onClose={() => setConfirmLoad(null)}
        size="sm"
        title={confirmLoad?.title ?? ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmLoad(null)}>
              Keep editing
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirmLoad) s.setCode(confirmLoad.code, { fileName: confirmLoad.fileName, clean: true })
                setConfirmLoad(null)
              }}
            >
              Replace
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">The editor has changes that weren’t uploaded or saved. They’ll be replaced.</p>
      </Dialog>
    </>
  )
}

function EngineChip({ running }: { running: boolean | null }) {
  const [text, cls] =
    running === true
      ? ['Script running', 'border-ok/40 text-ok']
      : running === false
        ? ['No script running', 'border-line-strong text-muted']
        : ['Checking…', 'border-line-strong text-faint']
  return (
    <span className={cx('label inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px]', cls)} role="status">
      {running && <span className="live-dot size-1.5 rounded-full bg-ok" style={{ '--pulse-color': 'var(--color-ok)' } as React.CSSProperties} />}
      {text}
    </span>
  )
}

function Console({ lines, showOhmic, target, multi, connected }: { lines: ConsoleLine[]; showOhmic: boolean; target: string; multi: boolean; connected: boolean }) {
  const s = useLisp.getState
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hist, setHist] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const shown = showOhmic ? lines : lines.filter((l) => l.kind !== 'ohmic')
  const hidden = lines.length - shown.length

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown.length])

  const send = () => {
    const line = input.trim()
    if (!line) return
    void s().repl(line)
    setHistory((h) => [...h.filter((x) => x !== line), line].slice(-50))
    setHist(null)
    setInput('')
    stick.current = true
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.length) {
      e.preventDefault()
      const up = e.key === 'ArrowUp'
      const next = hist === null ? (up ? history.length - 1 : null) : up ? Math.max(0, hist - 1) : hist + 1
      if (next === null || next >= history.length) {
        setHist(null)
        setInput('')
      } else {
        setHist(next)
        setInput(history[next])
      }
    }
  }

  return (
    <section className="card overflow-hidden" aria-label="Console">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="label">Console</h2>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showOhmic} onChange={(e) => s().setShowOhmic(e.target.checked)} className="accent-[var(--accent)]" />
          Show Ohmic’s own{hidden > 0 && !showOhmic ? ` (${hidden})` : ''}
        </label>
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={s().clearConsole} disabled={!lines.length}>
          <Eraser className="size-3.5" /> Clear
        </Button>
      </div>
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="code-surface h-64 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed"
      >
        {shown.length === 0 ? (
          <p className="text-faint">{connected ? 'What scripts print shows here. Type an expression below to run it, e.g. (get-vin).' : 'Not connected.'}</p>
        ) : (
          shown.map((l) => (
            <div
              key={l.id}
              className={cx(
                'break-words whitespace-pre-wrap',
                l.kind === 'in' ? 'text-accent' : l.kind === 'error' ? 'text-danger' : l.kind === 'note' ? 'text-muted italic' : l.kind === 'ohmic' ? 'text-faint' : 'text-text/90',
              )}
            >
              {l.kind === 'in' ? `› ${l.text}` : l.text || ' '}
              {multi && l.kind === 'in' && l.target !== target && <span className="ml-2 font-sans text-[10px] text-faint">{l.target}</span>}
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-center gap-2 border-t border-line bg-surface-2/60 px-3 py-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={!connected}
          placeholder={connected ? '(get-vin)' : 'Not connected'}
          aria-label="LispBM expression"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-faint disabled:opacity-50"
        />
        <Button type="submit" variant="primary" className="h-8" disabled={!connected || !input.trim()}>
          Run
        </Button>
      </form>
    </section>
  )
}

function StatsPanel({ entry }: { entry: { stats: { cpu: number; heap: number; mem: number; bindings: { name: string; value: number }[] } | null; running: boolean | null } | undefined }) {
  const st = entry?.stats
  return (
    <section className="card p-4" aria-label="Script engine stats">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label">Stats</h2>
        {!st && <Badge>{entry?.running === false ? 'No script running' : 'Waiting'}</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Meter label="CPU" value={st?.cpu ?? null} />
        <Meter label="Heap" value={st?.heap ?? null} />
        <Meter label="Memory" value={st?.mem ?? null} />
      </div>
      {st && st.bindings.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-xs font-medium text-muted">Global numbers</h3>
          <dl className="divide-y divide-line rounded-xl border border-line">
            {st.bindings.slice(0, 40).map((b) => (
              <div key={b.name} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <dt className="min-w-0 truncate font-mono text-xs">{b.name}</dt>
                <dd className="num text-sm">{Number.isInteger(b.value) ? b.value : b.value.toPrecision(5)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  )
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="num text-sm text-text">{value === null ? '–' : `${fmt(v, 0)} %`}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label={`${label} use`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(v)}
      >
        <div className={cx('h-full', v > 85 ? 'bg-danger' : v > 65 ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
    </div>
  )
}
