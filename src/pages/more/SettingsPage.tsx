import { Check, Minus, Plus } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../../appInfo'
import { LANGUAGES, useT } from '../../i18n'
import type { Chemistry, VehicleSetup } from '../../lib/vehicle'
import { ACCENTS, useSettings, type PollHz, type ThemePref } from '../../state/settings'
import type { BleChunkSize } from '../../transport/BleTransport'
import { BackLink, Button, PageTitle, Segmented } from '../../ui/Primitives'
import { Toggle } from '../../ui/Toggle'
import { DataPanel, DeveloperPanel } from './DataSection'

export function SettingsPage() {
  const s = useSettings()
  const t = useT()
  const jumps = [
    ['look', 'Look'],
    ['connection', 'Connection'],
    ['vehicle', 'Vehicle'],
    ['language', t('settings.language')],
    ['data', t('settings.data')],
    ['developer', t('settings.developer')],
    ['about', 'About'],
  ]
  return (
    <>
      <BackLink to="/more">More</BackLink>
      <PageTitle title="Settings" subtitle="How the app looks and connects, your vehicle, and your data." />
      <nav aria-label="Settings sections" className="-mt-1 mb-4 flex flex-wrap gap-1.5">
        {jumps.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="focus-ring rounded-full border border-line-strong px-3 py-1 text-xs text-muted transition-colors hover:border-text/25 hover:text-text"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Look" id="look">
          <Row label={t('settings.theme')}>
            <Segmented<ThemePref>
              label={t('settings.theme')}
              value={s.theme}
              onChange={s.setTheme}
              options={[
                { value: 'system', label: t('settings.theme.system') },
                { value: 'dark', label: t('settings.theme.dark') },
                { value: 'light', label: t('settings.theme.light') },
              ]}
            />
          </Row>
          <Row label="Accent colour" hint="Used for live values, charts and active controls.">
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  onClick={() => s.setAccent(a.value)}
                  aria-label={a.name}
                  aria-pressed={s.accent === a.value}
                  className="focus-ring flex size-8 items-center justify-center rounded-full border border-line-strong"
                  style={{ background: a.value }}
                >
                  {s.accent === a.value && <Check className="size-4 text-bg" strokeWidth={3} />}
                </button>
              ))}
              <label
                className="focus-ring relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-line-strong text-muted"
                title="Custom colour"
              >
                <Plus className="size-4" />
                <input
                  type="color"
                  value={s.accent}
                  onChange={(e) => s.setAccent(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Custom accent colour"
                />
              </label>
            </div>
          </Row>
          <Row label="Units">
            <Segmented
              label="Units"
              value={s.units}
              onChange={s.setUnits}
              options={[
                { value: 'metric', label: 'km · °C' },
                { value: 'imperial', label: 'mi · °F' },
              ]}
            />
          </Row>
        </Section>

        <Section title="Connection" id="connection">
          <Row
            label="Update rate"
            hint="Higher is smoother but uses more of the link. 50 Hz works over USB; Bluetooth stays at 20 Hz or less."
          >
            <Segmented<PollHz>
              label="Update rate"
              value={s.pollHz}
              onChange={s.setPollHz}
              options={[
                { value: 5, label: '5 Hz' },
                { value: 10, label: '10 Hz' },
                { value: 20, label: '20 Hz' },
                { value: 50, label: '50 Hz' },
              ]}
            />
          </Row>
          <Row
            label="Connect when the app opens"
            hint="Shows the Connect sheet and reconnects your last device when it’s nearby, like VESC Tool."
          >
            <Toggle checked={s.autoConnect} onChange={s.setAutoConnect} label="Connect when the app opens" />
          </Row>
          <Row label="Reconnect automatically" hint="If the cable or Bluetooth link drops, keep trying for a few minutes.">
            <Toggle checked={s.autoReconnect} onChange={s.setAutoReconnect} label="Reconnect automatically" />
          </Row>
          <Row
            label="Bluetooth write size"
            hint="128 bytes is faster for big transfers and works with VESC Express. Use 20 if a Bluetooth module stops answering."
          >
            <Segmented<BleChunkSize>
              label="Bluetooth write size"
              value={s.bleChunkSize}
              onChange={s.setBleChunkSize}
              options={[
                { value: 20, label: '20 B' },
                { value: 128, label: '128 B' },
              ]}
            />
          </Row>
        </Section>

        <Section
          title="Vehicle"
          id="vehicle"
          aside={
            <Button variant="ghost" className="h-8 px-2.5 text-xs" onClick={s.resetVehicle}>
              Reset
            </Button>
          }
        >
          <p className="-mt-1 mb-2 text-xs leading-relaxed text-faint">
            Used for speed, distance and battery %. Filled in from the main controller’s settings each time you connect; change them on the
            controller in Config.
          </p>
          <NumberRow label="Motor poles" k="motorPoles" step={2} min={2} max={120} />
          <NumberRow label="Wheel diameter" k="wheelDiameterMm" step={1} min={50} max={1000} unit="mm" />
          <NumberRow label="Gear ratio" k="gearRatio" step={0.1} min={0.1} max={50} digits={2} />
          <NumberRow label="Battery cells in series" k="batteryCells" step={1} min={3} max={40} unit="S" />
          <NumberRow label="Battery capacity" k="batteryAh" step={0.5} min={0.5} max={500} unit="Ah" digits={1} />
          <Row label="Battery chemistry">
            <Segmented<Chemistry>
              label="Battery chemistry"
              value={s.vehicle.batteryChemistry}
              onChange={(batteryChemistry) => s.updateVehicle({ batteryChemistry })}
              options={[
                { value: 'liion', label: 'Li-ion' },
                { value: 'lifepo4', label: 'LiFePO₄' },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.language')} id="language">
          <Row label={t('settings.language')} hint={t('settings.languageHint')}>
            <select
              value={s.language}
              onChange={(e) => s.setLanguage(e.target.value)}
              aria-label={t('settings.language')}
              className="focus-ring h-9 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title={t('settings.data')} id="data">
          <DataPanel />
        </Section>

        <Section title={t('settings.developer')} id="developer">
          <DeveloperPanel />
        </Section>

        <Section title="About" id="about">
          <div className="space-y-2 text-sm leading-relaxed text-muted">
            <p>
              <span className="wide font-semibold text-text">{APP_NAME}</span> · {APP_TAGLINE} · {APP_VERSION}
            </p>
            <p>
              Built on the open-source VESC firmware and VESC Tool by Benjamin Vedder and contributors (GPL-3.0). The settings list, limits
              and original help text come from VESC Tool’s parameter files. VESC is a registered trademark of Benjamin Vedder. This app is
              not affiliated with or endorsed by the VESC project.
            </p>
            <p>{APP_NAME} is free software under the GNU General Public License, version 3 or later.</p>
            <Button variant="ghost" className="-ml-3 h-9" onClick={() => s.setOnboarded(false)}>
              {t('settings.intro')}
            </Button>
          </div>
        </Section>
      </div>
    </>
  )
}

function Section({ title, id, aside, children }: { title: string; id: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card scroll-mt-20 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 id={`${id}-title`} className="label">
          {title}
        </h2>
        {aside}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 max-w-xs text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

type NumericKey = {
  [K in keyof VehicleSetup]: VehicleSetup[K] extends number ? K : never
}[keyof VehicleSetup]

function NumberRow({
  label,
  k,
  step,
  min,
  max,
  unit,
  digits = 0,
}: {
  label: string
  k: NumericKey
  step: number
  min: number
  max: number
  unit?: string
  digits?: number
}) {
  const value = useSettings((s) => s.vehicle[k])
  const update = useSettings((s) => s.updateVehicle)
  const id = useId()
  const errId = useId()
  // What's typed, while it's being typed; a value outside the range is shown as an error, never changed.
  const [text, setText] = useState<string | null>(null)
  const round = (v: number) => Number(v.toFixed(digits))
  const commit = (v: number) => update({ [k]: round(v) } as Partial<VehicleSetup>)
  const typed = text === null ? value : Number(text.replace(',', '.'))
  const error =
    text === null
      ? null
      : !text.trim() || !Number.isFinite(typed)
        ? 'Enter a number.'
        : typed < min || typed > max
          ? `Between ${min} and ${max}${unit ? ` ${unit}` : ''}.`
          : null
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <StepButton onClick={() => commit(value - step)} label={`Decrease ${label}`} disabled={round(value - step) < min}>
            <Minus className="size-3.5" />
          </StepButton>
          <div
            className={`flex h-9 items-center rounded-lg border bg-surface-2 pr-2.5 focus-within:border-accent/50 ${error ? 'border-danger/60' : 'border-line'}`}
          >
            <input
              id={id}
              type="text"
              inputMode="decimal"
              value={text ?? String(value)}
              aria-invalid={!!error}
              aria-describedby={error ? errId : undefined}
              onChange={(e) => {
                const next = e.target.value
                setText(next)
                const n = Number(next.replace(',', '.'))
                if (next.trim() && Number.isFinite(n) && n >= min && n <= max) commit(n)
              }}
              onBlur={() => setText(null)}
              className="num w-20 bg-transparent px-2.5 text-right text-sm font-medium outline-none"
            />
            {unit && <span className="text-xs text-muted">{unit}</span>}
          </div>
          <StepButton onClick={() => commit(value + step)} label={`Increase ${label}`} disabled={round(value + step) > max}>
            <Plus className="size-3.5" />
          </StepButton>
        </div>
      </div>
      {error && (
        <p id={errId} className="mt-1 text-right text-xs text-danger" role="alert">
          {error} Kept at {value}
          {unit ? ` ${unit}` : ''}.
        </p>
      )}
    </div>
  )
}

function StepButton({
  onClick,
  label,
  children,
  disabled,
}: {
  onClick: () => void
  label: string
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className="focus-ring flex size-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-muted transition-colors hover:text-text disabled:opacity-35"
    >
      {children}
    </button>
  )
}
