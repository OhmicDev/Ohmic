import { Fragment, memo, type ReactNode } from 'react'

// A small Markdown renderer for package descriptions. It builds React elements
// (never HTML strings), so nothing in a description can run script. Covers
// headings, paragraphs, lists, quotes, code, rules, emphasis and links. Images
// become links: they'd load from other sites, which a description shouldn't do.

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'code'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' }

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join(' ') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      while (++i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i])
      out.push({ t: 'code', text: body.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      out.push({ t: 'h', level: h[1].length, text: h[2] })
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push({ t: 'hr' })
      continue
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul'
      const items = [li[2]]
      while (i + 1 < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i + 1])
        if (next) items.push(next[2])
        else if (/^\s{2,}\S/.test(lines[i + 1])) items[items.length - 1] += ' ' + lines[i + 1].trim()
        else break
        i++
      }
      out.push({ t: kind, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const body = [line.replace(/^\s*>\s?/, '')]
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ''))
      out.push({ t: 'quote', text: body.join(' ') })
      continue
    }
    if (!line.trim()) flush()
    else para.push(line.trim())
  }
  flush()
  return out
}

const safeHref = (url: string) => (/^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : null)

/** Inline Markdown: `code`, **bold**, *italic*, [links](url), ![images](url), <autolinks>. */
function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|<(https?:\/\/[^>\s]+)>|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_/g
  let last = 0
  let n = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}.${n++}`
    if (m[1]) out.push(<code key={k} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.9em]">{m[2]}</code>)
    else if (m[4] !== undefined) {
      const href = safeHref(m[4])
      out.push(href ? <Link key={k} href={href}>{`Image: ${m[3] || 'picture'}`}</Link> : `[${m[3] || 'image'}]`)
    } else if (m[5] !== undefined) {
      const href = safeHref(m[6])
      out.push(href ? <Link key={k} href={href}>{inline(m[5], k)}</Link> : <Fragment key={k}>{inline(m[5], k)}</Fragment>)
    } else if (m[7]) out.push(<Link key={k} href={m[7]}>{m[7]}</Link>)
    else if (m[8] ?? m[9]) out.push(<strong key={k} className="font-semibold text-text">{inline(m[8] ?? m[9], k)}</strong>)
    else out.push(<em key={k}>{inline(m[10] ?? m[11], k)}</em>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
      {children}
    </a>
  )
}

export const Markdown = memo(function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source)
  return (
    <div className={`space-y-2.5 text-sm leading-relaxed text-muted ${className ?? ''}`}>
      {blocks.map((b, i) => {
        const k = String(i)
        switch (b.t) {
          case 'h': {
            const cls = b.level <= 2 ? 'text-base font-semibold text-text' : 'text-sm font-semibold text-text'
            const Tag = (b.level <= 2 ? 'h3' : 'h4') as 'h3'
            return (
              <Tag key={k} className={`${cls} pt-1`}>
                {inline(b.text, k)}
              </Tag>
            )
          }
          case 'p':
            return <p key={k}>{inline(b.text, k)}</p>
          case 'ul':
          case 'ol': {
            const Tag = b.t
            return (
              <Tag key={k} className={`${b.t === 'ul' ? 'list-disc' : 'list-decimal'} space-y-1 pl-5`}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}.${j}`)}</li>
                ))}
              </Tag>
            )
          }
          case 'code':
            return (
              <pre key={k} className="code-surface overflow-x-auto rounded-lg p-3 font-mono text-xs text-text/90">
                {b.text}
              </pre>
            )
          case 'quote':
            return (
              <blockquote key={k} className="border-l-2 border-line-strong pl-3 italic">
                {inline(b.text, k)}
              </blockquote>
            )
          case 'hr':
            return <hr key={k} className="border-line" />
        }
      })}
    </div>
  )
})
