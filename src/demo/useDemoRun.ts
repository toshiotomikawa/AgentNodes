import { useCallback, useEffect, useRef, useState } from 'react'
import { read, save } from '../preferences'
import type { IssueKind } from '../agent-tree/AgentTree'
import type { AgentNode, Provider } from '../agent-tree/types'

/** One scripted agent. Times are simulated seconds. */
interface Spec {
  id: string
  parent: string | null
  name: string
  model: string
  provider: Provider
  tools: string[]
  task: string
  /** When the agent spawns. Retries spawn when the user asks. */
  start: number
  /** Seconds of actual work. Cost only grows while working. */
  work: number
  /** The agent's own final cost in dollars. */
  cost: number
  /** Agents with children finish this many seconds after their last child. */
  afterKids?: number
  failAfter?: number
  askAfter?: number
  issue?: { message: string; choices?: string[] }
  retry?: string
}

const SPECS: Spec[] = [
  { id: 'orchestrator', parent: null, name: 'Orchestrator', model: 'claude-opus-5-5', provider: 'anthropic', tools: ['slack', 'notion', 'github'], task: 'Launch the new pricing page by Friday', start: 0, work: 101, cost: 1.11, afterKids: 5 },
  { id: 'researcher', parent: 'orchestrator', name: 'Researcher', model: 'claude-sonnet-5-5', provider: 'anthropic', tools: ['notion', 'slack'], task: 'Compare the pricing of five competitors', start: 5, work: 45, cost: 0.18, afterKids: 2 },
  { id: 'writer', parent: 'orchestrator', name: 'Writer', model: 'claude-sonnet-5-5', provider: 'anthropic', tools: ['notion', 'figma'], task: 'Write the copy for the three plans', start: 12, work: 55, cost: 0.19, askAfter: 35, issue: { message: 'Which plan should the page highlight as most popular?', choices: ['Pro', 'Team'] } },
  { id: 'coder', parent: 'orchestrator', name: 'Coder', model: 'gpt-6-sol', provider: 'openai', tools: ['github', 'stripe', 'figma'], task: 'Build the page and wire up checkout', start: 16, work: 80, cost: 0.48, afterKids: 9 },
  { id: 'scraper', parent: 'researcher', name: 'Scraper', model: 'gemini-3.8-flash', provider: 'google', tools: ['notion'], task: 'Read the pricing pages of Linear, Notion and three more', start: 13, work: 22, cost: 0.03 },
  { id: 'analyst', parent: 'researcher', name: 'Analyst', model: 'claude-sonnet-5-5', provider: 'anthropic', tools: ['hubspot', 'notion'], task: 'Summarize 120 G2 reviews that mention price', start: 21, work: 27, cost: 0.08 },
  { id: 'tester', parent: 'coder', name: 'Tester', model: 'gpt-6-mini', provider: 'openai', tools: ['github'], task: 'Write and run the checkout tests', start: 29, work: 27, cost: 0.04, failAfter: 27, issue: { message: "2 of 14 checkout tests fail – coupon codes aren't applied" }, retry: 'tester-retry' },
  { id: 'tester-retry', parent: 'coder', name: 'Tester', model: 'gpt-6-mini', provider: 'openai', tools: ['github', 'stripe'], task: 'Fix the coupon test and run all again', start: Infinity, work: 26, cost: 0.04 },
]

/** Autopilot timings, in simulated seconds after an issue shows up. */
const AUTO = { failed: { open: 1.5, act: 5 }, 'needs-you': { open: 3, act: 14 } }
/** Real seconds the finished run stays on screen before it loops. */
const LOOP_HOLD = 6
/** Fixed fake epoch so cards show plain elapsed times. */
const EPOCH = 0

interface Run {
  t: number
  agents: Map<string, { spec: Spec; node: AgentNode; worked: number; since?: number }>
  retryAt: Map<string, number>
  doneAt?: number
}

function newRun(): Run {
  return { t: 0, agents: new Map(), retryAt: new Map() }
}

function spawn(run: Run, spec: Spec) {
  run.agents.set(spec.id, {
    spec,
    worked: 0,
    node: {
      id: spec.id,
      parentId: spec.parent,
      name: spec.name,
      model: spec.model,
      provider: spec.provider,
      harness: 'demo',
      status: 'running',
      task: spec.task,
      tools: spec.tools,
      cost: 0,
      startedAt: EPOCH + run.t * 1000,
      details: {
        folder: '~/acme/pricing-page',
        sessionId: spec.id,
        toolCounts: spec.tools.map((tool, i) => [tool, 2 + ((spec.id.length + i * 3) % 7)]),
      },
    },
  })
}

