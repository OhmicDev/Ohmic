import { Link } from '@tanstack/react-router'
import { Bot, CircleAlert, FlaskConical, Info, Loader2, Plus, Send, ShieldCheck, Sparkles, Square, TriangleAlert, Wrench } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAiLog, type AiLogEntry } from '../../ai/log'
import { useTune, type ChatItem } from '../../ai/tune'
import { cx } from '../../lib/format'
import { useRideModes } from '../../state/rideModes'
import { useSession } from '../../state/session'
import { useSettings } from '../../state/settings'
import { BackLink, Button, PageTitle } from '../../ui/Primitives'
import { useNow } from '../../ui/useNow'
import { AiPrivacy } from './AiPrivacy'
import { ChangeCard } from './ChangeCard'
import { ProfileCard } from './ProfileCard'
import { OfflineNote } from '../../ui/OfflineNote'

const GOALS: { label: string; text: string }[] = [
  { label: 'More power', text: 'I want more power.' },
  { label: 'More range', text: 'I want more range.' },
  { label: 'Smoother throttle', text: 'I want a smoother throttle.' },
  { label: 'Better hill climbing', text: 'I want better hill climbing.' },
  { label: 'Cooler motor', text: 'My motor gets too hot. I want it to run cooler.' },
  { label: 'Fix cut-outs', text: 'It cuts out sometimes. Help me fix it.' },
  { label: 'Beginner-safe', text: 'Make it safe for a beginner.' },
  { label: 'Explain my fault', text: 'Explain my latest fault.' },
]

export function TunePage() {
  const enabled = useSettings((s) => s.ai.enabled)
  const code = useSettings((s) => s.ai.accessCode)
  const newChat = useTune((s) => s.newChat)
  const detect = useTune((s) => s.detect)
  const hasChat = useTune((s) => s.items.length > 0)

  useEffect(() => void useAiLog.getState().load(), [])
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(() => void detect(), code ? 500 : 0)
    return () => clearTimeout(t)
  }, [enabled, code, detect])

  return (
    <>
      <BackLink to="/tune">Tune</BackLink>
      <PageTitle
        title="AI Tune"
        subtitle="Tell it what you want from your ride. It reads your setup and suggests changes you review."
        actions={
          enabled && hasChat ? (
            <Button variant="ghost" onClick={newChat}>
              <Plus className="size-4" /> New chat
            </Button>
          ) : undefined
        }
      />
      <OfflineNote what="ai" />
      {enabled ? (
        <>
          <TestBanner />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Chat />
            <aside className="space-y-4">
              <ProfileCard />
              <section className="card p-4">
                <h2 className="label mb-1">Privacy</h2>
                <AiPrivacy />
              </section>
              <History />
            </aside>
          </div>
        </>
      ) : (
        <section className="card max-w-2xl p-5">
          <h2 className="wide mb-1 text-lg font-semibold">AI Tune is off</h2>
          <p className="mb-2 text-sm text-muted">Turn it on to chat with the tuning assistant. Nothing is sent while it’s off.</p>
          <AiPrivacy />
        </section>
      )}
    </>
  )
}

function BackendLine() {
  const backend = useTune((s) => s.backend)
  const model = useTune((s) => s.model)
  const problem = useTune((s) => s.serverProblem)
  const demoScooter = useSession((s) => s.transportKind === 'mock')
  if (backend === 'checking')
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Looking for the AI server…
      </p>
    )
  if (backend === 'server')
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Bot className="size-3.5 text-accent" /> Claude ({model}) through this app’s AI server{demoScooter ? ', talking about the demo scooter' : ''}.
      </p>
    )
  return (
    <div className="flex gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs leading-relaxed">
      <Info className="mt-0.5 size-4 shrink-0 text-warn" />
      <div>
        <span className="font-semibold text-warn">Scripted demo, not AI.</span> {problem} This stand-in recognises the goals below, reads your controller with
        the same tools and proposes simple changes, so you can try the cards and test mode. For the real assistant, run the Ohmic server with an Anthropic
        API key (see the README: <span className="font-mono">npm run server</span>).
      </div>
    </div>
  )
}

