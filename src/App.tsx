import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AgentTree } from './agent-tree/AgentTree'
import { Chevron, Funnel, GithubIcon, HARNESS_LABEL, HarnessIcon } from './agent-tree/icons'
import type { AgentNode, Harness } from './agent-tree/types'
import { useDemoRun } from './demo/useDemoRun'
import { useLiveAgents } from './live/useLiveAgents'
import { read, save } from './preferences'
import { applyCardPreferences, parseCardPreferences, type CardPreference } from './agent-tree/card-preferences'

type Mode = 'demo' | 'live'
type Theme = 'system' | 'light' | 'dark'
/** What "Close" does to a live node: only hide it, or also stop the real agent. */
type CloseMode = 'hide' | 'stop'
type BlobStyle = 'jelly' | 'gumdrop' | 'amoeba'
const BLOBS: BlobStyle[] = ['jelly', 'gumdrop', 'amoeba']
type OnOff = 'on' | 'off'

const REPO_URL = 'https://github.com/toshiotomikawa/AgentNodes'

function useCardPreferences(key: string) {
  const [preferences, setPreferences] = useState(() => parseCardPreferences(read(key, '{}')))
  useEffect(() => save(key, JSON.stringify(preferences)), [key, preferences])
  const change = (id: string, patch: CardPreference) => setPreferences(previous => {
    const next = { ...previous, [id]: { ...previous[id], ...patch } }
    if (!next[id].color && !next[id].doneAt && !next[id].closedAt) delete next[id]
    return next
  })
  return { preferences, change }
}

export default function App() {
  // Live is the main page. The demo opens from the menu or with ?mode=demo.
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).get('mode') === 'demo' ? 'demo' : 'live'))
  const [theme, setTheme] = useState<Theme>(() => read('at-theme', 'system'))
  const [closeMode, setCloseMode] = useState<CloseMode>(() => (read<string>('at-close-mode', 'hide') === 'stop' ? 'stop' : 'hide'))
  useEffect(() => save('at-close-mode', closeMode), [closeMode])
  const [blob, setBlob] = useState<BlobStyle>(() => {
    const v = read<string>('at-blob', 'jelly')
    return BLOBS.includes(v as BlobStyle) ? (v as BlobStyle) : 'jelly'
  })
  useEffect(() => {
    document.documentElement.dataset.blob = blob
    save('at-blob', blob)
  }, [blob])

  // Both default to on; the root attributes let CSS hide the blobs or stop every animation.
  const [blobs, setBlobs] = useState<OnOff>(() => (read<string>('at-blobs', 'on') === 'off' ? 'off' : 'on'))
  const [motion, setMotion] = useState<OnOff>(() => (read<string>('at-motion', 'on') === 'off' ? 'off' : 'on'))
  useEffect(() => {
    document.documentElement.dataset.blobs = blobs
    save('at-blobs', blobs)
  }, [blobs])
  useEffect(() => {
    document.documentElement.dataset.motion = motion
    save('at-motion', motion)
  }, [motion])
  // The computer uptime timer is off unless turned on in More settings.
  const [uptime, setUptime] = useState<OnOff>(() => (read<string>('at-uptime', 'off') === 'on' ? 'on' : 'off'))
  useEffect(() => save('at-uptime', uptime), [uptime])

  useEffect(() => {
    const el = document.documentElement
    if (theme === 'system') delete el.dataset.theme
    else el.dataset.theme = theme
    save('at-theme', theme)
  }, [theme])

  const go = (m: Mode) => {
    setMode(m)
    const url = new URL(location.href)
    if (m === 'demo') url.searchParams.set('mode', 'demo')
    else url.searchParams.delete('mode')
    history.replaceState(null, '', url)
  }

  return (
    <div className={`app ${mode}`}>
      <nav className="toolbar">
        <div className="brand">Agent Nodes</div>
        <Burger mode={mode} onMode={go} theme={theme} onTheme={setTheme} closeMode={closeMode} onCloseMode={setCloseMode} blob={blob} onBlob={setBlob} blobs={blobs} onBlobs={setBlobs} motion={motion} onMotion={setMotion} uptime={uptime} onUptime={setUptime} />
      </nav>
      {mode === 'demo' ? <DemoView /> : <LiveView closeMode={closeMode} uptime={uptime === 'on'} />}
    </div>
  )
}

