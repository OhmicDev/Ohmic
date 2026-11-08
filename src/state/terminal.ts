// The VESC terminal: a transcript of commands and everything the controllers
// print, command history, and a helper that runs one command and collects its
// output (used by the fault log reader).
//
// The firmware prints with no end marker and no source, so output is credited
// to whichever controller was sent the last command.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Target } from '../client/VescClient'
import { parseHelp, type TerminalCommand } from '../protocol/terminal'
import { targetKey } from './devices'
import { activeClient, sessionEvents, useSession } from './session'

export type LineKind = 'cmd' | 'out' | 'note' | 'error'

export interface TermLine {
  id: number
  kind: LineKind
  text: string
  /** Target key the line belongs to ("local", "can2"). */
  target: string
  at: number
  /** Which part of the app sent the command, when it wasn't typed. */
  source?: string
}

interface TerminalState {
  lines: TermLine[]
  /** Commands typed, oldest first. */
  history: string[]
  /** Commands each controller listed in its `help` output, by target key. */
  learned: Record<string, TerminalCommand[]>
  send: (line: string, target: Target, opts?: { source?: string }) => Promise<void>
  note: (text: string, kind?: 'note' | 'error', target?: Target) => void
  clear: () => void
}

const MAX_LINES = 3000
const MAX_HISTORY = 100

let nextId = 1
let lastTarget = 'local'
const collectors = new Set<(text: string) => void>()

function makeLines(kind: LineKind, text: string, target: string, at: number, source?: string): TermLine[] {
  const parts = text.split('\n')
  // A print usually ends with "\n"; that isn't an extra blank line.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  return parts.map((t) => ({ id: nextId++, kind, text: t, target, at, source }))
}

export const useTerminal = create<TerminalState>()(
  persist(
    (set, get) => ({
      lines: [],
      history: [],
      learned: {},

      send: async (raw, target, opts = {}) => {
        const line = raw.trim()
        const key = targetKey(target)
        const client = activeClient()
        const at = Date.now()
        if (!client || useSession.getState().status !== 'connected') {
          get().note('Not connected. Connect a controller first.', 'error', target)
          throw new Error('Not connected')
        }
        set((s) => ({
          lines: [...s.lines, ...makeLines('cmd', line, key, at, opts.source)].slice(-MAX_LINES),
          history: opts.source || !line ? s.history : [...s.history.filter((h) => h !== line), line].slice(-MAX_HISTORY),
        }))
        lastTarget = key
        if (line === 'help') void learnFrom(key)
        await client.terminal(line, target)
      },

      note: (text, kind = 'note', target = 'local') =>
        set((s) => ({ lines: [...s.lines, ...makeLines(kind, text, targetKey(target), Date.now())].slice(-MAX_LINES) })),

      clear: () => set({ lines: [] }),
    }),
    {
      name: 'ohmic.terminal',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only the command history is kept between visits; output can hold device details.
      partialize: (s) => ({ history: s.history }),
    },
  ),
)

sessionEvents.prints.on(({ text, at }) => {
  for (const c of collectors) c(text)
  useTerminal.setState((s) => ({ lines: [...s.lines, ...makeLines('out', text, lastTarget, at)].slice(-MAX_LINES) }))
})

async function learnFrom(key: string) {
  const text = await collect(1500, 400, 6000)
  const commands = parseHelp(text)
  if (commands.length) useTerminal.setState((s) => ({ learned: { ...s.learned, [key]: commands } }))
}

/** Gathers printed text until it goes quiet. */
function collect(firstMs: number, quietMs: number, maxMs: number): Promise<string> {
  return new Promise((resolve) => {
    const parts: string[] = []
    let quiet: ReturnType<typeof setTimeout> | null = null
    const done = () => {
      collectors.delete(onText)
      if (quiet) clearTimeout(quiet)
      clearTimeout(first)
      clearTimeout(max)
      resolve(parts.join('\n'))
    }
    const onText = (t: string) => {
      parts.push(t)
      clearTimeout(first)
      if (quiet) clearTimeout(quiet)
      quiet = setTimeout(done, quietMs)
    }
    collectors.add(onText)
    const first = setTimeout(done, firstMs)
    const max = setTimeout(done, maxMs)
  })
}

/**
 * Runs one command and returns everything printed until the output goes quiet.
 * It also shows in the terminal transcript, tagged with `source`.
 */
export async function runCommand(
  line: string,
  target: Target,
  opts: { source?: string; firstMs?: number; quietMs?: number; maxMs?: number } = {},
): Promise<string> {
  const output = collect(opts.firstMs ?? 2500, opts.quietMs ?? 500, opts.maxMs ?? 6000)
  await useTerminal.getState().send(line, target, { source: opts.source })
  return output
}

/** Commands for autocomplete: the built-in list plus anything this controller listed. */
export function commandsFor(builtIn: TerminalCommand[], learned: TerminalCommand[] | undefined): TerminalCommand[] {
  if (!learned?.length) return builtIn
  const known = new Map(builtIn.map((c) => [c.name, c]))
  const extra = learned.filter((c) => !known.has(c.name))
  return [...builtIn, ...extra]
}
