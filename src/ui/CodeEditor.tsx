import { memo, useId, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { tokenize, type Token } from '../lib/lispHighlight'

/** Above this size the editor shows plain text, so typing stays quick on a phone. */
const HIGHLIGHT_MAX = 80_000

const CLASS: Record<Token['kind'], string> = {
  comment: 'syn-comment',
  string: 'syn-string',
  number: 'syn-number',
  keyword: 'syn-keyword',
  builtin: 'syn-builtin',
  constant: 'syn-constant',
  quote: 'syn-keyword',
  paren: '',
  symbol: '',
  space: '',
}

const Highlighted = memo(function Highlighted({ code }: { code: string }) {
  const tokens = useMemo(() => (code.length > HIGHLIGHT_MAX ? null : tokenize(code)), [code])
  if (!tokens) return <>{code}</>
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === 'paren' ? (
          <span key={i} className={`syn-paren-${(t.depth ?? 0) % 4}`}>
            {t.text}
          </span>
        ) : CLASS[t.kind] ? (
          <span key={i} className={CLASS[t.kind]}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
      {/* Keeps the last empty line's height in step with the textarea. */}
      {'\n'}
    </>
  )
})

/**
 * A plain textarea over a highlighted copy of its text. Tab indents; Escape then
 * Tab moves on to the next control; Ctrl/⌘+Enter runs onSubmit.
 */
export function CodeEditor({
  value,
  onChange,
  onSubmit,
  label,
  readOnly = false,
  errorLine = null,
  className = 'h-[52dvh] min-h-72',
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  label: string
  readOnly?: boolean
  /** A line to mark (1-based), e.g. an unclosed bracket. */
  errorLine?: number | null
  className?: string
}) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const pre = useRef<HTMLPreElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const escaped = useRef(false)
  const hintId = useId()
  const lines = useMemo(() => value.split('\n').length, [value])

  const sync = () => {
    const t = ta.current
    if (!t) return
    if (pre.current) pre.current.style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`
    if (gutter.current) gutter.current.style.transform = `translateY(${-t.scrollTop}px)`
  }
  useLayoutEffect(sync, [value])

  const edit = (insert: string, from: number, to: number, caret: number) => {
    const t = ta.current
    if (!t) return
    onChange(value.slice(0, from) + insert + value.slice(to))
    requestAnimationFrame(() => {
      t.selectionStart = t.selectionEnd = caret
    })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget
    if (e.key === 'Escape') {
      escaped.current = true
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSubmit?.()
      return
    }
    if (readOnly) return
    if (e.key === 'Tab' && !escaped.current && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: en } = t
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      if (e.shiftKey) {
        const has = value.slice(lineStart, lineStart + 2) === '  ' ? 2 : value[lineStart] === ' ' ? 1 : 0
        if (has) edit('', lineStart, lineStart + has, Math.max(lineStart, s - has))
      } else edit('  ', s, en, s + 2)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Keep the indent of the line above.
      e.preventDefault()
      const s = t.selectionStart
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(lineStart, s))![0]
      edit('\n' + indent, s, t.selectionEnd, s + 1 + indent.length)
      return
    }
    escaped.current = false
  }

  return (
    <div className={`code-surface relative overflow-hidden font-mono text-[12.5px] leading-[1.65] ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-11 overflow-hidden border-r border-line bg-surface-2/60 text-right text-faint select-none">
        <div ref={gutter} className="px-2 py-3">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={errorLine === i + 1 ? 'text-danger' : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <pre ref={pre} aria-hidden className="pointer-events-none absolute top-0 left-11 m-0 py-3 pr-4 pl-3 whitespace-pre text-text/90">
        <Highlighted code={value} />
      </pre>
      <textarea
        ref={ta}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onKeyDown={onKey}
        readOnly={readOnly}
        aria-label={label}
        aria-describedby={hintId}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent py-3 pr-4 pl-14 whitespace-pre text-transparent caret-[var(--color-text)] outline-none selection:bg-accent/25"
      />
      <span id={hintId} className="sr-only">
        Tab indents. Press Escape, then Tab, to move to the next control. Control or Command plus Enter uploads.
      </span>
    </div>
  )
}
