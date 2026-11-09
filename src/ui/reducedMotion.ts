/** The device asks for less motion. False outside a browser, or where matchMedia is missing (tests in Node). */
export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
