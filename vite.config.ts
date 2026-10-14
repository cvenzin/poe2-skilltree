import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        planner: fileURLToPath(new URL('./index.html', import.meta.url)),
        exportGuide: fileURLToPath(new URL('./guides/export-to-poe2/index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    // Force every import of react / react-dom (incl. transitive ones from
    // zustand, @floating-ui/react etc.) to resolve to the *same* module
    // instance — otherwise dev mode can serve a CJS copy alongside the ESM
    // copy and hooks fail with "Cannot read properties of null".
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Pre-bundle these at server start instead of discovering them lazily.
    // Avoids the "✨ new dependencies optimized → reloading" mid-session
    // cycle that drops in-flight dynamic imports when pixi/viewport are
    // first hit.
    include: ['pixi.js', 'pixi-viewport', 'zustand', '@floating-ui/react'],
  },
})
