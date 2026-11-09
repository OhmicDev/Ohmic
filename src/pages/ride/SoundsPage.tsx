import { Headphones, Loader2, Music, Play, Plus, Square, Trash2, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx, fmt } from '../../lib/format'
import { MAX_NOTES, parseRtttl, previewOnSpeaker, TuneError, tuneMs, type Tune } from '../../onboard/music'
import { useConfig } from '../../state/config'
import { useMotionBlock } from '../../state/motion'
import { allTunes, soundCapAmps, soundIssues, SOUND_MIN_AMPS, useMusic } from '../../state/onboard'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { BackLink, Badge, Button, PageTitle } from '../../ui/Primitives'
import { useMotorDevices } from '../setup/helpers'

export function SoundsPage() {
  const devices = useConfig((s) => s.devices)
  const list = useMotorDevices()
  const { custom, playing, sending, error, load, play, stop, addTune, removeTune } = useMusic()
  const amps = useSettings((s) => s.soundAmps)
  const setAmps = useSettings((s) => s.setSoundAmps)
  const connected = useSession((s) => s.status === 'connected')
  const [key, setKey] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const stopPreview = useRef<(() => void) | null>(null)
  useEffect(() => void load(), [load])
  useEffect(() => () => stopPreview.current?.(), [])

  const d = (key && devices[key]) || list[0]
  const motion = useMotionBlock(d ? [d.target] : [], 'play sounds')
  const cap = d?.mcconf.device ? soundCapAmps(d.mcconf.device) : 2
  const volume = Math.min(amps, cap)
  const issue = d ? soundIssues(d, volume) : 'Connect to a controller first.'
  const blocked = issue || motion
  const tunes = allTunes(custom)

  // Keep the volume inside this motor's cap (never silently above it).
  useEffect(() => {
    if (amps > cap) setAmps(cap)
  }, [amps, cap, setAmps])

  const preview = (t: Tune) => {
    stopPreview.current?.()
    if (previewing === t.id) {
      setPreviewing(null)
      return
    }
    try {
      const notes = parseRtttl(t.rtttl).notes
      stopPreview.current = previewOnSpeaker(notes)
      setPreviewing(t.id)
      setTimeout(() => setPreviewing((p) => (p === t.id ? null : p)), tuneMs(notes) + 200)
    } catch {
      // checked when added
    }
  }

  return (
    <>
      <BackLink to="/more">More</BackLink>
      <PageTitle
        title="Motor sounds"
        subtitle="Play tunes and effects through the motor: the windings hum at each note’s pitch without turning the wheel. Only while stopped; a tune stops by itself if the wheel moves."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <section className="card space-y-4 p-5">
          {list.length > 1 && (
            <div>
              <div className="label mb-1.5">Play on</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((x) => (
                  <button
                    key={x.key}
                    onClick={() => setKey(x.key)}
                    aria-pressed={d?.key === x.key}
                    className={cx(
                      'focus-ring h-9 rounded-lg border px-3 text-sm',
                      d?.key === x.key ? 'border-accent/50 bg-accent/10' : 'border-line-strong text-muted hover:text-text',
                    )}
                  >
                    {x.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <span className="label">Volume</span>
              <span className="num text-sm font-semibold">
                {fmt(volume, 1)} <span className="text-xs font-normal text-muted">A</span>
              </span>
            </div>
            <input
              type="range"
              min={SOUND_MIN_AMPS}
              max={cap}
              step={0.5}
              value={volume}
              onChange={(e) => setAmps(Number(e.target.value))}
              aria-label="Volume in amps"
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Set as current through the motor, because that’s what warms it. The most allowed here is {fmt(cap, 1)} A: a quarter
              of this motor’s current limit, never more than 10 A, and never more than a quarter of the battery voltage.
            </p>
          </div>

          {blocked && <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{blocked}</p>}
          {error && <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{error}</p>}
          {playing && (
            <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5">
              <Music className="size-4 text-accent" />
              <span className="flex-1 text-sm">Playing {tunes.find((t) => t.id === playing.tuneId)?.name}</span>
              <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => void stop()}>
                <Square className="size-3.5" /> Stop
              </Button>
            </div>
          )}

          <AddTune onAdd={addTune} />
        </section>

        <section className="card p-2">
          {(['effect', 'tune'] as const).map((kind) => (
            <div key={kind} className="p-2">
              <div className="label mb-1.5 px-1">{kind === 'effect' ? 'Effects' : 'Tunes'}</div>
              <ul>
                {tunes
                  .filter((t) => t.kind === kind)
                  .map((t) => {
                    const notes = safeNotes(t)
                    return (
                      <li key={t.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
                          {kind === 'effect' ? <Zap className="size-4" /> : <Music className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {t.name} {t.custom && <Badge>Yours</Badge>}
                          </span>
                          <span className="block text-xs text-faint">
                            {notes.length} notes · {fmt(tuneMs(notes) / 1000, 1)} s
                          </span>
                        </span>
                        <Button variant="ghost" className="h-8 px-2" title="Preview on this device’s speaker" onClick={() => preview(t)}>
                          {previewing === t.id ? <Square className="size-3.5" /> : <Headphones className="size-4" />}
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-8 px-2.5 text-xs"
                          disabled={!connected || !!blocked || !!sending}
                          onClick={() => d && void play(t, d.key)}
                        >
                          {sending === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Motor
                        </Button>
                        {t.custom && (
                          <Button variant="ghost" className="h-8 px-2 text-danger hover:text-danger" aria-label={`Delete ${t.name}`} onClick={() => void removeTune(t.id)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

function safeNotes(t: Tune) {
  try {
    return parseRtttl(t.rtttl).notes
  } catch {
    return []
  }
}

function AddTune({ onAdd }: { onAdd: (rtttl: string) => Promise<Tune> }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const add = async () => {
    try {
      const t = await onAdd(text)
      setMsg({ ok: true, text: `Added “${t.name}”.` })
      setText('')
    } catch (e) {
      setMsg({ ok: false, text: e instanceof TuneError ? e.message : String(e) })
    }
  }
  return (
    <div className="border-t border-line pt-4">
      <div className="label mb-1.5">Add your own</div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setMsg(null)
        }}
        rows={3}
        aria-label="Your own tune, as RTTTL text"
        placeholder="Name:d=4,o=5,b=120:c,e,g,c6"
        spellCheck={false}
        className="focus-ring w-full rounded-xl border border-line-strong bg-surface-2 p-3 font-mono text-xs"
      />
      <p className="mt-1 text-xs text-muted">
        Paste a ring-tone in RTTTL text, the format phone-ringtone sites share. Up to {MAX_NOTES} notes. Only add tunes you have
        the right to use.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Button variant="secondary" className="h-9" disabled={!text.trim()} onClick={() => void add()}>
          <Plus className="size-4" /> Add tune
        </Button>
        {msg && <span className={cx('text-xs', msg.ok ? 'text-ok' : 'text-warn')}>{msg.text}</span>}
      </div>
    </div>
  )
}
