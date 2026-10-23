export function formatCost(dollars: number): string {
  if (dollars >= 1000) return '$' + Math.round(dollars).toLocaleString('en-US')
  return '$' + dollars.toFixed(2)
}

const EFFORT: Record<string, string> = { xhigh: 'Extra high', minimal: 'Minimal', none: 'None' }

/** "medium" → "Medium", "xhigh" → "Extra high". */
export function formatEffort(effort: string): string {
  return EFFORT[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
