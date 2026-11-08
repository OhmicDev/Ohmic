import { useId } from 'react'
import { useSettings } from '../../state/settings'
import { Toggle } from '../../ui/Toggle'

/** What AI Tune sends and the switches for it (Tune page and Settings). */
export function AiPrivacy({ compact = false }: { compact?: boolean }) {
  const ai = useSettings((s) => s.ai)
  const setAi = useSettings((s) => s.setAi)
  const codeId = useId()
  return (
    <div className="divide-y divide-line">
      {!compact && (
        <p className="pb-3 text-xs leading-relaxed text-muted">
          When you send a message, Ohmic sends it to the AI server this app uses, which passes it to Anthropic’s Claude. With it go the things the assistant
          asks for: your controller’s model, firmware and settings, your vehicle profile and, if allowed below, live data, ride summaries (no map positions)
          and fault history. Nothing goes anywhere until you send a message, and the scripted demo runs on this device only.
        </p>
      )}
      <Switch label="AI Tune" hint="Off hides the assistant and sends nothing." checked={ai.enabled} onChange={(enabled) => setAi({ enabled })} />
      <Switch label="Share live data" hint="Speed, current, voltage and temperatures from the last minute." checked={ai.shareLive} onChange={(shareLive) => setAi({ shareLive })} disabled={!ai.enabled} />
      <Switch label="Share ride logs" hint="Summaries of recorded rides: peaks, sag, temperatures, faults." checked={ai.shareRides} onChange={(shareRides) => setAi({ shareRides })} disabled={!ai.enabled} />
      <Switch label="Share fault history" hint="Faults and the readings just before each one." checked={ai.shareFaults} onChange={(shareFaults) => setAi({ shareFaults })} disabled={!ai.enabled} />
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <label htmlFor={codeId} className="text-sm font-medium">
            Access code
          </label>
          <div className="mt-0.5 max-w-xs text-xs text-muted">Only if your AI server asks for one.</div>
        </div>
        <input
          id={codeId}
          type="password"
          autoComplete="off"
          value={ai.accessCode}
          onChange={(e) => setAi({ accessCode: e.target.value })}
          disabled={!ai.enabled}
          className="h-9 w-40 rounded-lg border border-line bg-surface-2 px-2.5 text-sm outline-none focus:border-accent/60 disabled:opacity-40"
        />
      </div>
    </div>
  )
}

function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 max-w-xs text-xs text-muted">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}
