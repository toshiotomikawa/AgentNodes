import type { AgentNode } from './types.ts'

export interface CardPreference { color?: string; doneAt?: number; closedAt?: number }
export type CardPreferences = Record<string, CardPreference>

export function normalizeColor(value: string): string | undefined {
  const hex = value.trim().replace(/^#/, '')
  if (/^[a-f\d]{3}$/i.test(hex)) return '#' + [...hex].map(c => c + c).join('').toLowerCase()
  if (/^[a-f\d]{6}$/i.test(hex)) return '#' + hex.toLowerCase()
}

export function parseCardPreferences(raw: string): CardPreferences {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const result: CardPreferences = {}
    for (const [id, value] of Object.entries(data)) {
      if (!value || typeof value !== 'object' || id === '__proto__') continue
      const v = value as CardPreference
      const color = typeof v.color === 'string' ? normalizeColor(v.color) : undefined
      const time = (t: unknown) => typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : undefined
      const doneAt = time(v.doneAt)
      const closedAt = time(v.closedAt)
      if (color || doneAt || closedAt) result[id] = { color, doneAt, ...(closedAt ? { closedAt } : {}) }
    }
    return result
  } catch { return {} }
}

export function applyCardPreferences(agents: AgentNode[], preferences: CardPreferences): AgentNode[] {
  return agents.map(a => {
    const p = preferences[a.id]
    if (!p) return a
    // A mark as done lapses once the agent writes again, so a resumed session shows its real status.
    const done = p.doneAt && !((a.activeAt ?? 0) > p.doneAt)
    const next = { ...a, color: p.color, ...(done ? { status: 'done' as const, markedDone: true, endedAt: Math.max(a.startedAt, p.doneAt!), issue: undefined } : {}) }
    if (!p.closedAt) return next
    const over = next.status === 'running' || next.status === 'needs-you'
    return { ...next, closed: true, markedClosed: true, ...(over ? { status: 'done' as const, endedAt: next.endedAt ?? Math.max(a.startedAt, p.closedAt), issue: undefined } : {}) }
  })
}
