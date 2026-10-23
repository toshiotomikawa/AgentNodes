import { useEffect, useState } from 'react'
import type { AgentNode, Harness } from '../agent-tree/types'

export interface SourceInfo {
  harness: Harness
  found: boolean
  sessions: number
  error?: string
}

export interface LiveState {
  agents: AgentNode[]
  sources: SourceInfo[]
  /** Local clock, corrected by the server's clock, ticking every second. */
  now: number
  /** When this PC was turned on, epoch ms. */
  bootAt?: number
  loading: boolean
  error?: string
}

const POLL_MS = 2500

/** `range` is a number of hours, or "boot" for everything since this PC was turned on. */
export function useLiveAgents(enabled: boolean, range: string): LiveState {
  const [state, setState] = useState<LiveState>({ agents: [], sources: [], now: Date.now(), loading: true })
  const [skew, setSkew] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!enabled) return
    let stop = false
    let timer = 0
    const poll = async () => {
      try {
        const res = await fetch(range === 'boot' ? '/api/agents?since=boot' : `/api/agents?hours=${range}`, { headers: { 'x-agent-nodes': '1' } })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? res.statusText)
        if (stop) return
        setSkew(body.now - Date.now())
        setState({ agents: body.agents, sources: body.sources, now: body.now, bootAt: body.bootAt, loading: false })
      } catch (e) {
        if (!stop) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
      }
      if (!stop) timer = window.setTimeout(poll, POLL_MS)
    }
    setState((s) => ({ ...s, loading: true }))
    poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [enabled, range])

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [enabled])

  return { ...state, now: now + skew }
}
