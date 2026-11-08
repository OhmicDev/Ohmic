export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const fixed = n.toFixed(digits)
  // Avoid showing "-0".
  return /^-0(\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed
}

export function fmtThousands(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
