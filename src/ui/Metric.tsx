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
    <div className="card relative flex flex-col overflow-hidden p-3.5 pb-0 md:p-4 md:pb-0">
      <div className="label flex items-center gap-2">
        {tone !== 'normal' && <span className={cx('size-1.5 rounded-full', tone === 'warn' ? 'bg-warn' : 'bg-danger')} />}
        {label}
      </div>
      <div className={cx('mt-2 flex items-baseline gap-1.5', toneText[tone])}>
        <TweenNumber value={value} digits={digits} className="num text-[28px] leading-none font-semibold tracking-tight sm:text-[34px] lg:text-[38px]" />
        {unit && <span className="text-sm font-medium text-muted">{unit}</span>}
      </div>
      <div className="num mt-1.5 min-h-4 truncate text-xs text-muted">{hint}</div>
      {spark ? (
        <Sparkline k={spark} color={toneColor[tone]} className="pointer-events-none -mx-3.5 mt-1 h-7 w-[calc(100%+28px)] opacity-80 md:-mx-4 md:h-8 md:w-[calc(100%+32px)]" />
      ) : (
        <div className="h-3 md:h-4" />
      )}
    </div>
  )
}
