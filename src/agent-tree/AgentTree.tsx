import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { formatCost, formatEffort, formatElapsed } from './format'
import { Check, Chevron, Clock, CopyIcon, Cross, HARNESS_LABEL, HarnessIcon, ProviderIcon, Spinner, Square, ToolIcon, Triangle } from './icons'
import { Markdown } from './Markdown'
import { CARD_H, CARD_H_OPEN, COL_GAP, layoutAgeGroups, type TreeNode } from './layout'
import { Blob, bounce, lookAt } from './Blob'
import { normalizeColor } from './card-preferences'
import { RollingNumber } from './RollingNumber'
import type { AgentNode, AgentStatus } from './types'

export type IssueKind = 'failed' | 'needs-you'

export interface AgentTreeProps {
  agents: AgentNode[]
  /** Epoch ms used for elapsed times of agents that are still going. */
  now: number
  title?: string
  /** Shows the harness name next to the model. */
  showHarness?: boolean
  /** Marks costs as API-price estimates. */
  estimated?: boolean
  /** Which issue list is open. Leave undefined to let the component manage it. */
  openIssues?: IssueKind | null
  onOpenIssuesChange?: (kind: IssueKind | null) => void
  onRetry?: (id: string) => void
  onDismiss?: (id: string) => void
  onAnswer?: (id: string, choice: string) => void
  /**
   * Called after the user confirms "Close" in the right-click menu. A rejected promise keeps the
   * dialog open and shows the error message.
   */
  onCloseAgent?: (id: string) => void | Promise<void>
  /** Renames a card. An empty name restores the original. */
  onRename?: (id: string, name: string) => void
  onMarkDone?: (id: string) => void
  /** Marks a card closed, or undoes it. */
  onMarkClosed?: (id: string) => void
  onColorChange?: (id: string, color?: string) => void
  /** "hide" (default) only hides the node. "stop" also ends the real agent; the dialog says so. */
  closeMode?: 'hide' | 'stop'
  /** Formats start and end times in expanded cards. Defaults to the local clock. */
  formatTime?: (ms: number) => string
  /** Centers the grid instead of aligning it to the left edge, as in the demo. */
  center?: boolean
  empty?: ReactNode
  /** Notes shown next to the title. */
  actions?: ReactNode
  /** Controls shown after the total, such as a filter menu. */
  tools?: ReactNode
}

const PILL: Record<AgentStatus, { label: string; icon: ReactNode }> = {
  running: { label: 'Running', icon: <Spinner /> },
  done: { label: 'Done', icon: <Check /> },
  failed: { label: 'Failed', icon: <Triangle /> },
  stopped: { label: 'Stopped', icon: <Square /> },
  'needs-you': { label: 'Waiting', icon: <Clock /> },
}
const CLOSED_PILL = { label: 'Closed', icon: <Cross /> }

const PAD = 18
/** Side margin of the grid. It matches the header's padding, so cards line up with the title and totals. */
const SIDE = 18
/** Space between the header and the first card. */
const TOP = 20

