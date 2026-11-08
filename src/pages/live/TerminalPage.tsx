import { Link } from '@tanstack/react-router'
import { ChevronRight, Copy, Eraser, TriangleAlert } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../../lib/format'
import { TERMINAL_COMMANDS, terminalCommand, type TerminalCommand } from '../../protocol/terminal'
import { targetFromKey, targetKey, targetLabel } from '../../state/devices'
import { useMotionBlock } from '../../state/motion'
import { useSession } from '../../state/session'
import { commandsFor, useTerminal, type TermLine } from '../../state/terminal'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'

const QUICK = ['help', 'faults', 'hw_status', 'uptime', 'volt', 'mem']
const MAX_SUGGESTIONS = 8

export function TerminalPage() {
  const lines = useTerminal((s) => s.lines)
  const history = useTerminal((s) => s.history)
  const learned = useTerminal((s) => s.learned)
  const status = useSession((s) => s.status)
  const devices = useSession((s) => s.devices)
  const [picked, setPicked] = useState('local')
  const [input, setInput] = useState('')
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const [sugIdx, setSugIdx] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [confirm, setConfirm] = useState<{ line: string; cmd: TerminalCommand } | null>(null)
  const [copied, setCopied] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const connected = status === 'connected'
  const target = devices.some((d) => targetKey(d.target) === picked) ? picked : 'local'
  const multi = devices.length > 1
  const commands = commandsFor(TERMINAL_COMMANDS, learned[target])

  // Suggestions for the command word only.
  const word = input.trimStart()
  const suggestions =
    !dismissed && word && !/\s/.test(word)
      ? [
          ...commands.filter((c) => c.name.startsWith(word)),
          ...commands.filter((c) => !c.name.startsWith(word) && c.name.includes(word)),
        ]
          .filter((c) => c.name !== word)
          .slice(0, MAX_SUGGESTIONS)
      : []

  // Keep the newest output in view unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines])

  const run = (line: string) => {
    void useTerminal
      .getState()
      .send(line, targetFromKey(target))
      .catch(() => {})
    stick.current = true
    setInput('')
    setHistIdx(null)
    setSugIdx(-1)
  }

  const submit = (line: string) => {
    if (!line.trim() || !connected) return
    const cmd = terminalCommand(line)
    if (cmd?.risk) setConfirm({ line: line.trim(), cmd })
    else run(line)
  }

  const complete = (c: TerminalCommand) => {
    setInput(c.args ? `${c.name} ` : c.name)
    setSugIdx(-1)
    inputRef.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault()
      complete(suggestions[Math.max(0, sugIdx)])
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const down = e.key === 'ArrowDown'
      if (suggestions.length) {
        setSugIdx((i) => (down ? Math.min(suggestions.length - 1, i + 1) : Math.max(-1, i - 1)))
      } else if (history.length) {
        const next = histIdx === null ? (down ? null : history.length - 1) : down ? histIdx + 1 : Math.max(0, histIdx - 1)
        if (next === null || next >= history.length) {
          setHistIdx(null)
          setInput('')
        } else {
          setHistIdx(next)
          setInput(history[next])
          setDismissed(true)
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length && sugIdx >= 0) complete(suggestions[sugIdx])
      else submit(input)
    } else if (e.key === 'Escape') {
      setDismissed(true)
      setSugIdx(-1)
    }
  }

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(lines.map((l) => (l.kind === 'cmd' ? `> ${l.text}` : l.text)).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; nothing else to do.
    }
  }

  const motion = useMotionBlock([targetFromKey(target)], 'run motor tests')
  const moving = confirm && confirm.cmd.risk !== 'reboots' ? motion : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {multi && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Send to
            <select
              value={target}
              onChange={(e) => setPicked(e.target.value)}
              className="focus-ring h-10 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm text-text"
            >
              {devices.map((d) => (
                <option key={targetKey(d.target)} value={targetKey(d.target)}>
                  {targetLabel(d.target)}
                  {d.fw?.hwName ? ` · ${d.fw.hwName}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={!connected}
              onClick={() => submit(q)}
              className="focus-ring h-8 rounded-lg border border-line-strong bg-surface-2 px-2.5 font-mono text-xs text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => void copyAll()} disabled={!lines.length}>
            <Copy className="size-3.5" /> {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => useTerminal.getState().clear()} disabled={!lines.length}>
            <Eraser className="size-3.5" /> Clear
          </Button>
        </div>
      </div>

      <section className="card overflow-hidden" aria-label="Terminal">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          role="log"
          aria-live="polite"
          className="h-[52dvh] min-h-64 overflow-y-auto code-surface px-4 py-3 font-mono text-[12.5px] leading-relaxed md:h-[60dvh]"
        >
          {lines.length === 0 ? (
            <p className="text-faint">
              {connected ? 'Type a command below, or tap one above. Try "help" to list them all.' : 'Connect a controller to use the terminal.'}
            </p>
          ) : (
            lines.map((l) => <Line key={l.id} l={l} multi={multi} />)
          )}
        </div>

        <div className="relative border-t border-line bg-surface-2/60">
          {suggestions.length > 0 && (
            <ul role="listbox" aria-label="Commands" className="absolute inset-x-2 bottom-full mb-2 overflow-hidden rounded-xl border border-line-strong bg-surface-3 shadow-2xl">
              {suggestions.map((c, i) => (
                <li key={c.name} role="option" aria-selected={i === sugIdx}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      complete(c)
                    }}
                    className={cx('flex w-full items-baseline gap-2 px-3 py-2 text-left', i === sugIdx ? 'bg-accent/12' : 'hover:bg-text/5')}
                  >
                    <span className="font-mono text-[13px] text-text">{c.name}</span>
                    {c.args && <span className="hidden font-mono text-[11px] text-faint sm:inline">{c.args}</span>}
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.help}</span>
                    {c.risk && <span className="shrink-0 text-[11px] text-warn">{c.risk === 'reboots' ? 'restarts' : 'drives motor'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit(input)
            }}
            className="flex items-center gap-2 px-3 py-2"
          >
            <ChevronRight className="size-4 shrink-0 text-accent" aria-hidden />
            <input
              ref={inputRef}
              value={input}
              disabled={!connected}
              onChange={(e) => {
                setInput(e.target.value)
                setDismissed(false)
                setSugIdx(-1)
                setHistIdx(null)
              }}
              onKeyDown={onKey}
              placeholder={connected ? `Command for ${targetLabel(targetFromKey(target))}` : 'Not connected'}
              aria-label="Terminal command"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              className="h-10 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-faint disabled:opacity-50"
            />
            <Button type="submit" variant="primary" className="h-9" disabled={!connected || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </section>
      <p className="text-xs text-faint">
        Tab completes, ↑ and ↓ go through earlier commands. Output has no sender, so it’s shown under the controller you last sent a command to.
      </p>

      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm?.cmd.risk === 'reboots' ? 'Restart the controller?' : 'This command drives the motor'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.cmd.risk === 'reboots' ? 'primary' : 'danger'}
              disabled={!!moving}
              onClick={() => {
                if (confirm) run(confirm.line)
                setConfirm(null)
              }}
            >
              Run {confirm?.cmd.name}
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-3 text-sm text-muted">
            <p className="font-mono text-[13px] text-text">{confirm.line}</p>
            {confirm.cmd.risk === 'reboots' ? (
              <p>The controller restarts. The connection drops for a moment and comes back by itself.</p>
            ) : (
              <>
                <p>
                  It spins or holds the motor with current, on purpose. Lift the wheel off the ground and keep hands, cables and
                  clothing clear.
                </p>
                {confirm.cmd.risk === 'spins-saves' && (
                  <p className="text-warn">
                    When it finishes it saves new motor settings straight to the controller, without the usual review. Make a backup first in{' '}
                    <Link to="/config/backups" className="underline" onClick={() => setConfirm(null)}>
                      Config › Backups
                    </Link>
                    .
                  </p>
                )}
              </>
            )}
            {moving && (
              <p role="alert" className="flex items-start gap-2 text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {moving}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}

function Line({ l, multi }: { l: TermLine; multi: boolean }) {
  if (l.kind === 'cmd') {
    return (
      <div className="mt-2 flex gap-2 text-accent first:mt-0">
        <span aria-hidden>›</span>
        <span className="break-all">{l.text || <span className="text-faint">(empty)</span>}</span>
        {(multi || l.source) && (
          <span className="ml-auto shrink-0 font-sans text-[11px] text-faint">
            {multi && targetLabel(targetFromKey(l.target))}
            {multi && l.source && ' · '}
            {l.source && `from ${l.source}`}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className={cx('break-words whitespace-pre-wrap', l.kind === 'error' ? 'text-danger' : l.kind === 'note' ? 'text-muted italic' : 'text-text/90')}>
      {l.text || ' '}
    </div>
  )
}
