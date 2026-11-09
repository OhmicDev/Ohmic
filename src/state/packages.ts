// VESC packages: the official archive (through the app's server, since it's
// served over plain http), files opened from disk, and installing or removing
// one on a controller the way VESC Tool does it:
//   QML screen: erase and write it, or erase the old one if the package has none;
//   script: erase and write it, then start it, or erase the old one.
// A package's QML screen can't be shown in a browser; its settings (custom
// config) are edited in the package settings panel instead.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { qCompress } from '../lib/qcompress'
import { BufferWriter } from '../protocol/buffer'
import { lispStorageBlob, unpackLispProgram } from '../protocol/lisp'
import { readRcc } from '../packages/rcc'
import { sameBytes, unpackVescPackage, type VescPackage } from '../packages/vescpkg'
import { useCustomConfig } from './customConfig'
import { targetKey, targetLabel, type DeviceInfo } from './devices'
import { controllerErrorText } from './errors'
import { readStoredProgram, scriptMotionBlock, scriptSupport, writeStorage } from './lisp'
import { activeClient, useSession } from './session'

const ARCHIVE_URL = `${import.meta.env.BASE_URL}api/pkg/archive`
const NO_SERVER = 'The online package list needs the Ohmic server, and this site doesn’t have one. You can still open a .vescpkg file.'
/** VESC Tool's limit for a stored QML screen. */
const QML_MAX = 120 * 1024

type PackageSource = 'archive' | 'file' | 'demo'

export interface PackageEntry {
  id: string
  source: PackageSource
  pkg: VescPackage
}

interface InstalledState {
  checkedAt: number
  /** The stored script program, or null when there's none. */
  program: Uint8Array | null
  code: string | null
  /** Id of the listed package whose script is exactly what's stored. */
  matchId: string | null
  hasQml: boolean
  error: string | null
}

interface Busy {
  what: string
  progress: number | null
}

interface PackagesState {
  archive: { status: 'idle' | 'loading' | 'ready' | 'error'; entries: PackageEntry[]; error: string | null; fetchedAt: number | null }
  files: PackageEntry[]
  demo: PackageEntry[]
  installed: Record<string, InstalledState>
  busy: Busy | null
  error: string | null
  notice: string | null
  loadArchive: () => Promise<void>
  openFile: (file: File) => Promise<PackageEntry | null>
  setDemo: (entries: PackageEntry[]) => void
  checkInstalled: (target: Target) => Promise<void>
  install: (entry: PackageEntry, target: Target) => Promise<boolean>
  remove: (target: Target) => Promise<boolean>
  dismiss: () => void
}

/** The controller reports a stored package screen (QML app). */
const hasQmlScreen = (d: DeviceInfo) => (d.fw?.qmlApp ?? 0) > 0

/** Every package in an archive file, libraries marked, sorted by name. */
export async function packagesFromArchive(bytes: Uint8Array): Promise<PackageEntry[]> {
  const files = readRcc(bytes).filter((f) => /^\/vesc_packages\/[^/]+\/[^/]+\.vescpkg$/i.test(f.path))
  const out: PackageEntry[] = []
  for (const f of files) {
    try {
      const isLibrary = f.path.startsWith('/vesc_packages/lib_')
      out.push({ id: `archive:${f.path}`, source: 'archive', pkg: await unpackVescPackage(await f.read(), { isLibrary }) })
    } catch {
      // A damaged entry shouldn't hide the rest.
    }
  }
  return out.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
}

/** The QML screen as VESC Tool stores it: [u16 1 or 2 (fullscreen)][qCompressed QML with its imports]. */
async function qmlStorageBlob(qml: string, fullscreen: boolean): Promise<{ blob: Uint8Array; compressedLength: number }> {
  const text = 'import Vedder.vesc.vescinterface 1.0;import "qrc:/mobile";' + qml
  const compressed = await qCompress(new TextEncoder().encode(text))
  const vb = new BufferWriter().u16(fullscreen ? 2 : 1).raw(compressed).toUint8Array()
  return { blob: lispStorageBlob(vb), compressedLength: compressed.length }
}

