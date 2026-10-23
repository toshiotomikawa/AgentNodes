import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentNode, ModelMetadata } from '../src/agent-tree/types.ts'

const SOURCE = 'https://models.dev/api.json?type=all'
const CACHE = path.resolve('.local/models-dev.json')
const TTL = 24 * 60 * 60 * 1000
type ProviderModels = Record<string, { name?: string; models?: Record<string, {
  limit?: { context?: number; output?: number }
  release_date?: string
  reasoning?: boolean
  tool_call?: boolean
  modalities?: { input?: string[] }
}> }>

const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
const boolean = (value: unknown) => typeof value === 'boolean' ? value : undefined

/** Index exact provider/model pairs; never guess a match from a display name. */
export function createModelLookup(data: unknown) {
  const index = new Map<string, ModelMetadata>()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid model catalogue')
  for (const [provider, entry] of Object.entries(data as ProviderModels)) {
    if (!entry || !entry.models || typeof entry.models !== 'object') continue
    for (const [id, m] of Object.entries(entry.models)) {
      if (!m || typeof m !== 'object') continue
      index.set(`${provider}/${id}`, {
        provider: typeof entry.name === 'string' ? entry.name : provider,
        context: positive(m.limit?.context),
        output: positive(m.limit?.output),
        releaseDate: typeof m.release_date === 'string' ? m.release_date : undefined,
        reasoning: boolean(m.reasoning),
        toolCall: boolean(m.tool_call),
        inputModalities: Array.isArray(m.modalities?.input) ? m.modalities.input.filter(v => typeof v === 'string') : undefined,
      })
    }
  }
  if (!index.size) throw new Error('Empty model catalogue')
  return (agent: AgentNode): ModelMetadata | undefined => {
    const raw = agent.details?.modelId
    if (raw && index.has(raw)) return index.get(raw)
    const provider = agent.provider === 'other' ? (agent.harness === 'opencode' ? 'opencode' : '') : agent.provider
    return index.get(`${provider}/${agent.model}`)
  }
}

let lookup: ReturnType<typeof createModelLookup> | undefined
let updatedAt = 0
let attemptedAt = 0
let pending: Promise<void> | undefined

/** Load disk first, refresh daily in the background, and keep working offline. */
export function refreshCatalogue(): Promise<void> {
  if (pending) return pending
  if (Date.now() - attemptedAt < 5 * 60 * 1000) return Promise.resolve()
  attemptedAt = Date.now()
  pending = (async () => {
    if (!lookup) {
      try {
        const cached = JSON.parse(await fs.readFile(CACHE, 'utf8'))
        lookup = createModelLookup(cached.data)
        updatedAt = cached.updatedAt
      } catch { /* First run or invalid cache: the live cards still work. */ }
    }
    if (Date.now() - updatedAt < TTL) return
    try {
      const response = await fetch(SOURCE, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`)
      const data: unknown = await response.json()
      const next = createModelLookup(data)
      lookup = next
      updatedAt = Date.now()
      await fs.mkdir(path.dirname(CACHE), { recursive: true })
      // Write beside the cache then rename, so interruption cannot truncate a good cache.
      await fs.writeFile(`${CACHE}.tmp`, JSON.stringify({ updatedAt, data }), 'utf8')
      await fs.rename(`${CACHE}.tmp`, CACHE)
    } catch { /* Keep the last valid public catalogue, or omit metadata on first run. */ }
  })().finally(() => { pending = undefined })
  return pending
}

export function enrichModels(agents: AgentNode[]): AgentNode[] {
  return agents.map(agent => {
    const catalogue = lookup?.(agent)
    return catalogue ? { ...agent, details: { ...agent.details, catalogue } } : agent
  })
}
