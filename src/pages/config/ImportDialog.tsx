import { AlertTriangle, Check, FileUp } from 'lucide-react'
import { sameOnWire } from '../../config/codec'
import type { ConfigDefs, ConfigValues } from '../../config/types'
import type { ImportResult } from '../../config/xmlFile'
import { Dialog } from '../../ui/Dialog'
import { Button } from '../../ui/Primitives'
import { describeValue } from './describe'

export interface PendingImport {
  fileName: string
  result: ImportResult | null
  error: string | null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Shows what a VESC Tool file would change before it goes into the edits. */
export function ImportDialog({
  pending,
  defs,
  draft,
  onClose,
  onApply,
}: {
  pending: PendingImport | null
  defs: ConfigDefs | null
  draft: ConfigValues | null
  onClose: () => void
  onApply: (values: ConfigValues) => void
}) {
  const r = pending?.result
  const changes = r && defs && draft ? Object.keys(r.values).filter((n) => !sameOnWire(defs.params[n], r.values[n], draft[n])) : []

  return (
    <Dialog
      open={!!pending}
      onClose={onClose}
      title="Import settings file"
      subtitle={pending?.fileName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!r || changes.length === 0}
            onClick={() => {
              if (!r) return
              onApply(Object.fromEntries(changes.map((n) => [n, r.values[n]])))
              onClose()
            }}
          >
            <FileUp className="size-4" />
            {changes.length ? `Add ${plural(changes.length, 'change')} to my edits` : 'Nothing to change'}
          </Button>
        </>
      }
    >
      {pending?.error ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {pending.error}
        </p>
      ) : r && defs && draft ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Nothing is written yet. The file’s values go into your edits, so you can look them over and then write them with the usual review and
            backup.
          </p>
          {changes.length === 0 ? (
            <p className="flex items-center gap-2 text-ok">
              <Check className="size-4" /> The file matches your current settings.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
              <table className="w-full">
                <tbody>
                  {changes.map((n) => (
                    <tr key={n} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5">{defs.params[n].label}</td>
                      <td className="num px-3 py-1.5 text-right whitespace-nowrap">
                        <span className="text-muted">{describeValue(defs.params[n], draft[n])}</span> →{' '}
                        <span className="font-semibold text-accent">{describeValue(defs.params[n], r.values[n])}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.invalid.length > 0 && (
            <div className="rounded-xl border border-warn/30 bg-warn/5 p-3 text-warn">
              <p className="font-medium">{plural(r.invalid.length, 'value')} skipped because they can’t be used:</p>
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {r.invalid.map((i) => (
                  <li key={i.name}>
                    {defs.params[i.name]?.label ?? i.name}: {i.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(r.unknown.length > 0 || r.missing.length > 0) && (
            <p className="text-xs text-muted">
              {r.unknown.length > 0 && `${plural(r.unknown.length, 'setting')} in the file don’t exist in this firmware and were ignored. `}
              {r.missing.length > 0 && `${plural(r.missing.length, 'setting')} aren’t in the file and keep their current value.`}
            </p>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}
