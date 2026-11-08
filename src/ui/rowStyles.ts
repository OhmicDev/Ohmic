// Shared looks for list rows (Connect, More, Setup).

/** Flat colours for the small icon squares in lists, like macOS settings. */
export const TILE = {
  blue: 'bg-[#2f7fd6]',
  green: 'bg-[#27ae60]',
  orange: 'bg-[#e08a0b]',
  purple: 'bg-[#8e5bd0]',
  red: 'bg-[#e0493b]',
  teal: 'bg-[#16a085]',
  grey: 'bg-[#7a7a80]',
} as const
export type TileColor = keyof typeof TILE

/** Rows inside a card highlight from the inside, so the card's rounded edge doesn't cut the ring off. */
export const ROW_FOCUS = 'outline-none focus-visible:bg-surface-2 focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]'
