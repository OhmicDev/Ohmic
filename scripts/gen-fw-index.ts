// Lists the firmware VESC Tool ships, so the app can offer it without asking
// GitHub's (rate-limited) API at run time. Only the chosen file is downloaded,
// straight from raw.githubusercontent.com, which browsers may fetch from.
//   - Firmware: https://github.com/vedderb/vesc_fw_archive  (<version>/<hw>/<file>.bin)
//   - Bootloaders: https://github.com/vedderb/vesc_tool  (res/bootloaders/<hw>.bin)
// A folder or file name lists every hardware it fits, joined by "_o_".
// Run with: npm run gen:fw-index   (needs network access to GitHub)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outFile = join(here, '..', 'src', 'firmware', 'archiveIndex.json')

/** Motor controller firmware from this version on (older releases predate the current config layouts). */
const OLDEST = [6, 0]

interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
}

async function tree(repo: string, branch: string): Promise<TreeEntry[]> {
  const res = await fetch(`https://api.github.com/repos/vedderb/${repo}/git/trees/${branch}?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ohmic-build' },
  })
  if (!res.ok) throw new Error(`${repo}: HTTP ${res.status}`)
  const body = (await res.json()) as { tree: TreeEntry[]; truncated: boolean }
  if (body.truncated) throw new Error(`${repo}: the file list was truncated`)
  return body.tree
}

const archive = await tree('vesc_fw_archive', 'main')
const versions = new Map<string, Map<string, string[]>>()
for (const e of archive) {
  const m = /^(\d+)\.(\d\d)\/([^/]+)\/([^/]+\.bin)$/.exec(e.path)
  if (!m || e.type !== 'blob') continue
  const [major, minor] = [Number(m[1]), Number(m[2])]
  if (major < OLDEST[0] || (major === OLDEST[0] && minor < OLDEST[1])) continue
  const version = `${m[1]}.${m[2]}`
  const boards = versions.get(version) ?? new Map<string, string[]>()
  boards.set(m[3], [...(boards.get(m[3]) ?? []), m[4]])
  versions.set(version, boards)
}

const tool = await tree('vesc_tool', 'master')
const bootloaders = tool
  .filter((e) => e.type === 'blob' && /^res\/bootloaders\/[^/]+\.bin$/.test(e.path))
  .map((e) => e.path.slice('res/bootloaders/'.length))

const out = {
  firmwareBase: 'https://raw.githubusercontent.com/vedderb/vesc_fw_archive/main/',
  bootloaderBase: 'https://raw.githubusercontent.com/vedderb/vesc_tool/master/res/bootloaders/',
  versions: [...versions.entries()]
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([version, boards]) => ({
      version,
      boards: Object.fromEntries([...boards.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, files]) => [dir, files.sort()])),
    })),
  bootloaders,
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(out) + '\n')
console.log(`Wrote ${outFile}: ${out.versions.map((v) => `${v.version} (${Object.keys(v.boards).length} boards)`).join(', ')}; ${bootloaders.length} bootloaders`)
