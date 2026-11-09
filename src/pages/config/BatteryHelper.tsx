import { BatteryMedium } from 'lucide-react'
import { useState } from 'react'
import { formatNumber } from '../../config/display'
import type { ConfigValues } from '../../config/types'
import { Button, Segmented } from '../../ui/Primitives'

type Chem = 'liion' | 'lifepo4'
type Style = 'gentle' | 'balanced' | 'range'

/** Per-cell [start, end] voltages. Gentle keeps more in reserve; Max range drains deeper. */
const PER_CELL: Record<Chem, Record<Style, [number, number]>> = {
  liion: { gentle: [3.5, 3.3], balanced: [3.4, 3.1], range: [3.3, 3.0] },
  lifepo4: { gentle: [3.1, 2.9], balanced: [3.0, 2.8], range: [2.9, 2.6] },
}

const STYLE_TEXT: Record<Style, string> = {
  gentle: 'Stops early, keeping the cells well away from empty. Best for battery life.',
  balanced: 'A sensible middle ground for most riders.',
  range: 'Uses more of the pack. Cells age faster if you ride it down often.',
}

/** Works out battery cut-off voltages from the pack instead of guessing numbers. */
export function BatteryHelper({ draft, readOnly, onApply }: { draft: ConfigValues; readOnly: boolean; onApply: (patch: ConfigValues) => void }) {
  const [cells, setCells] = useState(() => Number(draft.si_battery_cells) || 13)
  const [chem, setChem] = useState<Chem>(() => (draft.si_battery_type === 1 ? 'lifepo4' : 'liion'))
  const [style, setStyle] = useState<Style>('balanced')

  const [ps, pe] = PER_CELL[chem][style]
  const start = Math.round(cells * ps * 10) / 10
  const end = Math.round(cells * pe * 10) / 10
  const minVin = Number(draft.l_min_vin)
  // The hard shutdown must sit below the end of the cut-off, or it fires first.
  const newMinVin = Number.isFinite(minVin) && minVin >= end ? Math.floor((end - cells * 0.15) * 10) / 10 : null
  const same = draft.l_battery_cut_start === start && draft.l_battery_cut_end === end && draft.si_battery_cells === cells

  const apply = () => {
    const patch: ConfigValues = {
      l_battery_cut_start: start,
      l_battery_cut_end: end,
      si_battery_cells: cells,
      si_battery_type: chem === 'lifepo4' ? 1 : 0,
    }
    if (newMinVin !== null) patch.l_min_vin = newMinVin
    onApply(patch)
  }

  return (
    <div className="border-b border-line bg-surface-2/40 px-4 py-4 md:px-5">
      <div className="flex items-center gap-2">
        <BatteryMedium className="size-4 text-accent" />
        <h3 className="text-sm font-semibold">Battery cut-off helper</h3>
      </div>
      <p className="mt-1 text-[13px] text-muted">Pick your pack and how hard you want to use it. You can review the result before anything is written.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-[9.5px]">Cells in series</span>
          <input
            type="number"
            min={2}
            max={40}
            value={cells}
            disabled={readOnly}
            onChange={(e) => setCells(Math.max(2, Math.min(40, Math.round(Number(e.target.value) || 0))))}
            className="num focus-ring h-10 w-20 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="label text-[9.5px]">Chemistry</span>
          <Segmented
            label="Chemistry"
            value={chem}
            onChange={setChem}
            options={[
              { value: 'liion', label: 'Li-ion' },
              { value: 'lifepo4', label: 'LiFePO4' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="label text-[9.5px]">Style</span>
          <Segmented
            label="Cut-off style"
            value={style}
            onChange={setStyle}
            options={[
              { value: 'gentle', label: 'Gentle' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'range', label: 'Max range' },
            ]}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{STYLE_TEXT[style]}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span>
          Start reducing at <b className="num">{formatNumber(start, 1)} V</b>
          <span className="text-muted"> ({formatNumber(ps, 2)} V/cell)</span>
        </span>
        <span>
          Cut fully at <b className="num">{formatNumber(end, 1)} V</b>
          <span className="text-muted"> ({formatNumber(pe, 2)} V/cell)</span>
        </span>
        {newMinVin !== null && (
          <span className="text-warn">Also lowers the minimum input voltage to {formatNumber(newMinVin, 1)} V so it doesn’t trip first.</span>
        )}
        <Button className="ml-auto h-9" disabled={readOnly || same} onClick={apply}>
          {same ? 'Already set' : 'Use these values'}
        </Button>
      </div>
    </div>
  )
}