export function AgentTree(props: AgentTreeProps) {
  const { agents, now, title = 'Agents', showHarness, estimated } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // How much room each expanded card's details need, so the card grows to fit them without scrolling.
  const [detailSize, setDetailSize] = useState<Map<string, { h: number; w: number }>>(() => new Map())
  const onDetailSize = (id: string, h: number, w: number) =>
    setDetailSize((prev) => {
      const old = prev.get(id)
      return old && Math.abs(old.h - h) < 1 && Math.abs(old.w - w) < 1 ? prev : new Map(prev).set(id, { h, w })
    })
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ownOpen, setOwnOpen] = useState<IssueKind | null>(null)
  const open = props.openIssues !== undefined ? props.openIssues : ownOpen
  const setOpen = (k: IssueKind | null) => {
    setOwnOpen(k)
    props.onOpenIssuesChange?.(k)
  }

  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { childrenOf, roots, subtreeCost, total } = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]))
    const childrenOf = new Map<string, AgentNode[]>()
    const roots: AgentNode[] = []
    for (const a of agents) {
      if (a.parentId && byId.has(a.parentId)) {
        const list = childrenOf.get(a.parentId) ?? []
        list.push(a)
        childrenOf.set(a.parentId, list)
      } else roots.push(a)
    }
    const subtreeCost = new Map<string, number>()
    const sum = (a: AgentNode): number => {
      const v = a.cost + (childrenOf.get(a.id) ?? []).reduce((s, c) => s + sum(c), 0)
      subtreeCost.set(a.id, v)
      return v
    }
    const total = roots.reduce((s, r) => s + sum(r), 0)
    return { childrenOf, roots, subtreeCost, total }
  }, [agents])

  const layout = useMemo(() => {
    const build = (a: AgentNode): TreeNode => ({
      agent: a,
      children: collapsed.has(a.id) ? [] : (childrenOf.get(a.id) ?? []).map(build),
    })
    const hOf = (n: TreeNode) => {
      if (!expanded.has(n.agent.id)) return CARD_H
      const d = detailSize.get(n.agent.id)
      return d ? CARD_H + Math.ceil(d.h) : CARD_H_OPEN
    }
    const wOf = (n: TreeNode, base: number) => expanded.has(n.agent.id)
      ? Math.min(Math.max(base, detailSize.get(n.agent.id)?.w ?? 0), base * 2 + COL_GAP)
      : base
    return layoutAgeGroups(roots.map(build), width - SIDE * 2, now, hOf, wOf)
  }, [roots, childrenOf, collapsed, expanded, width, detailSize, now])

  const active = agents.filter((a) => !a.closed)
  const running = active.filter((a) => a.status === 'running').length
  const failed = active.filter((a) => a.status === 'failed')
  const waiting = active.filter((a) => a.status === 'needs-you')
  const issues = open === 'failed' ? failed : open === 'needs-you' ? waiting : []

  // Close the list once nothing is left in it.
  useEffect(() => {
    if (open && !issues.length) setOpen(null)
  })

  const flip = (id: string) => (prev: Set<string>) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  const toggle = (id: string) => setCollapsed(flip(id))
  const toggleOpen = (id: string) => setExpanded(flip(id))
  const countBelow = (id: string): number => (childrenOf.get(id) ?? []).reduce((n, c) => n + 1 + countBelow(c.id), 0)
  const confirmAgent = confirm ? agents.find((a) => a.id === confirm) : undefined

  const offsetX = props.center ? Math.max(SIDE, (width - layout.baseWidth) / 2) : SIDE

  return (
    <div className="agent-tree" ref={wrapRef}>
      <header className="at-header">
        <div className="at-title">
          {title && <span>{title}</span>}
          {props.actions}
        </div>
        <div className="at-stats">
          <span className="at-muted">
            {active.length} {active.length === 1 ? 'agent' : 'agents'}
          </span>
          {running > 0 && <span className="at-blue">{running} running</span>}
          {waiting.length > 0 && (
            <button className={`at-issue amber ${open === 'needs-you' ? 'open' : ''}`} onClick={() => setOpen(open === 'needs-you' ? null : 'needs-you')}>
              <Clock size={12} /> {waiting.length} waiting <Chevron size={12} up={open === 'needs-you'} />
            </button>
          )}
          {failed.length > 0 && (
            <button className={`at-issue red ${open === 'failed' ? 'open' : ''}`} onClick={() => setOpen(open === 'failed' ? null : 'failed')}>
              {failed.length} failed <Chevron size={12} up={open === 'failed'} />
            </button>
          )}
          <Total value={formatCost(total)} estimated={estimated} />
          {props.tools}
        </div>
        {open && issues.length > 0 && (
          <IssueList {...props} kind={open} agents={issues} onClose={() => setOpen(null)} />
        )}
      </header>

      <div className="at-canvas" style={{ width: Math.max(width, layout.width + offsetX + SIDE), height: layout.height + TOP + PAD }}>
        {roots.length === 0 && props.empty}
        {layout.sections.map(section => <div key={section.label} className="at-age-divider" role="separator" aria-label={section.label} style={{ left: offsetX, right: SIDE, top: section.y + TOP }}><span>{section.label}</span></div>)}
        <svg className="at-edges" width="100%" height={layout.height + TOP + PAD}>
          <g transform={`translate(${offsetX} ${TOP})`}>
            {layout.edges.map((e) => (
              <path key={e.id} className={`at-edge ${e.dimmed ? 'dim' : ''}`} d={e.d} transform={`translate(0 ${e.offsetY ?? 0})`} pathLength={1} />
            ))}
            {layout.links.map((l) => (
              <path key={`link:${l.id}`} className="at-link" d={l.d} transform={`translate(0 ${l.offsetY ?? 0})`} />
            ))}
            {layout.dots.map((d) => (
              <circle key={d.id} className="at-dot" cx={d.x} cy={d.y} r={3.5} />
            ))}
          </g>
        </svg>
        {[...layout.cards].map(([id, pos]) => {
          const a = agents.find((x) => x.id === id)!
          const kids = childrenOf.get(id)?.length ?? 0
          return (
            <Card
              key={id}
              agent={a}
              x={pos.x + offsetX}
              y={pos.y + TOP}
              w={pos.w}
              h={pos.h}
              open={expanded.has(id)}
              onOpen={() => toggleOpen(id)}
              onDetailSize={(h, w) => onDetailSize(id, h, w)}
              onMenu={(e) => {
                e.preventDefault()
                setMenu({ id, x: e.clientX, y: e.clientY })
              }}
              formatTime={props.formatTime ?? clockTime}
              cost={subtreeCost.get(id) ?? a.cost}
              fromNum={a.closedFrom ? agents.find((x) => x.id === a.closedFrom)?.num : undefined}
              elapsed={(a.endedAt ?? now) - a.startedAt}
              kids={kids}
              collapsed={collapsed.has(id)}
              onToggle={() => toggle(id)}
              onClose={props.onCloseAgent ? () => setConfirm(id) : undefined}
              renaming={renaming === id}
              onRenameStart={props.onRename ? () => setRenaming(id) : undefined}
              onRenameEnd={(name) => {
                setRenaming(null)
                if (name !== null && name !== a.name) props.onRename?.(id, name)
              }}
              showHarness={showHarness}
            />
          )
        })}
      </div>
      {menu && (
        <CardMenu
          key={menu.id}
          x={menu.x}
          y={menu.y}
          color={agents.find(a => a.id === menu.id)?.color}
          markedDone={agents.find(a => a.id === menu.id)?.markedDone}
          markedClosed={agents.find(a => a.id === menu.id)?.markedClosed}
          onMarkDone={props.onMarkDone ? () => { props.onMarkDone!(menu.id); setMenu(null) } : undefined}
          onMarkClosed={props.onMarkClosed && (agents.find(a => a.id === menu.id)?.markedClosed || !agents.find(a => a.id === menu.id)?.closed)
            ? () => { props.onMarkClosed!(menu.id); setMenu(null) } : undefined}
          onColorChange={props.onColorChange ? (color) => { props.onColorChange!(menu.id, color); setMenu(null) } : undefined}
          onRename={
            props.onRename
              ? () => {
                  setRenaming(menu.id)
                  setMenu(null)
                }
              : undefined
          }
          onClose={
            props.onCloseAgent
              ? () => {
                  setConfirm(menu.id)
                  setMenu(null)
                }
              : undefined
          }
          onDismiss={() => setMenu(null)}
        />
      )}
      {confirmAgent && props.onCloseAgent && (
        <ConfirmClose
          agent={confirmAgent}
          below={countBelow(confirmAgent.id)}
          stop={props.closeMode === 'stop'}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await props.onCloseAgent!(confirmAgent.id)
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

const clockTime = (ms: number) => {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n))

const CARD_COLORS = [['Amber', '#e3a93f'], ['Blue', '#4f8df5'], ['Gray', '#919199'], ['Green', '#75a35b'], ['Orange', '#d97757'], ['Purple', '#8c7be0'], ['Rose', '#e2588c'], ['Teal', '#2fa37a']]

function CardMenu(p: { x: number; y: number; color?: string; markedDone?: boolean; markedClosed?: boolean; onRename?: () => void; onMarkDone?: () => void; onMarkClosed?: () => void; onColorChange?: (color?: string) => void; onClose?: () => void; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const focusColor = useRef(false)
  const [colors, setColors] = useState(false)
  const [hex, setHex] = useState(p.color?.replace(/^#/, '') ?? '')
  const [error, setError] = useState(false)
  const [size, setSize] = useState({ w: 200, h: 200 })
  const [subSize, setSubSize] = useState({ w: 180, h: 220 })
  useLayoutEffect(() => {
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const next = { w: e.borderBoxSize[0].inlineSize, h: e.borderBoxSize[0].blockSize }
        const update = e.target === mainRef.current ? setSize : setSubSize
        update(previous => previous.w === next.w && previous.h === next.h ? previous : next)
      }
    })
    if (mainRef.current) ro.observe(mainRef.current)
    if (subRef.current) ro.observe(subRef.current)
    if (colors && focusColor.current) {
      subRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      focusColor.current = false
    }
    return () => ro.disconnect()
  }, [colors])
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && p.onDismiss()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (colors) { setColors(false); triggerRef.current?.focus() }
      else p.onDismiss()
    }
    const away = () => p.onDismiss()
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  })
  // Keep the menu on screen.
  const left = Math.max(8, Math.min(p.x, window.innerWidth - size.w - 8))
  const top = Math.max(8, Math.min(p.y, window.innerHeight - size.h - 8))
  const subLeft = left + size.w + subSize.w <= window.innerWidth - 8 ? left + size.w : Math.max(8, left - subSize.w)
  const subTop = Math.max(8, Math.min(top, window.innerHeight - subSize.h - 8))
  const actions = [
    { label: 'Change color', action: p.onColorChange ? () => setColors(true) : undefined, color: true },
    { label: p.markedDone ? 'Undo mark as done' : 'Mark as done', action: p.onMarkDone },
    { label: p.markedClosed ? 'Undo mark as closed' : 'Mark as closed', action: p.onMarkClosed },
    { label: 'Rename', action: p.onRename },
  ].filter(item => item.action).sort((a, b) => a.label.localeCompare(b.label))
  return (
    <div ref={ref} className="at-menu-group" onPointerLeave={() => setColors(false)} onContextMenu={e => e.preventDefault()}>
      <div className="menu at-menu" ref={mainRef} style={{ left, top, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }} role="menu" aria-label="Card actions">
        {actions.map(item => <button key={item.label} role="menuitem" className={item.color ? 'at-submenu-trigger' : undefined}
          ref={item.color ? triggerRef : undefined}
          aria-haspopup={item.color ? 'dialog' : undefined} aria-expanded={item.color ? colors : undefined} aria-controls={item.color && colors ? 'card-color-submenu' : undefined}
          onPointerEnter={() => setColors(!!item.color)} onClick={item.action}
          onKeyDown={item.color ? e => { if (e.key === 'ArrowRight') { e.preventDefault(); if (colors) subRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); else { focusColor.current = true; setColors(true) } } } : undefined}>
          {item.label}{item.color && <Chevron size={12} right />}
        </button>)}
        {p.onClose && <><div className="menu-sep" role="separator" /><button role="menuitem" className="danger" onPointerEnter={() => setColors(false)} onClick={p.onClose}>Close</button></>}
      </div>
      {colors && <div className="menu at-color-submenu" id="card-color-submenu" ref={subRef} style={{ left: subLeft, top: subTop, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }} role="dialog" aria-label="Change color"
        onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); setColors(false); triggerRef.current?.focus() } }}>
        <div className="at-colors" role="group" aria-label="Preset colors">
          {CARD_COLORS.map(([name, color]) => <button key={color} aria-label={name} aria-pressed={p.color === color} title={name} style={{ background: color }} onClick={() => p.onColorChange?.(color)} />)}
        </div>
        <form className="at-hex" onSubmit={e => {
          e.preventDefault()
          const color = normalizeColor(hex)
          if (color) p.onColorChange?.(color)
          else setError(true)
        }}>
          <label htmlFor="card-hex">Hex color</label>
          <div><span className="at-hex-prefix" aria-hidden="true">#</span><input id="card-hex" placeholder="8c7be0" value={hex} maxLength={7} spellCheck={false} aria-invalid={error} aria-describedby={error ? 'card-hex-error' : undefined} onChange={e => { setHex(e.target.value.trim().replace(/^#/, '')); setError(false) }} /><button type="submit">Apply</button></div>
          {error && <span id="card-hex-error" role="alert">Use 3 or 6 hex digits.</span>}
        </form>
        <div className="at-color-reset"><button type="button" aria-label="Revert to default color" title="Revert to default color" onClick={() => p.onColorChange?.(undefined)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" /></svg></button></div>
      </div>}
    </div>
  )
}