function Chat() {
  const items = useTune((s) => s.items)
  const running = useTune((s) => s.running)
  const activity = useTune((s) => s.activity)
  const send = useTune((s) => s.send)
  const stop = useTune((s) => s.stop)
  const backend = useTune((s) => s.backend)
  const connected = useSession((s) => s.status === 'connected')
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Follow new text unless the rider scrolled up to read.
  useLayoutEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: 'end' })
  }, [items, activity])

  const submit = (t = text) => {
    if (!t.trim() || running || backend === 'checking') return
    stick.current = true
    void send(t)
    setText('')
  }

  return (
    <section className="card flex min-h-[520px] flex-col overflow-hidden" aria-label="Chat with the tuning assistant">
      <div className="border-b border-line px-4 py-3">
        <BackendLine />
      </div>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4 lg:max-h-[calc(100dvh-280px)]"
        aria-live="polite"
        aria-busy={running}
      >
        {items.length === 0 ? (
          <Welcome connected={connected} onPick={(t) => submit(t)} disabled={running || backend === 'checking'} />
        ) : (
          items.map((i) => <Item key={i.id} item={i} />)
        )}
        {running && activity && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin text-accent" /> {activity}
          </p>
        )}
        <div ref={end} />
      </div>
      {items.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-line px-4 pt-3 [scrollbar-width:none]">
          {GOALS.map((g) => (
            <button
              key={g.label}
              disabled={running}
              onClick={() => submit(g.text)}
              className="focus-ring shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-40"
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Ask about your setup, or tell it what you want…"
          aria-label="Message to the tuning assistant"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none [field-sizing:content] focus:border-accent/60"
        />
        {running ? (
          <Button type="button" onClick={stop} aria-label="Stop">
            <Square className="size-4" /> Stop
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!text.trim() || backend === 'checking'} aria-label="Send">
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </section>
  )
}

function Welcome({ connected, onPick, disabled }: { connected: boolean; onPick: (t: string) => void; disabled: boolean }) {
  return (
    <div className="relative py-4">
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
        <Sparkles className="size-5" />
      </span>
      <h2 className="wide mt-4 text-lg font-semibold">What would you like to change?</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {GOALS.map((g) => (
          <button
            key={g.label}
            disabled={disabled}
            onClick={() => onPick(g.text)}
            className="focus-ring rounded-full border border-line-strong bg-surface-2 px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent/50 hover:text-text disabled:opacity-40"
          >
            {g.label}
          </button>
        ))}
      </div>
      <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
        It reads your controller’s settings and live data, asks about your battery and motor, then proposes specific changes with the reason and trade-off for
        each. Try live limits as a test mode first; nothing is saved without your review, and a backup is made before every write.
      </p>
      {!connected && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-warn">
          <TriangleAlert className="size-4" /> Not connected. You can chat, but it can’t read or change your setup until you{' '}
          <Link to="/connect" className="underline underline-offset-4">
            connect
          </Link>
          .
        </p>
      )}
    </div>
  )
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent/14 px-3.5 py-2 text-sm whitespace-pre-wrap">{item.text}</p>
        </div>
      )
    case 'assistant':
      return (
        <div className="max-w-[92%] text-sm leading-relaxed whitespace-pre-wrap">
          {item.text}
          {item.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-text-bottom" />}
        </div>
      )
    case 'tool':
      return (
        <p className={cx('flex items-center gap-1.5 text-xs', item.error ? 'text-warn' : 'text-faint')}>
          {item.error ? <CircleAlert className="size-3.5" /> : <Wrench className="size-3.5" />}
          {item.label}
        </p>
      )
    case 'proposal':
      return <ChangeCard proposalId={item.proposalId} />
    case 'notice':
      return (
        <p
          role={item.tone === 'error' ? 'alert' : undefined}
          className={cx(
            'flex gap-2 rounded-xl border px-3 py-2 text-xs',
            item.tone === 'error' ? 'border-danger/35 bg-danger/8 text-danger' : item.tone === 'warn' ? 'border-warn/30 bg-warn/5 text-warn' : 'border-line text-muted',
          )}
        >
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {item.text}
        </p>
      )
  }
}

/** A limit test is running: what it is and how to end it. */
function TestBanner() {
  const test = useRideModes((s) => s.test)
  const proposal = useTune((s) => (test ? s.proposals[test.id] : undefined))
  const running = useTune((s) => s.running)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useNow(15000)
  if (!test) return null
  const end = async () => {
    setBusy(true)
    setError(await useTune.getState().endTest())
    setBusy(false)
  }
  const minutes = Math.max(0, Math.round((now - test.startedAt) / 60000))
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 border-accent/40 p-4" role="status">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent/12 text-accent">
        <FlaskConical className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Test mode: {test.label}</div>
        <div className="text-xs text-muted">
          {minutes ? `Started ${minutes} min ago.` : 'Started just now.'} In the controller’s memory only: End test or a power cycle puts your settings back.
          {!proposal && ' (From an earlier chat: end it here, or start the proposal again.)'}
        </div>
        {error && <div className="mt-1 text-xs text-danger">{error}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/logs" className="focus-ring inline-flex h-9 items-center rounded-xl border border-line-strong bg-surface-3 px-3.5 text-sm">
          Record a ride
        </Link>
        {proposal && (
          <Button className="h-9" disabled={running} onClick={() => void useTune.getState().send('How did that go? I just took a test ride with these changes.')}>
            How did that go?
          </Button>
        )}
        <Button variant="ghost" className="h-9" disabled={busy} onClick={() => void end()}>
          {busy && <Loader2 className="size-4 animate-spin" />} End test
        </Button>
      </div>
    </div>
  )
}

const EVENT_TEXT: Record<AiLogEntry['event'], string> = {
  proposed: 'Proposed',
  refused: 'Turned down by safety checks',
  edited: 'You edited',
  rejected: 'You rejected',
  'test-started': 'Test started',
  'test-ended': 'Test ended',
  applied: 'Saved to the controller',
  'apply-failed': 'Write didn’t finish',
  reverted: 'Old values put back',
}

function History() {
  const entries = useAiLog((s) => s.entries)
  const clear = useAiLog((s) => s.clear)
  const [all, setAll] = useState(false)
  const shown = all ? entries : entries.slice(0, 6)
  return (
    <section className="card p-4" aria-labelledby="ai-history">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="ai-history" className="label">
          History
        </h2>
        {entries.length > 0 && (
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => void clear()}>
            Clear
          </Button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-3.5 text-ok" /> Every proposal and what you did with it is kept here.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {shown.map((e, i) => (
            <li key={e.id ?? `${e.at}-${i}`} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cx('font-medium', e.event === 'refused' || e.event === 'apply-failed' ? 'text-warn' : e.event === 'applied' ? 'text-ok' : 'text-text')}>
                  {EVENT_TEXT[e.event]}
                </span>
                <time className="shrink-0 text-faint" dateTime={new Date(e.at).toISOString()}>
                  {new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              <div className="text-muted">{e.summary}</div>
              {e.changes.length > 0 && (
                <ul className="mt-0.5 text-faint">
                  {e.changes.slice(0, 4).map((c) => (
                    <li key={c} className="num">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
              {e.detail && <div className="mt-0.5 text-faint">{e.detail}</div>}
            </li>
          ))}
        </ol>
      )}
      {entries.length > 6 && (
        <button className="focus-ring mt-2 text-xs text-muted underline-offset-4 hover:text-text hover:underline" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  )
}
