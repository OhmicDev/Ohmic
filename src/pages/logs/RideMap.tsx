import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { WifiOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../../lib/format'
import { useLatest } from '../../lib/useLatest'
import type { Units } from '../../lib/vehicle'
import type { RideData } from '../../logs/columns'
import { MAP_METRICS, type MapMetric } from '../../logs/mapMetrics'
import { useSettings } from '../../state/settings'

// Sequential blue, low (dark) to high (light), from the validated chart palette.
// The darkest step still stands out from the darkened map (about 2:1).
const RAMP = ['#184f95', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#9ec5f4', '#cde2fb']
const MAX_POINTS = 4000

interface Track {
  /** Row index of each point. */
  rows: number[]
  latlngs: L.LatLngTuple[]
}

function buildTrack(d: RideData): Track {
  const all: number[] = []
  for (let i = 0; i < d.rows; i++) if (Number.isFinite(d.cols.lat[i]) && Number.isFinite(d.cols.lon[i])) all.push(i)
  const step = Math.max(1, Math.ceil(all.length / MAX_POINTS))
  const rows = all.filter((_, k) => k % step === 0 || k === all.length - 1)
  return { rows, latlngs: rows.map((i) => [d.cols.lat[i], d.cols.lon[i]]) }
}

/** Low and high ends of the colour scale: the 2nd and 98th percentiles, so one spike doesn't wash it out. */
function scaleOf(values: number[]): [number, number] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return [0, 1]
  const lo = v[Math.floor(v.length * 0.02)]
  const hi = v[Math.min(v.length - 1, Math.floor(v.length * 0.98))]
  return hi - lo < 1e-6 ? [lo - 0.5, hi + 0.5] : [lo, hi]
}

const bucket = (v: number, [lo, hi]: [number, number]) =>
  Number.isFinite(v) ? Math.max(0, Math.min(RAMP.length - 1, Math.floor(((v - lo) / (hi - lo)) * RAMP.length))) : 0

export function RideMap({ data, metric, units, index, onPick }: { data: RideData; metric: MapMetric; units: Units; index: number; onPick: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const route = useRef<L.LayerGroup | null>(null)
  const marker = useRef<L.CircleMarker | null>(null)
  const onPickRef = useLatest(onPick)
  const accent = useSettings((s) => s.accent)
  const accentRef = useLatest(accent)
  const [tilesFailed, setTilesFailed] = useState(false)
  const track = useMemo(() => buildTrack(data), [data])
  const def = MAP_METRICS[metric]
  const values = useMemo(() => track.rows.map((i) => def.conv(data.cols[def.col][i], units)), [track, data, def, units])
  const scale = useMemo(() => scaleOf(values), [values])

  // The map itself, once per ride.
  useEffect(() => {
    const el = box.current
    if (!el || !track.latlngs.length) return
    const m = L.map(el, {
      preferCanvas: true,
      scrollWheelZoom: false,
      // On phones, one finger scrolls the page; pinch or the buttons zoom the map.
      dragging: !L.Browser.mobile,
      attributionControl: true,
    })
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      className: 'map-tiles-dark',
    })
    let failed = 0
    tiles.on('tileerror', () => {
      if (++failed === 3) setTilesFailed(true)
    })
    tiles.on('tileload', () => {
      failed = 0
      setTilesFailed(false)
    })
    tiles.addTo(m)
    m.attributionControl.setPrefix(false)
    m.fitBounds(L.latLngBounds(track.latlngs), { padding: [24, 24], maxZoom: 17 })
    route.current = L.layerGroup().addTo(m)
    // Canvas can't read CSS variables, so the accent is passed in as a colour.
    marker.current = L.circleMarker(track.latlngs[0], { radius: 7, color: '#050505', weight: 3, fillColor: accentRef.current, fillOpacity: 1 }).addTo(m)
    // Tap near the route to jump there.
    m.on('click', (e: L.LeafletMouseEvent) => {
      const p = m.latLngToLayerPoint(e.latlng)
      let best = -1
      let bestD = 24 * 24
      track.latlngs.forEach((ll, k) => {
        const q = m.latLngToLayerPoint(ll)
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
        if (d < bestD) {
          bestD = d
          best = k
        }
      })
      if (best >= 0) onPickRef.current(track.rows[best])
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      route.current = null
      marker.current = null
    }
  }, [track, accentRef, onPickRef])

  // The route, coloured by the chosen measure.
  useEffect(() => {
    const g = route.current
    if (!g || track.latlngs.length < 2) return
    g.clearLayers()
    L.polyline(track.latlngs, { color: '#050505', weight: 8, opacity: 0.55, interactive: false }).addTo(g)
    let start = 0
    let b = bucket(values[0], scale)
    for (let k = 1; k <= track.latlngs.length; k++) {
      const nb = k < track.latlngs.length ? bucket(values[k], scale) : -1
      if (nb !== b) {
        L.polyline(track.latlngs.slice(start, Math.min(k + 1, track.latlngs.length)), { color: RAMP[b], weight: 4, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g)
        start = k
        b = nb
      }
    }
    const end = track.latlngs[track.latlngs.length - 1]
    L.circleMarker(track.latlngs[0], { radius: 6, color: '#050505', weight: 2, fillColor: '#ececec', fillOpacity: 1, interactive: false }).bindTooltip('Start').addTo(g)
    L.circleMarker(end, { radius: 6, color: '#ececec', weight: 2, fillColor: '#050505', fillOpacity: 1, interactive: false }).bindTooltip('Finish').addTo(g)
    marker.current?.bringToFront()
  }, [track, values, scale])

  useEffect(() => {
    marker.current?.setStyle({ fillColor: accent })
  }, [accent])

  // The marker follows the scrubber, charts and taps.
  useEffect(() => {
    const m = marker.current
    if (!m) return
    // Nearest track point at or before this row.
    let lo = 0
    let hi = track.rows.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (track.rows[mid] <= index) lo = mid
      else hi = mid - 1
    }
    const ll = track.latlngs[lo]
    if (ll) m.setLatLng(ll)
  }, [index, track])

  if (!track.latlngs.length) return null
  const unit = def.unit(units)
  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-line">
        <div ref={box} className="h-[300px] bg-surface-2 md:h-[380px]" role="application" aria-label={`Map of the ride, coloured by ${def.label.toLowerCase()}`} />
        {tilesFailed && (
          <div className="absolute top-2 left-2 z-[500] flex items-center gap-2 rounded-lg border border-line-strong bg-surface/90 px-2.5 py-1.5 text-xs text-muted">
            <WifiOff className="size-3.5" /> The map needs internet. The route is still drawn.
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        <span>{def.label}</span>
        <span className="num">{fmt(scale[0], def.digits)}</span>
        <span className="h-2 w-36 rounded-full" style={{ background: `linear-gradient(90deg, ${RAMP.join(', ')})` }} aria-hidden />
        <span className="num">
          {fmt(scale[1], def.digits)} {unit}
        </span>
      </div>
    </div>
  )
}