export const usePackages = create<PackagesState>()((set, get) => {
  const allEntries = () => [...get().archive.entries, ...get().files, ...get().demo]

  const ready = (target: Target, action: string) => {
    const { devices, status } = useSession.getState()
    const client = activeClient()
    const info = devices.find((d) => d.target === target)
    const fail = (error: string) => (set({ error, notice: null }), null)
    if (status !== 'connected' || !client) return fail('Connect to a controller first.')
    if (get().busy) return fail('Wait for the current step to finish.')
    if (!info) return fail(`${targetLabel(target)} isn’t on this connection any more.`)
    const support = scriptSupport(info.fw)
    if (!support.ok) return fail(support.reason!)
    const moving = scriptMotionBlock(devices, action)
    if (moving) return fail(moving)
    return { client, info }
  }

  const afterChange = async (target: Target) => {
    // Give the package a moment to start and register its settings, then re-read what the devices report.
    await new Promise((r) => setTimeout(r, 500))
    await useSession.getState().rescanCan()
    useCustomConfig.getState().forget(target)
    await get().checkInstalled(target)
  }

  return {
    archive: { status: 'idle', entries: [], error: null, fetchedAt: null },
    files: [],
    demo: [],
    installed: {},
    busy: null,
    error: null,
    notice: null,

    loadArchive: async () => {
      if (get().archive.status === 'loading') return
      set((s) => ({ archive: { ...s.archive, status: 'loading', error: null } }))
      try {
        const res = await fetch(ARCHIVE_URL)
        const type = res.headers.get('content-type') ?? ''
        // A site with no Ohmic server behind it (GitHub Pages, say) answers with a web page.
        if (type.includes('text/html')) throw new Error(NO_SERVER)
        if (!res.ok) {
          const text = type.includes('json') ? ((await res.json()) as { message?: string }).message : null
          throw new Error(text || `The package server answered ${res.status}.`)
        }
        const entries = await packagesFromArchive(new Uint8Array(await res.arrayBuffer()))
        if (!entries.length) throw new Error('The archive had no packages in it.')
        set({ archive: { status: 'ready', entries, error: null, fetchedAt: Date.now() } })
      } catch (e) {
        const msg = e instanceof TypeError ? 'Couldn’t reach the package server. Check the connection; you can still open a .vescpkg file.' : controllerErrorText(e)
        set((s) => ({ archive: { ...s.archive, status: 'error', error: msg } }))
      }
    },

    openFile: async (file) => {
      try {
        const pkg = await unpackVescPackage(new Uint8Array(await file.arrayBuffer()))
        const entry: PackageEntry = { id: `file:${file.name}:${file.size}:${file.lastModified}`, source: 'file', pkg }
        set((s) => ({ files: [entry, ...s.files.filter((f) => f.id !== entry.id)], error: null, notice: `Opened ${pkg.name}.` }))
        return entry
      } catch (e) {
        set({ error: `${file.name}: ${controllerErrorText(e)}`, notice: null })
        return null
      }
    },

    setDemo: (demo) => set({ demo }),

    checkInstalled: async (target) => {
      const client = activeClient()
      const info = useSession.getState().devices.find((d) => d.target === target)
      if (!client || !info) return
      const key = targetKey(target)
      try {
        const program = await readStoredProgram(client, target)
        const match = program ? allEntries().find((e) => sameBytes(e.pkg.lispData, program)) : undefined
        set((s) => ({
          installed: {
            ...s.installed,
            [key]: {
              checkedAt: Date.now(),
              program,
              code: program ? unpackLispProgram(program).code : null,
              matchId: match?.id ?? null,
              hasQml: hasQmlScreen(info),
              error: null,
            },
          },
        }))
      } catch (e) {
        set((s) => ({
          installed: { ...s.installed, [key]: { checkedAt: Date.now(), program: null, code: null, matchId: null, hasQml: false, error: controllerErrorText(e) } },
        }))
      }
    },

    install: async (entry, target) => {
      const pkg = entry.pkg
      if (pkg.isLibrary) {
        set({ error: `${pkg.name} is a library: other packages’ scripts import it. It isn’t installed on its own.`, notice: null })
        return false
      }
      const r = ready(target, 'install a package')
      if (!r) return false
      const { client, info } = r
      set({ busy: { what: `Installing ${pkg.name}`, progress: null }, error: null, notice: null })
      const step = (what: string, progress: number | null = null) => set({ busy: { what, progress } })
      try {
        if (pkg.qmlFile) {
          const { blob, compressedLength } = await qmlStorageBlob(pkg.qmlFile, pkg.qmlFullscreen)
          if (blob.length > QML_MAX) throw new Error(`Its screen is ${blob.length.toLocaleString()} bytes; there’s room for ${QML_MAX.toLocaleString()}.`)
          step('Writing the package’s screen (for VESC Tool)', 0)
          await writeStorage({ erase: (n) => client.qmlErase(n, target), write: (o, d) => client.qmlWrite(o, d, target) }, blob, compressedLength + 100, (p) =>
            step('Writing the package’s screen (for VESC Tool)', p),
          )
        } else if (hasQmlScreen(info)) {
          step('Removing the previous package’s screen')
          if (!(await client.qmlErase(16, target))) throw new Error('The controller refused to erase the old screen.')
        }
        if (pkg.lispData) {
          const blob = lispStorageBlob(pkg.lispData)
          step('Writing the package’s script', 0)
          await writeStorage({ erase: (n) => client.lispErase(n, target), write: (o, d) => client.lispWrite(o, d, target) }, blob, pkg.lispData.length + 100, (p) =>
            step('Writing the package’s script', p),
          )
          step('Starting it')
          await client.lispSetRunning(true, target)
        } else {
          step('Removing the previous script')
          if (!(await client.lispErase(16, target))) throw new Error('The controller refused to erase the old script.')
        }
        step('Checking')
        await afterChange(target)
        set({ busy: null, notice: `Installed ${pkg.name} on ${targetLabel(target)}.` })
        return true
      } catch (e) {
        set({ busy: null, error: `Installing ${pkg.name} failed: ${controllerErrorText(e)} The controller may be left without a working package; install again or remove it.` })
        await get().checkInstalled(target).catch(() => {})
        return false
      }
    },

    remove: async (target) => {
      const r = ready(target, 'remove a package')
      if (!r) return false
      const { client, info } = r
      set({ busy: { what: 'Removing the package', progress: null }, error: null, notice: null })
      try {
        if (hasQmlScreen(info) && !(await client.qmlErase(16, target))) throw new Error('The controller refused to erase the package’s screen.')
        if (!(await client.lispErase(16, target))) throw new Error('The controller refused to erase the script.')
        await afterChange(target)
        set({ busy: null, notice: `${targetLabel(target)} has no package now.` })
        return true
      } catch (e) {
        set({ busy: null, error: `Removing failed: ${controllerErrorText(e)}` })
        return false
      }
    },

    dismiss: () => set({ error: null, notice: null }),
  }
})
