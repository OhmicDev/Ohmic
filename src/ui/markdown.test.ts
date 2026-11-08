import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }))

describe('Markdown', () => {
  it('renders the common parts of a package description', () => {
    const out = html('# Title\n\nSome **bold** and *soft* text with `code`.\n\n- one\n- two\n\n1. first\n\n```\n(print 1)\n```\n\n> quoted')
    expect(out).toContain('<h3')
    expect(out).toContain('<strong')
    expect(out).toContain('<em>soft</em>')
    expect(out).toContain('<code')
    expect(out).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/)
    expect(out).toContain('<ol')
    expect(out).toContain('(print 1)')
    expect(out).toContain('<blockquote')
  })

  it('never passes markup or script through', () => {
    const out = html('<script>alert(1)</script>\n\n[click](javascript:alert(1)) <img src=x onerror=alert(1)>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('href="javascript')
    expect(out).toContain('&lt;script&gt;')
  })

  it('opens web links in a new tab and turns images into links', () => {
    const out = html('See [the docs](https://example.com/docs) and ![a photo](https://example.com/p.png)')
    expect(out).toContain('href="https://example.com/docs"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('Image: a photo')
    expect(out).not.toContain('<img')
  })
})
