import type { ReactNode } from 'react'
import { cx } from '../lib/format'
import type { HistoryKey } from '../state/telemetry'
import { Sparkline } from './Sparkline'
import { TweenNumber } from './TweenNumber'

export type Tone = 'normal' | 'warn' | 'danger'

const toneText: Record<Tone, string> = {
  normal: 'text-text',
  warn: 'text-warn',
  danger: 'text-danger',
}
const toneColor: Record<Tone, string> = {
  normal: 'var(--accent)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
}

export function Metric({
  label,
  value,
  digits = 0,
  unit,
  hint,
  spark,
  tone = 'normal',
}: {
  label: string
  value: number | null
  digits?: number
  unit?: string
  hint?: ReactNode
  spark?: HistoryKey
  tone?: Tone
}) {
  return (
    <div className="card relative overflow-hidden p-4 pb-3">
      <div className="label flex items-center gap-2">
        {tone !== 'normal' && <span className={cx('size-1.5 rounded-full', tone === 'warn' ? 'bg-warn' : 'bg-danger')} />}
        {label}
      </div>
      <div className={cx('mt-2 flex items-baseline gap-1.5', toneText[tone])}>
        <TweenNumber value={value} digits={digits} className="num glow text-[34px] leading-none font-semibold tracking-tight sm:text-[38px]" />
        {unit && <span className="text-sm font-medium text-muted">{unit}</span>}
      </div>
      <div className="num text-halo relative z-[1] mt-1.5 min-h-4 text-xs text-muted">{hint}</div>
      {spark && (
        <Sparkline k={spark} color={toneColor[tone]} className="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full opacity-80" />
      )}
    </div>
  )
}
