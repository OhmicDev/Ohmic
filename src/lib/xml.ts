// A small XML reader and writer for VESC Tool's parameter and config files.
// Handles elements, text, entities, comments, CDATA and the XML declaration.
// Has no imports so build scripts can use it directly.

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlElement[]
  /** Direct text content, entities decoded, untrimmed. */
  text: string
}

export class XmlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlError'
  }
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return NAMED[body.toLowerCase()] ?? m
  })
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '')
  return attrs
}

export function parseXml(input: string): XmlElement {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlElement[] = [root]
  const top = () => stack[stack.length - 1]
  let i = 0

  const need = (at: number, what: string) => {
    if (at < 0) throw new XmlError(`Unterminated ${what}`)
    return at
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      top().text += decodeEntities(src.slice(i))
      break
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      i = need(src.indexOf('-->', lt + 4), 'comment') + 3
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = need(src.indexOf(']]>', lt + 9), 'CDATA')
      top().text += src.slice(lt + 9, end)
      i = end + 3
    } else if (src.startsWith('<?', lt)) {
      i = need(src.indexOf('?>', lt + 2), 'declaration') + 2
    } else if (src.startsWith('<!', lt)) {
      i = need(src.indexOf('>', lt + 2), 'doctype') + 1
    } else if (src[lt + 1] === '/') {
      const gt = need(src.indexOf('>', lt), 'closing tag')
      const name = src.slice(lt + 2, gt).trim()
      const open = stack.pop()
      if (!open || open === root || open.name !== name) throw new XmlError(`Unexpected </${name}>`)
      i = gt + 1
    } else {
      const gt = need(src.indexOf('>', lt), 'tag')
      let inner = src.slice(lt + 1, gt)
      const selfClosing = inner.endsWith('/')
      if (selfClosing) inner = inner.slice(0, -1)
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner)
      if (!m) throw new XmlError('Empty tag name')
      const el: XmlElement = { name: m[1], attrs: parseAttrs(m[2]), children: [], text: '' }
      top().children.push(el)
      if (!selfClosing) stack.push(el)
      i = gt + 1
    }
  }

  if (stack.length !== 1) throw new XmlError(`<${top().name}> is never closed`)
  return root
}

export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => c.name === name)
}

export function childText(el: XmlElement, name: string): string | undefined {
  return child(el, name)?.text
}
