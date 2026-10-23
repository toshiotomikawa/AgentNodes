import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { bootTime, collect } from './server/collect'
import { stopAgent } from './server/stop'
import { enrichModels, refreshCatalogue } from './server/model-catalogue'
import { createLocalMiddleware } from './server/api'

const HOST = '127.0.0.1'
const PORT = 5199

/** Live services stay behind the same guard in development and preview. */
function liveAgents(): Plugin {
  const handle = createLocalMiddleware({
    snapshot: (url) => {
      const hours = Math.min(24 * 30, Math.max(0.25, Number(url.searchParams.get('hours')) || 6))
      const since = url.searchParams.get('since') === 'boot' ? bootTime() : Date.now() - hours * 3600_000
      void refreshCatalogue()
      const snapshot = collect(since)
      return { ...snapshot, agents: enrichModels(snapshot.agents) }
    },
    stop: stopAgent,
    quit: () => { setTimeout(() => process.exit(0), 200) },
  })
  return {
    name: 'live-agents',
    configureServer: (s) => { void refreshCatalogue(); s.middlewares.use(handle) },
    configurePreviewServer: (s) => { void refreshCatalogue(); s.middlewares.use(handle) },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), liveAgents()],
  server: { host: HOST, port: PORT, cors: false, fs: { strict: true, allow: [fileURLToPath(new URL('.', import.meta.url))] } },
  preview: { host: HOST, port: PORT, cors: false },
})
