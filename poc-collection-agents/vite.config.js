import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteApiPlugin } from './scripts/vite-api-plugin.js'

export default defineConfig(({ mode }) => ({
  plugins: [react(), viteApiPlugin(mode)],
}))