function step(run: Run, dt: number) {
  run.t += dt
  const t = run.t
  for (const spec of SPECS) {
    const start = run.retryAt.get(spec.id) ?? spec.start
    const parent = spec.parent ? run.agents.get(spec.parent) : undefined
    if (!run.agents.has(spec.id) && t >= start && (!spec.parent || parent?.node.status === 'running')) spawn(run, spec)
  }
  for (const a of run.agents.values()) {
    const { spec, node } = a
    if (node.status !== 'running') continue
    a.worked += dt
    node.cost = Math.min(spec.cost, (spec.cost * a.worked) / spec.work)
    const end = () => {
      node.endedAt = EPOCH + t * 1000
      node.cost = spec.cost
    }
    if (spec.askAfter !== undefined && !a.since && a.worked >= spec.askAfter) {
      node.status = 'needs-you'
      node.issue = spec.issue
      a.since = t
    } else if (spec.failAfter !== undefined && a.worked >= spec.failAfter) {
      node.status = 'failed'
      node.issue = spec.issue
      node.endedAt = EPOCH + t * 1000
      a.since = t
    } else if (spec.afterKids !== undefined) {
      const kids = SPECS.filter((s) => s.parent === spec.id && s.start !== Infinity)
      const live = [...run.agents.values()].filter((k) => k.spec.parent === spec.id)
      const allSpawned = kids.every((k) => run.agents.has(k.id))
      const settled = live.every((k) => k.node.status === 'done' || k.node.status === 'stopped')
      const lastEnd = Math.max(0, ...live.map((k) => (k.node.endedAt ?? Infinity) / 1000))
      if (allSpawned && settled && t >= lastEnd + spec.afterKids) {
        node.status = 'done'
        end()
      }
    } else if (a.worked >= spec.work) {
      node.status = 'done'
      end()
    }
  }
  const root = run.agents.get('orchestrator')
  if (root?.node.status === 'done' && run.doneAt === undefined) run.doneAt = t
}

export interface DemoControls {
  agents: AgentNode[]
  now: number
  paused: boolean
  speed: number
  autopilot: boolean
  openIssues: IssueKind | null
  setOpenIssues: (k: IssueKind | null) => void
  setPaused: (v: boolean) => void
  setSpeed: (v: number) => void
  setAutopilot: (v: boolean) => void
  restart: () => void
  retry: (id: string) => void
  dismiss: (id: string) => void
  answer: (id: string, choice: string) => void
}

export function useDemoRun(): DemoControls {
  const runRef = useRef<Run>(newRun())
  const [, setFrame] = useState(0)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(() => { const n = Number(read('at-demo-speed', '8')); return [1, 4, 8].includes(n) ? n : 8 })
  const [autopilot, setAutopilot] = useState(() => read<string>('at-demo-autopilot', 'on') !== 'off')
  useEffect(() => save('at-demo-speed', String(speed)), [speed])
  useEffect(() => save('at-demo-autopilot', autopilot ? 'on' : 'off'), [autopilot])
  const [openIssues, setOpenIssues] = useState<IssueKind | null>(null)
  const settings = useRef({ paused, speed, autopilot })
  settings.current = { paused, speed, autopilot }

  const retry = useCallback((id: string) => {
    const run = runRef.current
    const a = run.agents.get(id)
    if (!a || a.node.status !== 'failed') return
    a.node.status = 'stopped'
    a.node.issue = undefined
    if (a.spec.retry) run.retryAt.set(a.spec.retry, run.t)
    setOpenIssues(null)
  }, [])

  const dismiss = useCallback((id: string) => {
    const a = runRef.current.agents.get(id)
    if (!a) return
    if (a.node.status === 'failed') a.node.status = 'stopped'
    if (a.node.status === 'needs-you') a.node.status = 'running'
    a.node.issue = undefined
    setOpenIssues(null)
  }, [])

  const answer = useCallback((id: string) => {
    const a = runRef.current.agents.get(id)
    if (!a || a.node.status !== 'needs-you') return
    a.node.status = 'running'
    a.node.issue = undefined
    setOpenIssues(null)
  }, [])

  const restart = useCallback(() => {
    runRef.current = newRun()
    setOpenIssues(null)
    setFrame((f) => f + 1)
  }, [])

  /** Resolves issues on its own, opening the list first so you can see what it is doing. */
  const drive = useCallback(
    (run: Run, dt: number) => {
      for (const a of run.agents.values()) {
        const kind = a.node.status === 'failed' ? 'failed' : a.node.status === 'needs-you' ? 'needs-you' : null
        if (!kind || a.since === undefined) continue
        const waited = run.t - a.since
        const plan = AUTO[kind]
        if (waited >= plan.act) {
          if (kind === 'failed') retry(a.spec.id)
          else answer(a.spec.id)
        } else if (waited >= plan.open && waited - dt < plan.open) setOpenIssues(kind)
      }
    },
    [retry, answer],
  )

  // ?t=66 jumps to that simulated second, ?paused=1 starts paused. Handy for screenshots.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const target = Number(q.get('t'))
    if (target > 0) {
      const run = runRef.current
      while (run.t < target && run.doneAt === undefined) {
        step(run, 0.05)
        drive(run, 0.05)
      }
    }
    if (q.get('paused') === '1') setPaused(true)
  }, [drive])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let holdUntil = 0
    const tick = (now: number) => {
      const dt = Math.min(0.5, (now - last) / 1000)
      last = now
      const s = settings.current
      const run = runRef.current
      if (!s.paused) {
        if (run.doneAt !== undefined) {
          if (!holdUntil) holdUntil = now + LOOP_HOLD * 1000
          else if (now >= holdUntil) {
            holdUntil = 0
            runRef.current = newRun()
            setOpenIssues(null)
          }
        } else {
          step(run, dt * s.speed)
          if (s.autopilot) drive(run, dt * s.speed)
        }
      }
      setFrame((f) => (f + 1) % 1e9)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [drive])

  const run = runRef.current
  return {
    agents: [...run.agents.values()].map((a) => ({ ...a.node })),
    now: EPOCH + run.t * 1000,
    paused,
    speed,
    autopilot,
    openIssues,
    setOpenIssues,
    setPaused,
    setSpeed,
    setAutopilot,
    restart,
    retry,
    dismiss,
    answer,
  }
}
