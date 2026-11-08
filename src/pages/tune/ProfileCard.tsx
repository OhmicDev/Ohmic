import { BatteryMedium, CircleAlert, MessageSquareText, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { packChargeLimitA, packLimitA, parseProfileField, PROFILE_RULES, useProfile, VEHICLE_TYPES, type ProfileField, type VehicleProfile } from '../../ai/profile'
import { fmt } from '../../lib/format'
import { Button } from '../../ui/Primitives'

const GROUPS: { title: string; fields: ProfileField[] }[] = [
  { title: 'Battery', fields: ['cells_series', 'cells_parallel', 'cell_model', 'cell_continuous_a', 'cell_charge_a', 'bms_limit_a', 'pack_ah'] },
  { title: 'Vehicle and motor', fields: ['vehicle_type', 'motor_model', 'motor_rated_w', 'wheel_diameter_mm', 'rider_weight_kg'] },
  { title: 'Riding', fields: ['terrain', 'riding_style', 'region'] },
]

const VEHICLE_LABEL: Record<string, string> = { scooter: 'Scooter', ebike: 'E-bike', skateboard: 'Skateboard', onewheel: 'Onewheel', other: 'Other' }

function shown(p: VehicleProfile, f: ProfileField): string | null {
  const v = p[f]
  if (v === null || v === undefined || v === '') return null
  if (f === 'vehicle_type') return VEHICLE_LABEL[String(v)] ?? String(v)
  const u = PROFILE_RULES[f].unit
  return typeof v === 'number' ? `${fmt(v, Number.isInteger(v) ? 0 : 1)}${u ? ` ${u}` : ''}` : String(v)
}

export function ProfileCard() {
  const { profile, loaded, load, update } = useProfile()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => void load(), [load])

  const limit = packLimitA(profile)
  const charge = packChargeLimitA(profile)

  const start = () => {
    setDraft(Object.fromEntries(GROUPS.flatMap((g) => g.fields).map((f) => [f, profile[f] === null ? '' : String(profile[f])])))
    setErrors([])
    setEditing(true)
  }
  const save = async () => {
    const patch: Partial<VehicleProfile> = {}
    const errs: string[] = []
    for (const f of GROUPS.flatMap((g) => g.fields)) {
      const now = profile[f] === null ? '' : String(profile[f])
      if ((draft[f] ?? '') === now) continue
      const r = parseProfileField(f, draft[f] ?? '')
      if ('error' in r) errs.push(r.error)
      else (patch as Record<string, unknown>)[f] = r.value
    }
    setErrors(errs)
    if (errs.length) return
    // Saving confirms what the assistant filled in.
    for (const f of profile.fromChat) if (!(f in patch)) (patch as Record<string, unknown>)[f] = profile[f]
    if (Object.keys(patch).length) await update(patch)
    setEditing(false)
  }

  return (
    <section className="card p-4" aria-labelledby="profile-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="profile-title" className="label">
          Vehicle profile
        </h2>
        {!editing && (
          <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={start} disabled={!loaded}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">What the controller can’t report. The assistant asks for what it needs and saves it here.</p>

      <div className="mb-3 flex gap-2.5 rounded-xl border border-line bg-surface-2/60 p-3 text-xs leading-relaxed">
        <BatteryMedium className="mt-0.5 size-4 shrink-0 text-accent" />
        {limit ? (
          <span>
            Your pack can give about <span className="num font-semibold text-text">{fmt(limit.amps, 0)} A</span> continuously ({limit.from})
            {charge ? (
              <>
                {' '}
                and take <span className="num font-semibold text-text">{fmt(charge, 0)} A</span> of regen
              </>
            ) : null}
            . Battery current is never raised above it.
          </span>
        ) : (
          <span className="text-muted">
            Pack limit unknown: battery current won’t be raised until you add the cells in parallel and their rating, or the BMS limit.
          </span>
        )}
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="mt-3 first-of-type:mt-0">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{g.title}</h3>
          <dl className="divide-y divide-line">
            {g.fields.map((f) => {
              const rule = PROFILE_RULES[f]
              const value = shown(profile, f)
              return (
                <div key={f} className="flex items-center justify-between gap-3 py-1.5">
                  <dt className="text-[13px] text-muted">
                    <label htmlFor={editing ? `pf-${f}` : undefined}>{rule.label}</label>
                  </dt>
                  <dd className="flex min-w-0 items-center gap-1.5 text-right text-[13px]">
                    {editing ? (
                      f === 'vehicle_type' ? (
                        <select
                          id={`pf-${f}`}
                          value={draft[f] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                          className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-[13px] outline-none focus:border-accent/60"
                        >
                          <option value="">Not set</option>
                          {VEHICLE_TYPES.map((v) => (
                            <option key={v} value={v}>
                              {VEHICLE_LABEL[v]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="flex items-center gap-1">
                          <input
                            id={`pf-${f}`}
                            value={draft[f] ?? ''}
                            onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                            inputMode={rule.text ? 'text' : 'decimal'}
                            placeholder="—"
                            className={`h-8 rounded-lg border border-line bg-surface-2 px-2 text-right text-[13px] outline-none focus:border-accent/60 ${rule.text ? 'w-36' : 'num w-20'}`}
                          />
                          {rule.unit && <span className="w-5 text-left text-[11px] text-muted">{rule.unit}</span>}
                        </span>
                      )
                    ) : value ? (
                      <>
                        <span className="truncate font-medium">{value}</span>
                        {profile.fromChat.includes(f) && (
                          <MessageSquareText className="size-3.5 shrink-0 text-accent" aria-label="From the chat: check it’s right" />
                        )}
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      ))}

      {!editing && profile.fromChat.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <MessageSquareText className="size-3.5 text-accent" /> From the chat. Check these are right; edit to confirm.
        </p>
      )}
      {editing && (
        <div className="mt-3 space-y-2">
          {errors.length > 0 && (
            <ul className="space-y-1 text-xs text-danger" role="alert">
              {errors.map((e) => (
                <li key={e} className="flex gap-1.5">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {e}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button variant="primary" className="h-9" onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" className="h-9" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
