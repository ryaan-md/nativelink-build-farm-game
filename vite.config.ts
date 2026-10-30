import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // GitHub Pages project sites are served from /<repo>/. Local dev stays at /.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
