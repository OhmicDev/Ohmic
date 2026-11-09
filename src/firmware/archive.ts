// The firmware VESC Tool ships, matched to a controller's hardware name the way
// VESC Tool does it: a folder or file name lists every board it fits, joined by
// "_o_", compared without regard to case. The list is generated at build time
// (npm run gen:fw-index); files are downloaded only when chosen.

import { SUPPORTED_FW } from '../config/registry'
import rawIndex from './archiveIndex.json'

interface ArchiveIndex {
  firmwareBase: string
  bootloaderBase: string
  /** Newest first. Board folder → firmware files. */
  versions: { version: string; boards: Record<string, string[]> }[]
  bootloaders: string[]
}

const index = rawIndex as unknown as ArchiveIndex

interface ArchiveFile {
  version: string
  /** Archive folder, e.g. "410_o_411_o_412". */
  board: string
  file: string
  url: string
  /** Plain-language name of the build. */
  label: string
  /** Built without the hardware's current and voltage limits: experts only. */
  noHwLimits: boolean
  /** The standard build for this board. */
  standard: boolean
}

export interface ArchiveVersion {
  version: string
  /** Ohmic has settings definitions for it, so settings stay editable after updating. */
  configurable: boolean
  files: ArchiveFile[]
}

const boardNames = (name: string) => name.replace(/\.bin$/i, '').split('_o_')

export function fitsBoard(name: string, hwName: string): boolean {
  const hw = hwName.trim().toLowerCase()
  return !!hw && boardNames(name).some((n) => n.toLowerCase() === hw)
}

function fileLabel(file: string): string {
  if (file === 'VESC_default.bin') return 'Standard'
  if (file === 'VESC_default_no_hw_limits.bin') return 'No hardware limits'
  return `Variant: ${file.replace(/^VESC_/, '').replace(/\.bin$/i, '')}`
}

/** Every archive version that has firmware for this hardware, newest first. */
export function firmwareFor(hwName: string): ArchiveVersion[] {
  const out: ArchiveVersion[] = []
  for (const v of index.versions) {
    const board = Object.keys(v.boards).find((b) => fitsBoard(b, hwName))
    if (!board) continue
    const files = v.boards[board].map((file) => ({
      version: v.version,
      board,
      file,
      url: `${index.firmwareBase}${v.version}/${encodeURIComponent(board)}/${encodeURIComponent(file)}`,
      label: fileLabel(file),
      noHwLimits: /no_hw_limits/i.test(file),
      standard: file === 'VESC_default.bin',
    }))
    // Standard first, then variants, then the no-limits build last.
    files.sort((a, b) => Number(b.standard) - Number(a.standard) || Number(a.noHwLimits) - Number(b.noHwLimits) || a.file.localeCompare(b.file))
    out.push({ version: v.version, configurable: SUPPORTED_FW.includes(v.version), files })
  }
  return out
}

/** The version to offer first: the newest Ohmic can still configure, else the newest. */
export function suggestedVersion(versions: ArchiveVersion[]): ArchiveVersion | null {
  return versions.find((v) => v.configurable) ?? versions[0] ?? null
}

/** VESC Tool's bootloader for this hardware, or its generic one. */
export function bootloaderFor(hwName: string): { file: string; url: string; generic: boolean } {
  const own = index.bootloaders.find((f) => f !== 'generic.bin' && fitsBoard(f, hwName))
  const file = own ?? 'generic.bin'
  return { file, url: `${index.bootloaderBase}${encodeURIComponent(file)}`, generic: !own }
}

export type Fetcher = (url: string) => Promise<Response>

/** Downloads a firmware file. Throws a readable error. */
export async function downloadFirmware(url: string, fetcher: Fetcher = (u) => fetch(u)): Promise<Uint8Array> {
  let res: Response
  try {
    res = await fetcher(url)
  } catch {
    throw new Error('Couldn’t download the firmware. Check the internet connection and try again.')
  }
  if (!res.ok) throw new Error(`Couldn’t download the firmware (HTTP ${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}
