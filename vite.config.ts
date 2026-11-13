/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Where the app is served from: "/" normally; "/repo-name/" on GitHub Pages, where the
// publishing workflow sets BASE_PATH. Always starts and ends with a slash.
const base = `/${(process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '')}/`.replace(/\/+/g, '/')

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // Offline use: the app itself is precached; the package archive and map tiles are
    // cached as they're fetched. Firmware downloads always need the network.
    !process.env.VITEST &&
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Ohmic',
          short_name: 'Ohmic',
          description: 'Configure, monitor and tune VESC-based motor controllers from your browser.',
          lang: 'en',
          id: base,
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'any',
          background_color: '#050505',
          theme_color: '#050505',
          categories: ['utilities', 'productivity'],
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Firmware layouts and config definitions make some chunks large.
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/\/api\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // The VESC package archive: fresh when online, the last copy when not.
              // Copied into the service worker as written, so it can't use `base`.
              urlPattern: ({ url }) => url.pathname.endsWith('/api/pkg/archive'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'ohmic-pkg-archive',
                networkTimeoutSeconds: 10,
                expiration: { maxEntries: 1, maxAgeSeconds: 30 * 24 * 3600 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              // Map tiles for ride logs, so recent areas still show offline.
              urlPattern: ({ url }) => url.hostname === 'tile.openstreetmap.org',
              handler: 'CacheFirst',
              options: {
                cacheName: 'ohmic-map-tiles',
                expiration: { maxEntries: 600, maxAgeSeconds: 14 * 24 * 3600 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
  ],
  server: {
    // The package archive comes from the Ohmic server (npm run server) during development.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
