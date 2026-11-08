// A record of every AI proposal and what the rider did with it, kept in IndexedDB.

import { create } from 'zustand'

export type AiLogEvent =
  | 'proposed'
  | 'refused' // the guardrails turned the proposal down
  | 'edited'
  | 'rejected' // the rider said no
  | 'test-started'
  | 'test-ended'
  | 'applied'
  | 'apply-failed'
  | 'reverted'

export interface AiLogEntry {
  id?: number
  at: number
  proposalId: string
  event: AiLogEvent
  summary: string
  /** "Battery current (local): 30 A → 36 A" */
  changes: string[]
  detail?: string
}

const KEPT = 300
const table = () => import('../state/db').then((m) => m.db.aiLog)

interface AiLogState {
  entries: AiLogEntry[]
  loaded: boolean
  load: () => Promise<void>
  add: (e: Omit<AiLogEntry, 'id' | 'at'>) => Promise<void>
  clear: () => Promise<void>
}

export const useAiLog = create<AiLogState>()((set, get) => ({
  entries: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return
    try {
      const entries = await (await table()).orderBy('at').reverse().limit(KEPT).toArray()
      set({ entries, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  add: async (e) => {
    const entry: AiLogEntry = { ...e, at: Date.now() }
    set({ entries: [entry, ...get().entries].slice(0, KEPT) })
    try {
      const t = await table()
      entry.id = await t.add(entry)
      const extra = (await t.count()) - KEPT
      if (extra > 0) await t.orderBy('at').limit(extra).delete()
    } catch {
      // Kept in memory for this session.
    }
  },
  clear: async () => {
    set({ entries: [] })
    try {
      await (await table()).clear()
    } catch {
      // nothing stored
    }
  },
}))
