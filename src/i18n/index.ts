// Interface text by language. English is the source; a language added to
// CATALOGS only needs the keys it translates, and the rest stays English.
// To add one: copy en.ts to xx.ts, translate the values, add it below.

import { useCallback } from 'react'
import { useSettings } from '../state/settings'
import { en, type MessageKey } from './en'

export type { MessageKey }
type Catalog = Partial<Record<MessageKey, string>>

export const LANGUAGES: { code: string; name: string }[] = [{ code: 'en', name: 'English' }]

const CATALOGS: Record<string, Catalog> = { en }

type Vars = Record<string, string | number>

export function translate(lang: string, key: MessageKey, vars?: Vars): string {
  const text = CATALOGS[lang]?.[key] ?? en[key] ?? key
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

/** Translation outside React (stores, notifications). */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(useSettings.getState().language, key, vars)
}

/** The translate function for the chosen language. */
export function useT() {
  const lang = useSettings((s) => s.language)
  return useCallback((key: MessageKey, vars?: Vars) => translate(lang, key, vars), [lang])
}

/** Registers a catalog (tests, and languages loaded later). */
export function addCatalog(code: string, catalog: Catalog) {
  CATALOGS[code] = catalog
}
