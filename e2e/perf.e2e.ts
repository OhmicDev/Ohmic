import { expect, test } from '@playwright/test'
import { connectDemo, go } from './helpers'

// The Ride dashboard is the busiest screen: every value, sparkline and the speed tween update
// with each sample. This runs it at the fastest update rate on a phone-sized screen, with the CPU
// slowed 4× (roughly a mid-range phone), and checks it still draws at 60 frames a second.
test('Ride keeps 60 fps at 50 Hz updates with a phone-class CPU', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await connectDemo(page)
  await go(page, '/settings')
  await page.getByRole('radio', { name: '50 Hz' }).click()
  await go(page, '/')
  await expect(page.getByRole('region', { name: 'Speed and power' })).toBeVisible()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  // Let the history buffers fill so the sparklines are at full length.
  await page.waitForTimeout(3000)

  // The browser's own counters: time the main thread spent on all tasks, and on running the app's script.
  await cdp.send('Performance.enable')
  const counters = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? Number.NaN
    return { task: get('TaskDuration'), script: get('ScriptDuration') }
  }
  const c0 = await counters()
  const wall0 = Date.now()

  const stats = await page.evaluate(
    () =>
      new Promise<{ fps: number; p50: number; p95: number; p99: number; worst: number; slowFrames: number; longTasks: number }>((resolve) => {
        const frames: number[] = []
        const longs: number[] = []
        const po = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longs.push(e.duration)
        })
        try {
          po.observe({ type: 'longtask', buffered: false })
        } catch {
          /* not supported */
        }
        const seconds = 6
        let last = performance.now()
        const start = last
        const tick = (t: number) => {
          frames.push(t - last)
          last = t
          if (t - start < seconds * 1000) requestAnimationFrame(tick)
          else {
            po.disconnect()
            frames.shift()
            const s = [...frames].sort((a, b) => a - b)
            const at = (p: number) => Math.round(s[Math.floor(p * (s.length - 1))] * 10) / 10
            resolve({
              fps: Math.round((frames.length / seconds) * 10) / 10,
              p50: at(0.5),
              p95: at(0.95),
              p99: at(0.99),
              worst: Math.round(s[s.length - 1]),
              slowFrames: frames.filter((f) => f > 34).length,
              longTasks: longs.length,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
  )
  const c1 = await counters()
  const wall = (Date.now() - wall0) / 1000
  const share = (s: number) => Math.round((s / wall) * 100)
  const scriptShare = share(c1.script - c0.script)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const report = { ...stats, scriptShare: `${scriptShare} %`, mainThreadShare: `${share(c1.task - c0.task)} %` }
  test.info().annotations.push({ type: 'frames', description: JSON.stringify(report) })
  console.log('Ride at 50 Hz, CPU ÷4:', report)

  // Frames keep coming at the display rate, nothing blocks the main thread for 50 ms or more, and the
  // app's own script uses well under half of the slowed main thread. Total main-thread time is only
  // reported: in a headless browser it includes software rendering, which a phone does on its GPU,
  // and it varies a lot between runs. Single frame intervals aren't checked either: headless
  // browsers space frames unevenly.
  expect(stats.fps).toBeGreaterThanOrEqual(55)
  expect(stats.longTasks).toBe(0)
  expect(scriptShare).toBeLessThan(35)
})
