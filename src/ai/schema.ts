// Checks a tool's input against its JSON schema before the tool runs. Covers the
// subset the tools use (agentSpec.ts). Returns the first problem, or null.

import type { JsonSchema } from './agentSpec'

export function schemaProblem(schema: JsonSchema, value: unknown, path = 'input'): string | null {
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} must be an object`
      const rec = value as Record<string, unknown>
      const props = schema.properties ?? {}
      for (const r of schema.required ?? []) if (!(r in rec)) return `${path}.${r} is missing`
      for (const [k, v] of Object.entries(rec)) {
        const sub = props[k]
        if (!sub) {
          if (schema.additionalProperties === false) return `${path}.${k} is not allowed`
          continue
        }
        const p = schemaProblem(sub, v, `${path}.${k}`)
        if (p) return p
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be a list`
      if (!schema.items) return null
      for (let i = 0; i < value.length; i++) {
        const p = schemaProblem(schema.items, value[i], `${path}[${i}]`)
        if (p) return p
      }
      return null
    }
    case 'string':
      if (typeof value !== 'string') return `${path} must be text`
      if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}`
      return null
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${path} must be a number`
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : `${path} must be a whole number`
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path} must be true or false`
  }
}
