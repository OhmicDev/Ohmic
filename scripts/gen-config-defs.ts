// Turns VESC Tool's parameter XML (vendor/vesc_tool/config/<fw>/) into the JSON
// definitions the app loads (src/config/defs/<fw>/<kind>.json).
// Run with: npm run gen:config   (Node 22.18+ runs TypeScript directly)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertParamXml } from '../src/config/paramXml.ts'

const here = dirname(fileURLToPath(import.meta.url))
const vendorDir = join(here, '..', 'vendor', 'vesc_tool', 'config')
const outDir = join(here, '..', 'src', 'config', 'defs')

const versions = readdirSync(vendorDir).filter((v) => /^\d+\.\d+$/.test(v)).sort()
for (const fw of versions) {
  mkdirSync(join(outDir, fw), { recursive: true })
  for (const kind of ['mcconf', 'appconf'] as const) {
    const xml = readFileSync(join(vendorDir, fw, `parameters_${kind}.xml`), 'utf8')
    const defs = convertParamXml(xml, kind, fw)
    writeFileSync(join(outDir, fw, `${kind}.json`), JSON.stringify(defs) + '\n')
    console.log(`${fw} ${kind}: ${defs.order.length} fields, signature ${defs.signature}`)
  }
}
