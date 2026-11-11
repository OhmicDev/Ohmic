import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { haptic } from '../../ui/haptics'

/**
 * Rearranging by dragging: press an item and move over another to put it there. Each item
 * carries its id in the data attribute `attr`. Arrow keys move a focused item one place.
 * The handlers go on whatever is dragged: a handle, or the whole item.
 */
export function useDragMove<T extends string>(attr: string, ids: readonly T[], move: (id: T, over: T) => void, nudge: (id: T, by: -1 | 1) => void) {
  const [dragging, setDragging] = useState<T | null>(null)
  // The item last moved onto. While the pointer rests on it nothing more moves, or items of
  // different sizes would swap back and forth.
  const last = useRef<string | null>(null)
  const moved = useRef(false)
  const end = () => setDragging(null)
  return {
    dragging,
    /** Whether the last press moved anything, so the click that ends a drag can be told from a tap. */
    didMove: () => moved.current,
    handlers: (id: T) => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        last.current = null
        moved.current = false
        setDragging(id)
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (dragging !== id) return
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(`[${attr}]`)?.getAttribute(attr)
        if (!over || over === id) {
          last.current = null
          return
        }
        if (over === last.current || !ids.includes(over as T)) return
        last.current = over
        if (!moved.current) haptic()
        moved.current = true
        move(id, over as T)
      },
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        const by = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
        if (!by) return
        e.preventDefault()
        nudge(id, by)
      },
    }),
  }
}

export type DragMove<T extends string> = ReturnType<typeof useDragMove<T>>
