import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  // Served from '/' locally and on any normal host. The GitHub Pages demo build
  // sets BASE_PATH=/<repo>/ so assets and the router resolve under the subpath.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Dev-mode forwarding to the token proxy (server/proxy.mjs). The browser
    // calls same-origin /api/* and /healthz; the proxy injects the Meta token
    // server-side. Start it with: npm run proxy
    proxy: {
      '/api': 'http://localhost:8787',
      '/healthz': 'http://localhost:8787',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy charting lib + React vendor out of the app chunk so the
        // initial app bundle is smaller and vendor caches across app deploys.
        manualChunks: {
          recharts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    // All suites are pure (data/metrics/engine) or in-process HTTP — no DOM needed.
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'server/**/*.{test,spec}.ts'],
  },
})
