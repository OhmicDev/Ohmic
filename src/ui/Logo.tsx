export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--color-surface-3)" stroke="var(--color-line-strong)" />
      <path
        d="M22.5 9.2A9 9 0 1 0 25 16"
        fill="none"
        stroke="var(--color-text)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M17.6 9.5 12.4 17h4.1l-1.6 5.6 5.6-7.9h-4.2l1.3-5.2Z" fill="var(--accent)" />
    </svg>
  )
}
