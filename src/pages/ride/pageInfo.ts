import { CircleGauge, Focus, LayoutGrid, type LucideIcon } from 'lucide-react'
import type { PageId } from '../../state/dashboard'

/** The dashboard's pages as the rider sees them. */
export const PAGES: Record<PageId, { label: string; icon: LucideIcon; about: string }> = {
  gauges: { label: 'Gauges', icon: CircleGauge, about: 'Round dials' },
  tiles: { label: 'Tiles', icon: LayoutGrid, about: 'Readings and graphs' },
  focus: { label: 'Focus', icon: Focus, about: 'One big number' },
}

/** The outline of anything that can be moved or changed while the dashboard is being arranged. */
export const editRing = 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_40%,transparent)]'