function Burger(p: {
  mode: Mode
  onMode: (m: Mode) => void
  theme: Theme
  onTheme: (t: Theme) => void
  closeMode: CloseMode
  onCloseMode: (m: CloseMode) => void
  blob: BlobStyle
  onBlob: (b: BlobStyle) => void
  blobs: OnOff
  onBlobs: (v: OnOff) => void
  motion: OnOff
  onMotion: (v: OnOff) => void
  uptime: OnOff
  onUptime: (v: OnOff) => void
}) {
  const [open, setOpen, ref] = usePopover()
  // The main page keeps the essentials; the rest sits on a second page of the same menu.
  const [page, setPage] = useState<'main' | 'more'>('main')
  useEffect(() => {
    if (!open) setPage('main')
  }, [open])
  return (
    <div className="burger" ref={ref}>
      <button className="burger-btn" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
      {open && page === 'more' && (
        <div className="menu" role="menu" aria-label="More settings">
          <button role="menuitem" className="menu-back" onClick={() => setPage('main')}>
            <Chevron size={12} left /> More settings
          </button>
          <div className="menu-sep" />
          <div className="menu-label" title="Hide only removes the node from this view. Close also stops the real agent. The demo always hides.">
            Closing a live node
          </div>
          <Segmented value={p.closeMode} onChange={p.onCloseMode} options={[['hide', 'Hide'], ['stop', 'Close']]} />
          <div className="menu-label">Blobs</div>
          <Segmented value={p.blobs} onChange={p.onBlobs} options={[['on', 'Show'], ['off', 'Hide']]} />
          {p.blobs === 'on' && (
            <>
              <div className="menu-label">Blob shape</div>
              <Segmented value={p.blob} onChange={p.onBlob} options={[['jelly', 'Jelly'], ['gumdrop', 'Gumdrop'], ['amoeba', 'Amoeba']]} />
            </>
          )}
          <div className="menu-label">Animations</div>
          <Segmented value={p.motion} onChange={p.onMotion} options={[['on', 'On'], ['off', 'Off']]} />
          <div className="menu-label">Computer uptime</div>
          <Segmented value={p.uptime} onChange={p.onUptime} options={[['on', 'Show'], ['off', 'Hide']]} />
        </div>
      )}
      {open && page === 'main' && (
        <div className="menu" role="menu">
          <div className="menu-label">Theme</div>
          <Segmented value={p.theme} onChange={p.onTheme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
          <div className="menu-sep" />
          <button
            role="menuitem"
            onClick={() => {
              p.onMode(p.mode === 'live' ? 'demo' : 'live')
              setOpen(false)
            }}
          >
            {p.mode === 'live' ? 'Demo' : 'Live'}
          </button>
          <a role="menuitem" className="menu-link" href={REPO_URL} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <GithubIcon size={13} />
            GitHub
          </a>
          <button role="menuitem" className="menu-next" onClick={() => setPage('more')}>
            More settings <Chevron size={12} right />
          </button>
          <div className="menu-sep" />
          <button role="menuitem" onClick={quit}>
            Quit
          </button>
        </div>
      )}
    </div>
  )
}

/** Open state for a menu that closes on Escape or a click outside it. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return [open, setOpen, ref] as const
}

/** Stops the local server, then replaces the page, since a script may not close a tab it did not open. */
async function quit() {
  try {
    await fetch('/api/quit', { method: 'POST', headers: { 'x-agent-nodes': '1' } })
  } catch {}
  window.close()
  document.body.innerHTML = '<p class="quit-note">Agent Nodes has quit. You can close this tab.<br>Run <code>npm run dev</code> to start it again.</p>'
}

/** Adds every descendant of the closed ids, so a closed node takes its subagents with it. */
function withDescendants(agents: AgentNode[], closed: Set<string>) {
  const out = new Set(closed)
  let grew = true
  while (grew) {
    grew = false
    for (const a of agents) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) {
        out.add(a.id)
        grew = true
      }
    }
  }
  return out
}

/** Closed subagents are hidden with their own subagents; closed main sessions stay, flagged, and move to the Closed section. */
function applyClosed(agents: AgentNode[], closed: Set<string>) {
  const ids = new Set(agents.map((a) => a.id))
  const isRoot = (a: AgentNode) => !a.parentId || !ids.has(a.parentId)
  const hidden = withDescendants(agents, new Set([...closed].filter((id) => !isRoot(agents.find((a) => a.id === id) ?? ({} as AgentNode)) && ids.has(id))))
  const flagged = withDescendants(agents, new Set(agents.filter((a) => closed.has(a.id) && isRoot(a)).map((a) => a.id)))
  return agents.filter((a) => !hidden.has(a.id)).map((a) => (flagged.has(a.id) ? { ...a, closed: true } : a))
}

