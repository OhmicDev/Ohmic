// Where the user is in the config editor. Not persisted: it resets on reload,
// but survives moving between pages.

import { create } from 'zustand'
import type { ConfigKind } from '../../config/types'

export type CompareWith = 'none' | 'defaults' | { backupId: number }

interface ConfigUi {
  deviceKey: string | null
  kind: ConfigKind
  /** "Group/Subgroup" */
  section: string | null
  query: string
  changedOnly: boolean
  compare: CompareWith
  differsOnly: boolean
  /** Opens the write review once the page shows (used by Restore). */
  reviewRequested: boolean
  set: (patch: Partial<Omit<ConfigUi, 'set'>>) => void
}

export const useConfigUi = create<ConfigUi>()((set) => ({
  deviceKey: null,
  kind: 'mcconf',
  section: null,
  query: '',
  changedOnly: false,
  compare: 'none',
  differsOnly: false,
  reviewRequested: false,
  set: (patch) => set(patch),
}))

export const sectionId = (group: string, subgroup: string) => `${group}/${subgroup}`
