import { useLayoutEffect, useRef } from 'react'

/**
 * A ref that always holds the latest value, for callbacks set up once in an
 * effect (chart hooks, map clicks) that must see current props.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