function ConfirmClose(p: { agent: AgentNode; below: number; stop: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const okRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => okRef.current?.focus(), [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && p.onCancel()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })
  const subs = p.below > 0 ? ` and its ${p.below} ${p.below === 1 ? 'subagent' : 'subagents'}` : ''
  const what = p.stop
    ? `This stops the real agent${subs}, then hides it from this view. Any work in progress is cut off.`
    : `It${subs} will be hidden from this view. The agent itself is not stopped.`
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await p.onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && p.onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="close-title">
        <h2 id="close-title">
          {p.stop ? 'Stop' : 'Close'} {p.agent.name}?
        </h2>
        <p>{what}</p>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={p.onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={p.stop ? 'btn-primary btn-danger' : 'btn-primary'} ref={okRef} onClick={confirm} disabled={busy}>
            {busy ? 'Stopping…' : p.stop ? 'Stop' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

const pad3 = (n: number) => String(n).padStart(3, '0')

function Card(p: {
  agent: AgentNode
  /** Number of the agent that used this finished one, shown before its own. */
  fromNum?: number
  x: number
  y: number
  w: number
  h: number
  open: boolean
  onOpen: () => void
  onDetailSize: (h: number, w: number) => void
  onMenu: (e: MouseEvent) => void
  formatTime: (ms: number) => string
  cost: number
  elapsed: number
  kids: number
  collapsed: boolean
  onToggle: () => void
  onClose?: () => void
  renaming: boolean
  onRenameStart?: () => void
  /** The new name, or null when renaming was cancelled. */
  onRenameEnd: (name: string | null) => void
  showHarness?: boolean
}) {
  const a = p.agent
  // A closed session shows Closed, in gray, whatever it last did.
  const pill = a.closed ? CLOSED_PILL : PILL[a.status]
  const blobRef = useRef<HTMLSpanElement>(null)
  return (
    <div
      className={`at-card s-${a.status} ${a.closed ? 'is-closed' : ''} ${p.open ? 'open' : ''}`}
      style={{ left: p.x, top: p.y, width: p.w, height: p.h, borderColor: a.color }}
      title={p.open ? undefined : a.task}
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      onClick={p.onOpen}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          p.onOpen()
        }
      }}
      onContextMenu={p.onMenu}
      onPointerEnter={() => bounce(blobRef.current)}
      onPointerMove={(e) => lookAt(blobRef.current, e.clientX, e.clientY)}
      onPointerLeave={() => lookAt(blobRef.current)}
    >
      {p.onClose && (
        <span className="at-x-zone">
          <button
            className="at-x"
            aria-label={`Close ${a.name}`}
            title="Close"
            onClick={(e) => {
              e.stopPropagation()
              p.onClose!()
            }}
          >
            <Cross />
          </button>
        </span>
      )}
      {a.num !== undefined && (
        <span className={`at-num ${p.fromNum !== undefined ? 'from' : ''}`} title={`Card #${pad3(a.num)}${p.fromNum !== undefined ? `, used by #${pad3(p.fromNum)}` : ''}`}>
          {p.fromNum !== undefined && <span className="at-from">#{pad3(p.fromNum)} › </span>}#{pad3(a.num)}
        </span>
      )}
      <div className="at-card-top">
        <div className="at-avatar">
          <span
            className="at-blob-hit"
            onClick={(e) => {
              e.stopPropagation()
              bounce(blobRef.current)
            }}
          >
            <Blob model={a.model} color={a.color} asleep={a.closed} ref={blobRef} />
          </span>
          <span className="at-provider">
            <ProviderIcon provider={a.provider} />
          </span>
        </div>
        <div className="at-names">
          {p.renaming ? (
            <input
              className="at-name at-name-input"
              defaultValue={a.name}
              aria-label="Name"
              autoFocus
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') p.onRenameEnd(e.currentTarget.value.trim())
                if (e.key === 'Escape') {
                  // The blur that follows then sees the old name and changes nothing.
                  e.currentTarget.value = a.name
                  p.onRenameEnd(null)
                }
              }}
              onBlur={(e) => p.onRenameEnd(e.currentTarget.value.trim())}
            />
          ) : (
            <div
              className={`at-name ${p.onRenameStart ? 'renamable' : ''}`}
              title={p.onRenameStart ? 'Double-click to rename' : undefined}
              onClick={p.onRenameStart ? e => e.stopPropagation() : undefined}
              onDoubleClick={
                p.onRenameStart
                  ? (e) => {
                      e.stopPropagation()
                      p.onRenameStart!()
                    }
                  : undefined
              }
            >
              {a.name}
            </div>
          )}
          <div className="at-model" title={p.showHarness ? `${a.model} in ${HARNESS_LABEL[a.harness]}` : a.model}>
            {p.showHarness && <span className="at-harness" title={HARNESS_LABEL[a.harness]}><HarnessIcon harness={a.harness} size={12} /></span>}
            {a.model}
            {a.effort && ` (${formatEffort(a.effort)})`}
          </div>
        </div>
      </div>
      <div className="at-task">
        {a.tools.length > 0 && (
          <span className="at-tools">
            {a.tools.slice(0, 3).map((t) => (
              <ToolIcon key={t} tool={t} size={11} />
            ))}
          </span>
        )}
        {a.task}
      </div>
      {p.open && <Details agent={a} cost={p.cost} formatTime={p.formatTime} showHarness={p.showHarness} onSize={p.onDetailSize} />}
      <div className="at-foot">
        <span>
          <RollingNumber className="at-cost" value={formatCost(p.cost)} />
          <span className="at-muted"> · {formatElapsed(p.elapsed)}</span>
        </span>
        {p.kids > 0 ? (
            <button
              className="at-toggle"
              onClick={(e) => {
                e.stopPropagation()
                p.onToggle()
              }}
              aria-label={p.collapsed ? 'Show subagents' : 'Hide subagents'}
            >
              {p.kids}
              <Chevron size={12} up={p.collapsed} />
            </button>
        ) : (
          <span />
        )}
        <span className={`at-pill at-foot-end p-${a.closed ? 'closed' : a.status}`}>
          {pill.icon}
          {pill.label}
        </span>
      </div>
    </div>
  )
}