/** A tree closed here, marked closed, or closed in its own app is closed all the way down, so every card in it shows as closed. */
function spreadClosed(agents: AgentNode[]) {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const isClosed = (a: AgentNode) => {
    for (let cur: AgentNode | undefined = a, i = 0; cur && i < 20; cur = cur.parentId ? byId.get(cur.parentId) : undefined, i++) if (cur.closed || cur.ended) return true
    return false
  }
  return agents.map((a) => (!a.closed && isClosed(a) ? { ...a, closed: true } : a))
}

/**
 * A subagent or dispatched agent that finished is no longer in use, so it leaves the tree of the
 * agent that used it and moves to Closed, with everything under it, as a tree of its own that
 * remembers where it came from (`closedFrom`). A failed one goes too, since its dispatcher has
 * already seen the failure; its message stays in its details. Anything with an active descendant stays.
 */
function retireFinished(agents: AgentNode[]) {
  const ids = new Set(agents.map((a) => a.id))
  const kids = new Map<string, AgentNode[]>()
  for (const a of agents) if (a.parentId && ids.has(a.parentId)) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a])
  const inUse = (a: AgentNode): boolean =>
    a.status === 'running' || a.status === 'needs-you' || (kids.get(a.id) ?? []).some(inUse)
  const retired = new Set<string>()
  const closed = new Set<string>()
  const close = (a: AgentNode) => {
    closed.add(a.id)
    kids.get(a.id)?.forEach(close)
  }
  const visit = (a: AgentNode) => {
    for (const c of kids.get(a.id) ?? []) {
      if (inUse(c)) visit(c)
      else {
        retired.add(c.id)
        close(c)
      }
    }
  }
  agents.filter((a) => !a.parentId || !ids.has(a.parentId)).forEach(visit)
  return agents.map((a) =>
    retired.has(a.id) ? { ...a, parentId: null, closedFrom: a.parentId!, closed: true } : closed.has(a.id) ? { ...a, closed: true } : a,
  )
}

/**
 * A short number per card, kept for good so a card can be named in conversation. New cards get the
 * next number, oldest first. `key` keeps them in localStorage; without it they last for the page.
 */
function useNumbers(agents: AgentNode[], key?: string) {
  const numbers = useRef<Record<string, number> | null>(null)
  if (!numbers.current) {
    try {
      numbers.current = key ? JSON.parse(read(key, '{}')) : {}
    } catch {
      numbers.current = {}
    }
  }
  const map = numbers.current!
  const fresh = agents.filter((a) => !map[a.id]).sort((a, b) => a.startedAt - b.startedAt)
  let next = Math.max(0, ...Object.values(map)) + 1
  for (const a of fresh) map[a.id] = next++
  useEffect(() => {
    if (key && fresh.length) save(key, JSON.stringify(map))
  })
  return useMemo(() => agents.map((a) => ({ ...a, num: map[a.id] })), [agents, map])
}

/** Names the user gave to cards, by agent id. Renaming to an empty name removes the override. */
function useNames(init: () => Record<string, string>) {
  const [names, setNames] = useState<Record<string, string>>(init)
  const rename = (id: string, name: string) =>
    setNames((prev) => {
      const next = { ...prev }
      if (name) next[id] = name
      else delete next[id]
      return next
    })
  return [names, rename] as const
}

const withNames = (agents: AgentNode[], names: Record<string, string>) => agents.map((a) => (names[a.id] ? { ...a, name: names[a.id] } : a))

