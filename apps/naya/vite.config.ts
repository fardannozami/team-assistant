import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // three.js lives in its own lazily loaded chunk (the 3D office view).
  build: { chunkSizeWarningLimit: 1100 },
})