/** The total cost. When it is an estimate, hovering or clicking it explains why. */
function Total({ value, estimated }: { value: string; estimated?: boolean }) {
  const [pinned, setPinned] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!pinned) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setPinned(false)
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [pinned])
  if (!estimated) return <span className="at-total"><RollingNumber value={value} /></span>
  return (
    <span className={`at-total est ${pinned ? 'pinned' : ''}`} ref={ref} tabIndex={0} role="button" aria-describedby="at-total-tip" onClick={() => setPinned(!pinned)}>
      <span className="at-est">est.</span>
      <RollingNumber value={value} />
      <span className="at-tip" id="at-total-tip" role="tooltip">
        Costs are estimates at API list prices from token usage, not what your subscription charges.
      </span>
    </span>
  )
}

/** Copies text to the clipboard. The local page counts as a secure context, so the async API works. */
const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {})

function Details(p: { agent: AgentNode; cost: number; formatTime: (ms: number) => string; showHarness?: boolean; onSize: (h: number, w: number) => void }) {
  const a = p.agent
  const d = a.details ?? {}
  const t = d.tokens
  // Label, value, and whether the value is code.
  const rows: [string, string, boolean?][] = []
  if (p.showHarness) rows.push(['Harness', HARNESS_LABEL[a.harness]])
  if (d.modelId) rows.push(['Model', d.modelId, true])
  const model = d.catalogue
  if (model) {
    rows.push(['Provider', model.provider])
    if (model.context) rows.push(['Context', `${model.context.toLocaleString()} tokens`])
    if (model.output) rows.push(['Max output', `${model.output.toLocaleString()} tokens`])
    if (model.releaseDate) rows.push(['Released', model.releaseDate])
    const capabilities = [model.reasoning && 'Reasoning', model.toolCall && 'Tools', ...(model.inputModalities ?? []).filter(m => m !== 'text')].filter(Boolean)
    if (capabilities.length) rows.push(['Supports', capabilities.join(' · ')])
  }
  rows.push(['Started', p.formatTime(a.startedAt)])
  if (a.endedAt) rows.push(['Ended', p.formatTime(a.endedAt)])
  rows.push(['Cost', formatCost(a.cost)])
  if (Math.abs(p.cost - a.cost) > 0.005) rows.push(['With subagents', formatCost(p.cost)])
  if (t) rows.push(['Tokens', `${compact(t.input)} in · ${compact(t.output)} out`])
  if (t && (t.cacheRead || t.cacheWrite)) rows.push(['Cache', `${compact(t.cacheRead)} read · ${compact(t.cacheWrite)} write`])
  if (d.threads && d.threads > 1) rows.push(['Threads', String(d.threads)])
  if (d.toolCounts?.length) rows.push(['Tools', d.toolCounts.map(([n, c]) => `${n} ×${c}`).join(', ')])
  if (d.folder) rows.push(['Folder', d.folder, true])
  if (d.sessionId) rows.push(['Session', d.sessionId, true])
  // The last message is the fuller text; a failure's own message says what went wrong.
  const message = (a.status !== 'failed' && d.lastMessage) || a.issue?.message || d.lastMessage
  const messageLabel = 'Message'

  // Which value was just copied ('all' for Copy all), shown for a moment.
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 1400)
    return () => clearTimeout(id)
  }, [copied])
  const take = (key: string, text: string) => {
    copy(text)
    setCopied(key)
  }
  const all = () =>
    [
      a.name,
      a.effort ? `${a.model} (${formatEffort(a.effort)})` : a.model,
      a.task,
      '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      ...(message ? ['', `${messageLabel}: ${message}`] : []),
    ].join('\n')

  // Report the room the content needs: its height, and the card width that fits the longest value
  // on one line. Values that still do not fit are cut, with the whole value in their tooltip.
  const ref = useRef<HTMLDivElement>(null)
  const onSize = useRef(p.onSize)
  onSize.current = p.onSize
  const report = () => {
    const el = ref.current
    if (!el) return
    const box = el.parentElement!
    const card = box.parentElement!
    const cs = getComputedStyle(box)
    const px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0
    const h = el.offsetHeight + px('padding-top') + px('padding-bottom') + px('margin-top') + px('margin-bottom') + px('border-top-width')
    // Everything around the content: the card's border and the details' side padding.
    const frame = card.offsetWidth - el.clientWidth
    let w = 0
    for (const v of el.querySelectorAll<HTMLElement>('.at-copy')) {
      const left = v.getBoundingClientRect().left - el.getBoundingClientRect().left
      w = Math.max(w, left + v.scrollWidth)
    }
    onSize.current(h, Math.ceil(w + frame + 2))
  }
  useLayoutEffect(report)
  useLayoutEffect(() => {
    const ro = new ResizeObserver(report)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  // A message taller than its limit is cut, and an ellipsis marks the cut.
  const messageRef = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = messageRef.current
    setCut(!!el && el.scrollHeight > el.clientHeight + 1)
  })
  const Value = ({ k, v, code }: { k: string; v: string; code?: boolean }) => (
    <button className={`at-copy ${copied === k ? 'copied' : ''}`} title={v} onClick={() => take(k, v)}>
      {code ? <code>{v}</code> : v}
    </button>
  )
  return (
    <div className="at-details" onClick={(e) => e.stopPropagation()}>
      <div ref={ref}>
        <p className="at-hint">{copied ? 'Copied.' : 'Click on a value to copy it.'}</p>
        <dl>
          {rows.map(([k, v, code]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                <Value k={k} v={v} code={code} />
              </dd>
            </div>
          ))}
        </dl>
        {model && <a className="at-catalogue-link" href="https://models.dev" target="_blank" rel="noreferrer">Model specifications · Models.dev</a>}
        {message && (
          <div className="at-last">
            <span>{messageLabel}</span>
            <div
              ref={messageRef}
              role="button"
              tabIndex={0}
              title="Click to copy"
              className={`at-copy wrap ${cut ? 'cut' : ''} ${copied === 'message' ? 'copied' : ''}`}
              onClick={() => take('message', message)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), take('message', message))}
            >
              <Markdown text={message} />
            </div>
          </div>
        )}
        <button className="at-copy-all" title="Copy all" aria-label="Copy all" onClick={() => take('all', all())}>
          {copied === 'all' ? <Check size={13} /> : <CopyIcon size={13} />}
        </button>
      </div>
    </div>
  )
}

