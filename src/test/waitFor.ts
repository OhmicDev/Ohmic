import { sleep } from '../lib/time'

/**
 * A `waitFor(check)` that polls every 10 ms and throws once `defaultMs` have passed.
 * Each test file picks its own default; a call can still pass a longer one.
 */
export const waitForWithin =
  (defaultMs: number) =>
  async (check: () => boolean, timeoutMs = defaultMs): Promise<void> => {
    const start = Date.now()
    while (!check()) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting')
      await sleep(10)
    }
  }
