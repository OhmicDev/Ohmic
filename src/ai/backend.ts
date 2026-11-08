// How the browser reaches the model. The agent loop runs here (the tools need the
// controller); each step goes to the server proxy, which holds the API key, calls
// Claude and streams the reply back as lines of JSON:
//   {"type":"text","text":"..."}       text as it arrives
//   {"type":"thinking"}                 the model started thinking
//   {"type":"tool","name":"..."}        the model started a tool call
//   {"type":"message","message":{...}}  the finished message (content, stop_reason)
//   {"type":"error","message":"..."}    something went wrong

export interface ContentBlock {
  type: string
  [key: string]: unknown
}

export interface MessageParam {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export interface AiReply {
  content: ContentBlock[]
  stop_reason: string | null
  model?: string
}

export interface StreamHandlers {
  onText: (delta: string) => void
  onThinking?: () => void
  onTool?: (name: string) => void
}

export interface AiBackend {
  kind: 'server' | 'demo'
  send: (messages: MessageParam[], handlers: StreamHandlers, signal: AbortSignal) => Promise<AiReply>
}

export class AiError extends Error {}

export type ServerStatus = { ok: true; model: string } | { ok: false; reason: string; needsCode?: boolean }

const codeHeader = (code: string): Record<string, string> => (code ? { 'x-ohmic-access-code': code } : {})

/** The app's own server, under the folder the app is served from ("" at the site root). */
const OWN_SERVER = import.meta.env.BASE_URL.replace(/\/$/, '')

/** Is the AI server there and set up? */
export async function checkServer(base = OWN_SERVER, accessCode = ''): Promise<ServerStatus> {
  try {
    const r = await fetch(`${base}/api/ai/status`, { headers: codeHeader(accessCode), signal: AbortSignal.timeout(5000) })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { ok: false, reason: 'No AI server is running for this app.' }
    const body = (await r.json()) as { ok?: boolean; model?: string; reason?: string; needsCode?: boolean }
    return body.ok ? { ok: true, model: body.model ?? 'unknown' } : { ok: false, reason: body.reason ?? 'The AI server isn’t set up.', needsCode: body.needsCode }
  } catch {
    return { ok: false, reason: 'No AI server is running for this app.' }
  }
}

export function serverBackend(base = OWN_SERVER, accessCode = ''): AiBackend {
  return {
    kind: 'server',
    send: async (messages, h, signal) => {
      let r: Response
      try {
        r = await fetch(`${base}/api/ai`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...codeHeader(accessCode) },
          body: JSON.stringify({ messages }),
          signal,
        })
      } catch (e) {
        if (signal.aborted) throw e
        throw new AiError('Couldn’t reach the AI server. Check your internet connection.')
      }
      if (!r.ok || !r.body) {
        let msg = `The AI server answered with an error (${r.status}).`
        try {
          const b = (await r.json()) as { message?: string }
          if (b.message) msg = b.message
        } catch {
          // not JSON
        }
        throw new AiError(msg)
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      let reply: AiReply | null = null
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let ev: { type: string; text?: string; name?: string; message?: unknown }
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'text' && typeof ev.text === 'string') h.onText(ev.text)
          else if (ev.type === 'thinking') h.onThinking?.()
          else if (ev.type === 'tool' && typeof ev.name === 'string') h.onTool?.(ev.name)
          else if (ev.type === 'message') reply = ev.message as AiReply
          else if (ev.type === 'error') throw new AiError(typeof ev.message === 'string' ? ev.message : 'The AI request failed.')
        }
      }
      if (!reply) throw new AiError('The reply was cut off before it finished. Try again.')
      return reply
    },
  }
}

/**
 * The content to keep in the history. After a mid-reply fallback to another model,
 * the declined model's blocks before the last fallback marker are dropped, except
 * text (thinking and tool calls belong to the model that declined), as the API
 * requires. The markers stay where they were; everything after the last one is kept.
 */
export function echoable(content: ContentBlock[]): ContentBlock[] {
  const last = content.map((b) => b.type).lastIndexOf('fallback')
  if (last < 0) return content
  return content.filter((b, i) => i >= last || b.type === 'text' || b.type === 'fallback')
}
