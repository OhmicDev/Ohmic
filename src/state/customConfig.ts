// Settings a package or custom hardware adds (custom configs). The controller
// describes them in VESC Tool's parameter XML, so they get the same editor rows,
// checks and write steps as the motor and app settings, with their own backups.

import { create } from 'zustand'
import type { Target } from '../client/VescClient'
import { decodeConfig, xmlDefaults } from '../config/codec'
import { convertParamXml } from '../config/paramXml'
import type { ConfigDefs, ConfigValue, ConfigValues } from '../config/types'
import { makeItem, type WriteItem, type WriteOutcome } from '../config/write'
import { qUncompress } from '../lib/qcompress'
import { CUSTOM_XML_CHUNK } from '../protocol/customConfig'
import { deviceKey, deviceName } from './config'
import { db } from './db'
import { targetKey } from './devices'
import { controllerErrorText } from './errors'
import { scriptSupport } from './lisp'
import { activeClient, useSession } from './session'

export interface CustomConfig {
  /** `${device key}#${index}` */
  key: string
  deviceKey: string
  target: Target
  index: number
  deviceName: string
  name: string
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** Read-only on firmware this app doesn't know. */
  readOnly: boolean
  defs: ConfigDefs | null
  device: ConfigValues | null
  defaults: ConfigValues | null
  draft: ConfigValues | null
}

interface CustomConfigState {
  configs: Record<string, CustomConfig>
  load: (target: Target, index: number) => Promise<void>
  edit: (key: string, name: string, value: ConfigValue) => void
  setDraft: (key: string, values: ConfigValues) => void
  discard: (key: string) => void
  /** The reviewed write for this config's edits, for the write dialog. */
  writeItem: (key: string) => WriteItem | null
  /** Drops what was read from a device (after a package change). */
  forget: (target: Target) => void
}

export const customKey = (devKey: string, index: number) => `${devKey}#${index}`

/** Reads and unpacks the XML describing one custom config. */
async function readXml(target: Target, index: number): Promise<string> {
  const client = activeClient()
  if (!client) throw new Error('Not connected.')
  const first = await client.customConfigXmlChunk(index, CUSTOM_XML_CHUNK, 0, target)
  if (first.total <= 0 || first.total > 4 * 1024 * 1024) throw new Error('The controller described no settings.')
  const all = new Uint8Array(first.total)
  all.set(first.data.subarray(0, first.total))
  let have = Math.min(first.data.length, first.total)
  while (have < first.total) {
    const part = await client.customConfigXmlChunk(index, CUSTOM_XML_CHUNK, have, target)
    if (part.offset !== have || !part.data.length) throw new Error('The settings description arrived out of order.')
    all.set(part.data.subarray(0, first.total - have), have)
    have += part.data.length
  }
  return new TextDecoder().decode(await qUncompress(all))
}

export const useCustomConfig = create<CustomConfigState>()((set, get) => ({
  configs: {},

  load: async (target, index) => {
    const info = useSession.getState().devices.find((d) => d.target === target)
    const client = activeClient()
    if (!info || !client) return
    const dk = deviceKey(info)
    const key = customKey(dk, index)
    const base: CustomConfig = {
      key,
      deviceKey: dk,
      target,
      index,
      deviceName: deviceName(info),
      name: `Settings ${index + 1}`,
      status: 'loading',
      error: null,
      readOnly: !scriptSupport(info.fw).ok,
      defs: null,
      device: null,
      defaults: null,
      draft: null,
    }
    set((s) => ({ configs: { ...s.configs, [key]: { ...base, ...(s.configs[key]?.defs ? s.configs[key] : {}), status: 'loading', error: null } } }))
    try {
      const xml = await readXml(target, index)
      const defs = convertParamXml(xml, 'appconf', `custom:${index}`)
      const device = decodeConfig(defs, await client.getCustomConfig(index, { target }))
      const defaults = await client
        .getCustomConfig(index, { target, defaults: true })
        .then((b) => decodeConfig(defs, b))
        .catch(() => xmlDefaults(defs))
      const name = defs.groups[0]?.name || base.name
      set((s) => ({ configs: { ...s.configs, [key]: { ...base, name, status: 'ready', defs, device, defaults, draft: { ...device } } } }))
    } catch (e) {
      set((s) => ({ configs: { ...s.configs, [key]: { ...base, status: 'error', error: `Couldn’t read these settings: ${controllerErrorText(e)}` } } }))
    }
  },

  edit: (key, name, value) =>
    set((s) => {
      const c = s.configs[key]
      if (!c?.draft || c.readOnly) return s
      return { configs: { ...s.configs, [key]: { ...c, draft: { ...c.draft, [name]: value } } } }
    }),

  setDraft: (key, values) =>
    set((s) => {
      const c = s.configs[key]
      if (!c?.draft || c.readOnly) return s
      return { configs: { ...s.configs, [key]: { ...c, draft: { ...c.draft, ...values } } } }
    }),

  discard: (key) =>
    set((s) => {
      const c = s.configs[key]
      return c?.device ? { configs: { ...s.configs, [key]: { ...c, draft: { ...c.device } } } } : s
    }),

  writeItem: (key) => {
    const c = get().configs[key]
    if (!c || c.status !== 'ready' || !c.defs || !c.device || !c.draft || c.readOnly) return null
    const { target, index, defs } = c
    const uuid = useSession.getState().devices.find((d) => d.target === target)?.fw?.uuid || null
    return makeItem({
      key: c.deviceKey,
      target,
      deviceName: c.deviceName,
      kind: 'appconf', // unused: the custom read and write below are what run
      defs,
      before: c.device,
      after: { ...c.draft },
      custom: {
        label: `${c.name} (package)`,
        read: () => {
          const client = activeClient()
          if (!client) throw new Error('Not connected.')
          return client.getCustomConfig(index, { target })
        },
        write: (body) => {
          const client = activeClient()
          if (!client) throw new Error('Not connected.')
          return client.setCustomConfig(index, body, { target })
        },
        backup: (item, current) =>
          db.packageBackups.add({
            createdAt: Date.now(),
            deviceUuid: uuid,
            deviceName: item.deviceName,
            configName: c.name,
            signature: defs.signature,
            changes: item.changes.map((ch) => ({ ...ch, label: defs.params[ch.name]?.label ?? ch.name })),
            raw: current.raw,
            values: current.values,
          } as Parameters<typeof db.packageBackups.add>[0]) as Promise<number>,
        onWritten: (outcome: WriteOutcome) => {
          if (outcome.status === 'ok' || outcome.status === 'adjusted' || outcome.status === 'stale') {
            set((s) => {
              const cur = s.configs[key]
              if (!cur) return s
              // After a write the editor shows what the controller holds; a stale read keeps the edits on top.
              const draft = outcome.status === 'stale' ? { ...outcome.values, ...diffOnly(cur.device!, cur.draft!) } : { ...outcome.values }
              return { configs: { ...s.configs, [key]: { ...cur, device: outcome.values, draft } } }
            })
          }
        },
      },
    })
  },

  forget: (target) =>
    set((s) => ({
      configs: Object.fromEntries(Object.entries(s.configs).filter(([, c]) => targetKey(c.target) !== targetKey(target))),
    })),
}))

function diffOnly(before: ConfigValues, after: ConfigValues): ConfigValues {
  return Object.fromEntries(Object.entries(after).filter(([k, v]) => before[k] !== v))
}
