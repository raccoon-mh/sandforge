import { defineConfig } from 'vite'

// GitHub Pages serves the project site from /<repo>/ — set base accordingly.
// A local `npm run dev` or a user-page deploy can override with BASE_PATH=/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/sandforge/',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // The worker owns the engine; keep it a separate long-lived chunk.
        manualChunks: undefined,
      },
    },
  },
  worker: { format: 'es' },
})