function IssueList(p: AgentTreeProps & { kind: IssueKind; agents: AgentNode[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (!ref.current?.contains(t) && !t.closest('.at-issue')) p.onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  })
  return (
    <div className="at-popover" ref={ref}>
      {p.agents.map((a) => (
        <div key={a.id} className="at-pop-item">
          <div className="at-pop-head">
            <span className={`at-pop-icon ${p.kind === 'failed' ? 'red' : 'amber'}`}>
              {p.kind === 'failed' ? <Triangle size={12} /> : <Clock size={12} />}
            </span>
            <span className="at-pop-name">{a.name}</span>
            <span className="at-pop-task">{a.task}</span>
          </div>
          {a.issue?.message && <p className="at-pop-msg">{a.issue.message}</p>}
          <div className="at-pop-actions">
            {p.onDismiss && (
              <button className="btn-ghost" onClick={() => p.onDismiss!(a.id)}>
                Dismiss
              </button>
            )}
            {p.kind === 'needs-you' && p.onAnswer
              ? a.issue?.choices?.map((c) => (
                  <button key={c} className="btn-primary" onClick={() => p.onAnswer!(a.id, c)}>
                    {c}
                  </button>
                ))
              : null}
            {p.kind === 'failed' && p.onRetry && (
              <button className="btn-primary" onClick={() => p.onRetry!(a.id)}>
                Retry
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
