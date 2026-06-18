import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
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
    // All suites are pure (data/metrics/engine) — no DOM needed.
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
