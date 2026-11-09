// Categorical colours for plotted signals, in fixed order. Validated for the
// dark surface (#0a0e13): lightness band, chroma, colour-blind separation of
// neighbours (worst ΔE 8.4) and 3:1 contrast all pass. A signal keeps its
// colour while plotted; the next one takes the lowest free slot.

const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const

export const seriesColor = (slot: number) => SERIES_COLORS[slot % SERIES_COLORS.length]
