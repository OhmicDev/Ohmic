// Each ride mode's colour and icon, picked from its name, so Eco reads green and
// Sport red wherever modes appear. Modes with other names take the next spare colour.

import { Flag, Flame, Gauge, Leaf, Mountain, Route, Sparkles, Sprout, type LucideIcon } from 'lucide-react'
import type { RideMode } from '../../lib/rideModes'

const LOOKS: { match: RegExp; icon: LucideIcon; color: string }[] = [
  { match: /eco|range|save/i, icon: Leaf, color: '#34c77b' },
  { match: /begin|learn|kid/i, icon: Sprout, color: '#1abc9c' },
  { match: /normal|commute|city|daily/i, icon: Gauge, color: '#4c9be8' },
  { match: /hill|climb|off/i, icon: Mountain, color: '#f39c12' },
  { match: /sport|race|turbo|boost/i, icon: Flame, color: '#ef5b4c' },
  { match: /track|max|full/i, icon: Flag, color: '#e0493b' },
  { match: /route|tour/i, icon: Route, color: '#4c9be8' },
]
const SPARE = ['#b07ce6', '#1abc9c', '#f39c12', '#4c9be8']

export function modeLook(m: Pick<RideMode, 'name'>, i: number): { icon: LucideIcon; color: string } {
  return (
    LOOKS.find((l) => l.match.test(m.name)) ?? {
      icon: Sparkles,
      color: SPARE[i % SPARE.length],
    }
  )
}