/** How long this computer has been on, ticking every second, at the bottom right of the page. */
function Uptime({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  let s = Math.max(0, Math.floor((now - since) / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s %= 86400) / 3600)
  const m = Math.floor((s %= 3600) / 60)
  s %= 60
  const pad = (n: number) => String(n).padStart(2, '0')
  const text = d > 0 ? `${d}d ${h}h ${pad(m)}m` : h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
  return (
    <div className="uptime">
      <div className="uptime-in">
        <span className="uptime-n" title={`Computer on since ${new Date(since).toLocaleString()}`}>
          {text}
        </span>
      </div>
    </div>
  )
}

function ClosedNote({ count, onShow }: { count: number; onShow: () => void }) {
  if (!count) return null
  return (
    <span className="closed-note">
      {count} closed ·
      <button className="link-btn" onClick={onShow}>
        Show all
      </button>
    </span>
  )
}

const simTime = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} into the run`
}

function DemoView() {
  const d = useDemoRun()
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const gone = useMemo(() => withDescendants(d.agents, closed), [d.agents, closed])
  const [names, rename] = useNames(() => ({}))
  const { preferences, change } = useCardPreferences('at-demo-cards')
  const agents = useMemo(() => spreadClosed(applyCardPreferences(withNames(d.agents.filter((a) => !gone.has(a.id)), names), preferences)), [d.agents, gone, names, preferences])
  const numbered = useNumbers(agents)
  return (
    <>
      <div className="controls">
        <button
          className="ctl"
          onClick={() => {
            setClosed(new Set())
            d.restart()
          }}
        >
          Restart
        </button>
        <button className="ctl" onClick={() => d.setPaused(!d.paused)}>
          {d.paused ? 'Play' : 'Pause'}
        </button>
        <Segmented value={String(d.speed)} onChange={(v) => d.setSpeed(Number(v))} options={[['1', '1×'], ['4', '4×'], ['8', '8×']]} />
        <label className="ctl-check">
          <input type="checkbox" checked={d.autopilot} onChange={(e) => d.setAutopilot(e.target.checked)} />
          Autopilot
        </label>
        <ClosedNote count={d.agents.length - agents.length} onShow={() => setClosed(new Set())} />
      </div>
      <div className="stage demo-stage">
        <AgentTree
          agents={numbered}
          now={d.now}
          openIssues={d.openIssues}
          onOpenIssuesChange={d.setOpenIssues}
          onRetry={d.retry}
          onDismiss={d.dismiss}
          onAnswer={d.answer}
          onCloseAgent={(id) => setClosed((prev) => new Set(prev).add(id))}
          onRename={rename}
          onMarkDone={(id) => change(id, { doneAt: numbered.find((a) => a.id === id)?.markedDone ? undefined : d.now })}
          onMarkClosed={(id) => change(id, { closedAt: preferences[id]?.closedAt ? undefined : d.now })}
          onColorChange={(id, color) => change(id, { color })}
          formatTime={simTime}
          center
        />
      </div>
    </>
  )
}

const HARNESSES: Harness[] = ['claude-code', 'codex', 'opencode', 'pi', 'antigravity']
const WINDOWS: [string, string][] = [
  ['1', '1h'],
  ['6', '6h'],
  ['24', '24h'],
  ['168', '7d'],
]
const MAX_TREES = 12

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

async function stopAgent(id: string) {
  const res = await fetch('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-nodes': '1' }, body: JSON.stringify({ id }) })
  const body = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
  if (!res.ok || !body.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
}

function LiveView({ closeMode, uptime }: { closeMode: CloseMode; uptime: boolean }) {
  const { preferences, change } = useCardPreferences('at-cards')
  const [range, setRange] = useState<string>(() => read<string>('at-hours', '6'))
  const [hidden, setHidden] = useState<Set<Harness>>(() => new Set(read('at-hidden', '').split(',').filter(Boolean) as Harness[]))
  const [activeOnly, setActiveOnly] = useState(() => read<string>('at-active', '') === '1')
  const [closed, setClosed] = useState<Set<string>>(() => new Set(read('at-closed', '').split(',').filter(Boolean)))
  const [names, rename] = useNames(() => {
    try {
      return JSON.parse(read('at-names', '{}'))
    } catch {
      return {}
    }
  })
  const live = useLiveAgents(true, range)
  useEffect(() => save('at-names', JSON.stringify(names)), [names])

  useEffect(() => save('at-hours', range), [range])
  useEffect(() => save('at-hidden', [...hidden].join(',')), [hidden])
  useEffect(() => save('at-active', activeOnly ? '1' : ''), [activeOnly])
  useEffect(() => save('at-closed', [...closed].join(',')), [closed])

  const { shown, more, closedCount } = useMemo(() => {
    const applied = applyClosed(live.agents, closed)
    const all = retireFinished(spreadClosed(applyCardPreferences(withNames(applied, names), preferences)))
    return { ...pickTrees(all, hidden, activeOnly, live.now), closedCount: applied.filter((a) => a.closed && !a.parentId).length }
  }, [live.agents, closed, hidden, activeOnly, live.now, names, preferences])
  const numbered = useNumbers(shown, 'at-numbers')

  const toggle = (h: Harness) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(h)) next.delete(h)
      else next.add(h)
      return next
    })

  const windows: [string, string][] = [['boot', live.bootAt ? `Since ${clock(live.bootAt)}` : 'Since boot'], ...WINDOWS]

  let empty: ReactNode = null
  if (live.loading && !live.agents.length) empty = <p className="empty center">Reading sessions…</p>
  else if (live.error) empty = <p className="empty center">Could not read sessions: {live.error}</p>
  else empty = <p className="empty center">No identifiable agents found.</p>

  const rangeLabel = windows.find(([v]) => v === range)?.[1] ?? ''
  const filters = (
    <FilterMenu label={rangeLabel} changed={hidden.size + (activeOnly ? 1 : 0)}>
      <div className="menu-label">Apps</div>
      <div className="filter-chips">
        {HARNESSES.map((h) => {
          const src = live.sources.find((s) => s.harness === h)
          return (
            <button key={h} className={`chip ${hidden.has(h) ? 'off' : ''}`} aria-pressed={!hidden.has(h)} onClick={() => toggle(h)} title={src?.error ?? (src && !src.found ? 'Not installed' : undefined)}>
              <HarnessIcon harness={h} size={12} />
              {HARNESS_LABEL[h]}
              <span className="chip-n">{src ? (src.found ? src.sessions : '–') : ''}</span>
            </button>
          )
        })}
      </div>
      <div className="menu-label">Time</div>
      <Segmented value={range} onChange={setRange} options={windows} />
      <label className="ctl-check menu-check">
        <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
        Active only
      </label>
    </FilterMenu>
  )

  return (
    <>
      <div className="stage live-stage">
        <AgentTree
          agents={numbered}
          now={live.now}
          showHarness
          estimated
          empty={empty}
          title=""
          actions={<ClosedNote count={closedCount} onShow={() => setClosed(new Set())} />}
          onRename={rename}
          onMarkDone={(id) => change(id, { doneAt: numbered.find((a) => a.id === id)?.markedDone ? undefined : live.now })}
          onMarkClosed={(id) => change(id, { closedAt: preferences[id]?.closedAt ? undefined : live.now })}
          onColorChange={(id, color) => change(id, { color })}
          tools={filters}
          closeMode={closeMode}
          onCloseAgent={async (id) => {
            if (closeMode === 'stop') await stopAgent(id)
            setClosed((prev) => new Set(prev).add(id))
          }}
        />
        {more > 0 && <p className="empty">{more} older sessions hidden.</p>}
      </div>
      {uptime && live.bootAt && <Uptime since={live.bootAt} />}
    </>
  )
}

/** Keeps the most recently active trees for the visible harnesses. */
function pickTrees(agents: AgentNode[], hidden: Set<Harness>, activeOnly: boolean, now: number) {
  const visible = agents.filter((a) => !hidden.has(a.harness))
  const byId = new Map(visible.map((a) => [a.id, a]))
  const rootOf = (a: AgentNode): string => {
    let cur = a
    for (let i = 0; i < 20 && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)!
    return cur.id
  }
  const trees = new Map<string, { last: number; active: boolean; members: AgentNode[] }>()
  for (const a of visible) {
    const r = rootOf(a)
    const t = trees.get(r) ?? { last: 0, active: false, members: [] }
    t.members.push(a)
    t.last = Math.max(t.last, a.endedAt ?? now)
    if (a.status === 'running' || a.status === 'needs-you' || a.status === 'failed') t.active = true
    trees.set(r, t)
  }
  const ranked = [...trees.values()].filter((t) => !activeOnly || t.active).sort((a, b) => b.last - a.last)
  return { shown: ranked.slice(0, MAX_TREES).flatMap((t) => t.members), more: Math.max(0, ranked.length - MAX_TREES) }
}

/** A funnel button that opens the filters. Its tooltip names the time window, and a dot shows when other filters are on. */
function FilterMenu({ label, changed, children }: { label: string; changed: number; children: ReactNode }) {
  const [open, setOpen, ref] = usePopover()
  const summary = `Filter · ${label}${changed > 0 ? ` · ${changed} more` : ''}`
  return (
    <div className="filter" ref={ref}>
      <button className="filter-btn" aria-label={summary} title={summary} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Funnel size={14} />
        {changed > 0 && <span className="filter-dot" />}
      </button>
      {open && (
        <div className="menu filter-menu" role="dialog" aria-label="Filters">
          {children}
        </div>
      )}
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
