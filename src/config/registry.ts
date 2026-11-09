// Finds the parameter definitions for a controller's firmware. Each version's JSON
// is its own chunk, loaded only when a controller running it connects.

import type { ConfigDefs, ConfigKind } from './types'

const modules = import.meta.glob<ConfigDefs>('./defs/*/*.json', { import: 'default' })

function parsePath(path: string): { fw: string; kind: ConfigKind } | null {
  const m = /\.\/defs\/([^/]+)\/(mcconf|appconf)\.json$/.exec(path)
  return m ? { fw: m[1], kind: m[2] as ConfigKind } : null
}

/** Firmware versions we have definitions for, oldest first. */
export const SUPPORTED_FW: string[] = [
  ...new Set(
    Object.keys(modules)
      .map((p) => parsePath(p)?.fw)
      .filter((v): v is string => !!v),
  ),
].sort((a, b) => Number(a) - Number(b))

/** 6, 6 → "6.06" (VESC Tool's folder naming). */
export function fwKey(major: number, minor: number): string {
  return `${major}.${String(minor).padStart(2, '0')}`
}

const cache = new Map<string, Promise<ConfigDefs>>()

export function loadDefs(fw: string, kind: ConfigKind): Promise<ConfigDefs> | null {
  const path = `./defs/${fw}/${kind}.json`
  const load = modules[path]
  if (!load) return null
  let p = cache.get(path)
  if (!p) {
    p = load()
    cache.set(path, p)
    p.catch(() => cache.delete(path))
  }
  return p
}

type DefsResolution =
  | { status: 'ok'; defs: ConfigDefs }
  | { status: 'readonly'; defs: ConfigDefs; reason: string }
  | { status: 'unsupported'; reason: string }

/**
 * Picks definitions for a controller. Editing needs both a known firmware version
 * and a matching signature. A signature that matches another version's layout is
 * shown read-only; anything else can't be decoded at all.
 */
export async function resolveDefs(
  fw: { major: number; minor: number },
  kind: ConfigKind,
  signature: number,
): Promise<DefsResolution> {
  const key = fwKey(fw.major, fw.minor)
  const own = loadDefs(key, kind)
  if (own) {
    const defs = await own
    if (defs.signature === signature) return { status: 'ok', defs }
  }
  for (const v of [...SUPPORTED_FW].reverse()) {
    if (v === key) continue
    const defs = await loadDefs(v, kind)
    if (defs?.signature === signature) {
      return {
        status: 'readonly',
        defs,
        reason: own
          ? `This firmware ${key} build has a different settings layout than the release. It matches ${v}, so settings are shown read-only.`
          : `Firmware ${key} isn't supported yet. Its settings match ${v}, so they're shown read-only.`,
      }
    }
  }
  return {
    status: 'unsupported',
    reason: own
      ? `This firmware ${key} build has a settings layout Ohmic doesn't know (likely a beta). Settings can't be shown or changed.`
      : `Firmware ${key} isn't supported yet. Supported: ${SUPPORTED_FW.join(', ')}.`,
  }
}
