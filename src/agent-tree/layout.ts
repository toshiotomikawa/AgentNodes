import type { AgentNode } from './types'

/** Narrowest card. Cards widen up to CARD_W_MAX to fill the grid. */
export const CARD_W = 264
export const CARD_W_MAX = 320
export const CARD_H = 122
/** Initial height estimate before expanded details are measured. */
export const CARD_H_OPEN = 280
/** Space between a root card and its row of children. The bus line runs through the middle. */
const ROW_GAP = 40
/** Space between cards in a row. */
export const COL_GAP = 40
const STACK_GAP = 13
const INDENT = 32
/** Distance from a card's left edge to the rail that links it to its stacked children. */
const RAIL = 20
/** Distance from a stacked card's top to where its connector enters. */
const ENTRY = 20
const BUS_R = 10
const ELBOW_R = 8

export interface TreeNode {
  agent: AgentNode
  children: TreeNode[]
}

export interface Edge {
  id: string
  d: string
  dimmed: boolean
  parentId: string
  kind: 'row' | 'stack'
  offsetY?: number
}

/** A dashed line from a session to one forked from it, such as a side chat. */
export interface Link {
  id: string
  d: string
  offsetY?: number
}

export interface Dot {
  id: string
  x: number
  y: number
}

/** Card height for a node. Expanded cards are taller. */
export type HeightOf = (n: TreeNode) => number
/** Requested card width, given its collapsed width. */
export type WidthOf = (n: TreeNode, base: number) => number

export interface Layout {
  cards: Map<string, { x: number; y: number; w: number; h: number }>
  edges: Edge[]
  links: Link[]
  dots: Dot[]
  width: number
  baseWidth: number
  height: number
}

interface Size {
  w: number
  h: number
}

/** A stack reserves the widest card, including the indentation of its descendants. */
function stackSize(n: TreeNode, hOf: HeightOf, cardW: number, wOf: WidthOf): Size {
  let h = hOf(n)
  let w = wOf(n, cardW)
  for (const c of n.children) {
    const child = stackSize(c, hOf, cardW - INDENT, wOf)
    h += STACK_GAP + child.h
    w = Math.max(w, INDENT + child.w)
  }
  return { w, h }
}

/** Cards stacked under their parent, each level indented and narrower, linked by a rail on the left. */
function placeStack(n: TreeNode, x: number, y: number, out: Layout, hOf: HeightOf, cardW: number, wOf: WidthOf) {
  out.cards.set(n.agent.id, { x, y, w: wOf(n, cardW), h: hOf(n) })
  if (!n.children.length) return
  const rx = x + RAIL
  const py = y + hOf(n)
  out.dots.push({ id: n.agent.id, x: rx, y: py })
  let cy = py
  for (const c of n.children) {
    cy += STACK_GAP
    const ey = cy + ENTRY
    out.edges.push({
      id: c.agent.id,
      parentId: n.agent.id,
      kind: 'stack',
      d: `M ${rx} ${py} V ${ey - ELBOW_R} Q ${rx} ${ey} ${rx + ELBOW_R} ${ey} H ${x + INDENT}`,
      dimmed: c.agent.status === 'stopped',
    })
    placeStack(c, x + INDENT, cy, out, hOf, cardW - INDENT, wOf)
    cy += stackSize(c, hOf, cardW - INDENT, wOf).h
  }
}

/** Columns a block of width `w` takes on the grid. */
const spanOf = (w: number, g: Grid) => Math.max(1, Math.ceil((w + COL_GAP - 0.5) / g.pitch))

/** The root on top, its children in one row below, each child's own children stacked under it. */
function rowPlan(root: TreeNode, hOf: HeightOf, g: Grid, wOf: WidthOf) {
  const xs: number[] = []
  let x = 0
  const sizes = root.children.map((c) => stackSize(c, hOf, g.w, wOf))
  for (const size of sizes) {
    xs.push(x)
    x += size.w + COL_GAP
  }
  const rootX = xs[Math.floor((xs.length - 1) / 2)]
  const height = hOf(root) + ROW_GAP + Math.max(...sizes.map((size) => size.h))
  const width = Math.max(x - COL_GAP, rootX + wOf(root, g.w))
  return { xs, rootX, span: spanOf(width, g), width, height }
}

function placeRow(root: TreeNode, plan: ReturnType<typeof rowPlan>, ox: number, oy: number, out: Layout, hOf: HeightOf, g: Grid, wOf: WidthOf) {
  const rootX = ox + plan.rootX
  const rootW = wOf(root, g.w)
  out.cards.set(root.agent.id, { x: rootX, y: oy, w: rootW, h: hOf(root) })
  const rcx = rootX + rootW / 2
  const py = oy + hOf(root)
  const busY = py + ROW_GAP / 2
  const rowY = py + ROW_GAP
  out.dots.push({ id: root.agent.id, x: rcx, y: py })
  root.children.forEach((c, i) => {
    const x = ox + plan.xs[i]
    const cx = x + wOf(c, g.w) / 2
    const dx = cx - rcx
    // Keep the same path commands even for a straight connector, so CSS can interpolate it.
    const s = Math.sign(dx) || 1
    const r = Math.min(BUS_R, Math.abs(dx) / 2)
    const d =
      `M ${rcx} ${py} V ${busY - r} Q ${rcx} ${busY} ${rcx + s * r} ${busY} ` +
      `H ${cx - s * r} Q ${cx} ${busY} ${cx} ${busY + r} V ${rowY}`
    out.edges.push({ id: c.agent.id, parentId: root.agent.id, kind: 'row', d, dimmed: c.agent.status === 'stopped' })
    placeStack(c, x, rowY, out, hOf, g.w, wOf)
  })
}

interface Grid {
  /** Card width. */
  w: number
  /** Card width plus the gap: the distance between column starts. */
  pitch: number
  cols: number
}

/**
 * Cards stretch between CARD_W and CARD_W_MAX so the columns fill `width` edge to edge. Past
 * CARD_W_MAX the columns keep that width and the grid is narrower than `width`.
 */
function gridFor(width: number): Grid {
  const cols = Math.max(1, Math.floor((width + COL_GAP) / (CARD_W + COL_GAP)))
  const w = Math.min(CARD_W_MAX, Math.max(CARD_W, (width - (cols - 1) * COL_GAP) / cols))
  return { w, pitch: w + COL_GAP, cols }
}

/**
 * Lays out one or more trees on one shared column grid, so every card lines up with the cards
 * above and below it. Each tree, in order, goes to the columns whose cards end highest, leftmost
 * first, so a short tree never leaves a hole under it while a tall neighbor finishes. A tree whose
 * row of children needs more columns than there are falls back to the stacked style. Expansion
 * keeps these places while expanded cards displace individual neighbors where they make contact.
 */
export function layoutForest(roots: TreeNode[], maxWidth: number, hOf: HeightOf = () => CARD_H, requestedWidth: WidthOf = (_n, base) => base): Layout {
  const g = gridFor(maxWidth)
  const baseWidth: WidthOf = (_n, base) => base
  const wOf = baseWidth
  const compactHeight = () => CARD_H
  const out: Layout = { cards: new Map(), edges: [], links: [], dots: [], width: 0, baseWidth: 0, height: 0 }
  const beside = besideOf(roots)
  roots = forksBeside(roots, beside)
  const plans = roots.map((r) => {
    if (r.children.length) {
      const compact = rowPlan(r, compactHeight, g, baseWidth)
      if (compact.span <= g.cols) {
        const plan = rowPlan(r, compactHeight, g, wOf)
        return { kind: 'row' as const, plan, span: compact.span, w: plan.width, h: plan.height, baseH: compact.height }
      }
    }
    const s = stackSize(r, compactHeight, g.w, wOf)
    return { kind: 'stack' as const, span: 1, w: s.w, h: s.h, baseH: stackSize(r, () => CARD_H, g.w, baseWidth).h }
  })
  // Where each column is free from, by collapsed heights only, so expanding a card never moves a tree.
  // Trees are one row gap apart, the same as a root and its children, so rows stay even.
  const free = Array<number>(g.cols).fill(0)
  const placed = new Map<string, { col: number; span: number; y: number }>()
  // The last tree placed on each side of an origin, so the next one lines up beyond it.
  const tail = new Map<string, string>()
  const leftTail = new Map<string, string>()
  let used = 1
  // A fork sits to the right of its origin and an A2A peer to the left, so a tree with others
  // beside it looks for room for all of them in one row, when they fit.
  const isPeer = (r: TreeNode) => beside.has(r.agent.id) && r.agent.forkOf !== beside.get(r.agent.id)
  const headOf = (id: string): string => (beside.has(id) ? headOf(beside.get(id)!) : id)
  const unitSpan = new Map<string, number>()
  const leftSpan = new Map<string, number>()
  roots.forEach((r, i) => {
    const h = headOf(r.agent.id)
    const s = Math.min(plans[i].span, g.cols)
    unitSpan.set(h, (unitSpan.get(h) ?? 0) + s)
    if (isPeer(r) && beside.get(r.agent.id) === h) leftSpan.set(h, (leftSpan.get(h) ?? 0) + s)
  })
  plans.forEach((p, i) => {
    const span = Math.min(p.span, g.cols)
    const id = roots[i].agent.id
    const whole = beside.has(id) ? span : unitSpan.get(id) ?? span
    const room = whole <= g.cols ? whole : span
    let col = 0
    let y = Infinity
    for (let c = 0; c + room <= g.cols; c++) {
      const top = Math.max(...free.slice(c, c + room))
      if (top < y) (y = top), (col = c)
    }
    if (room === whole) col += leftSpan.get(id) ?? 0
    // Beside its origin, or beyond the last tree already there, when those columns are free by then,
    // so the link stays short.
    const head = beside.get(id)
    const left = isPeer(roots[i])
    const origin = placed.get((left ? leftTail : tail).get(head ?? '') ?? head ?? '')
    const next = !origin ? -1 : left ? origin.col - span : origin.col + origin.span
    if (origin && next >= 0 && next + span <= g.cols && Math.max(...free.slice(next, next + span)) <= origin.y) (col = next), (y = origin.y)
    placed.set(id, { col, span, y })
    if (head && origin && col === next && y === origin.y) (left ? leftTail : tail).set(head, id)
    const x = col * g.pitch
    if (p.kind === 'row') placeRow(roots[i], p.plan, x, y, out, compactHeight, g, wOf)
    else placeStack(roots[i], x, y, out, compactHeight, g.w, wOf)
    out.width = Math.max(out.width, x + p.w)
    out.height = Math.max(out.height, y + p.h)
    for (let c = col; c < col + span; c++) free[c] = y + p.baseH + ROW_GAP
    used = Math.max(used, col + span)
  })
  out.baseWidth = used * g.pitch - COL_GAP
  expandCards(roots, out, hOf, requestedWidth)
  for (const r of roots) {
    const a = out.cards.get(r.agent.forkOf ?? '')
    const b = out.cards.get(r.agent.id)!
    if (a) out.links.push({ id: r.agent.id, d: linkPath(a, b) })
  }
  // Sessions that talked agent-to-agent are joined too, once per pair, unless one already leads to the other.
  const treeOf = new Map<string, string>()
  const all: TreeNode[] = []
  const walk = (n: TreeNode, root: string) => {
    treeOf.set(n.agent.id, root)
    all.push(n)
    n.children.forEach((c) => walk(c, root))
  }
  roots.forEach((r) => walk(r, r.agent.id))
  const drawn = new Set<string>()
  for (const n of all) {
    for (const p of n.agent.peers ?? []) {
      const key = [n.agent.id, p].sort().join('|')
      const a = out.cards.get(n.agent.id)
      const b = out.cards.get(p)
      if (!a || !b || drawn.has(key) || treeOf.get(p) === treeOf.get(n.agent.id)) continue
      drawn.add(key)
      out.links.push({ id: `peer:${key}`, d: peerPath(a, b) })
    }
  }
  return out
}

/** Like a fork's link, except that two cards in one row with others between them are joined over the top. */
function peerPath(a: Box, b: Box): string {
  const [l, r] = a.x < b.x ? [a, b] : [b, a]
  if (Math.abs(a.y - b.y) > 1 || r.x - l.x - l.w <= COL_GAP + 1) return linkPath(a, b)
  const x1 = l.x + l.w * 0.75
  const x2 = r.x + r.w * 0.25
  const top = a.y - 18
  return `M ${x1} ${a.y} C ${x1} ${top} ${x2} ${top} ${x2} ${a.y}`
}

/**
 * The tree each tree sits beside: the one it was forked from, or else an earlier tree holding a
 * session it talked to agent-to-agent.
 */
function besideOf(roots: TreeNode[]): Map<string, string> {
  const index = new Map(roots.map((r, i) => [r.agent.id, i]))
  const rootOf = new Map<string, string>()
  const walk = (n: TreeNode, root: string) => {
    rootOf.set(n.agent.id, root)
    n.children.forEach((c) => walk(c, root))
  }
  roots.forEach((r) => walk(r, r.agent.id))
  const out = new Map<string, string>()
  roots.forEach((r, i) => {
    if (r.agent.forkOf && index.has(r.agent.forkOf)) return void out.set(r.agent.id, r.agent.forkOf)
    const peers: string[] = []
    const visit = (n: TreeNode) => {
      for (const p of n.agent.peers ?? []) if (rootOf.has(p)) peers.push(rootOf.get(p)!)
      n.children.forEach(visit)
    }
    visit(r)
    const first = peers.filter((p) => index.get(p)! < i).sort((a, b) => index.get(a)! - index.get(b)!)[0]
    if (first) out.set(r.agent.id, first)
  })
  return out
}

/** Each tree followed by the trees forked from it or talking to it. */
function forksBeside(roots: TreeNode[], beside: Map<string, string>): TreeNode[] {
  const forks = new Map<string, TreeNode[]>()
  for (const r of roots) {
    const o = beside.get(r.agent.id)
    if (o) forks.set(o, [...(forks.get(o) ?? []), r])
  }
  const out: TreeNode[] = []
  const seen = new Set<TreeNode>()
  const add = (r: TreeNode) => {
    if (seen.has(r)) return
    seen.add(r)
    out.push(r)
    forks.get(r.agent.id)?.forEach(add)
  }
  roots.filter((r) => !beside.has(r.agent.id)).forEach(add)
  roots.forEach(add)
  return out
}

type Box = { x: number; y: number; w: number; h: number }

/** From the side of `a` that faces `b`, at the middle of the collapsed card, so expanding a card keeps the line still. */
function linkPath(a: Box, b: Box): string {
  const ay = a.y + CARD_H / 2
  const by = b.y + CARD_H / 2
  if (b.x >= a.x + a.w) return curve(a.x + a.w, ay, b.x, by)
  if (a.x >= b.x + b.w) return curve(a.x, ay, b.x + b.w, by)
  // One above the other: leave and enter on the right, bowing out past both.
  const x1 = a.x + a.w
  const x2 = b.x + b.w
  const out = Math.max(x1, x2) + COL_GAP / 2
  return `M ${x1} ${ay} C ${out} ${ay} ${out} ${by} ${x2} ${by}`
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
}

/** When anything in a tree last did something: now while it runs, else its last write, end or start. */
function lastActivity(n: TreeNode, now: number): number {
  const a = n.agent
  const own = a.status === 'running' ? now : a.activeAt ?? a.endedAt ?? a.startedAt
  return Math.max(own, ...n.children.map(c => lastActivity(c, now)))
}

/**
 * Keep connected trees together, grouped by their latest activity: Recent (under an hour), then
 * One hour, One day and One week, each holding what is at least that old. Trees closed here or in
 * their own app go under Closed, at the bottom. Empty bands are hidden.
 */
export function layoutAgeGroups(roots: TreeNode[], maxWidth: number, now: number, hOf: HeightOf = () => CARD_H, wOf: WidthOf = (_n, base) => base): Layout & { sections: { label: string; y: number }[] } {
  const hour = 3600_000
  const bands = [
    { label: 'Recent', limit: hour },
    { label: 'One hour', limit: 24 * hour },
    { label: 'One day', limit: 7 * 24 * hour },
    { label: 'One week', limit: Infinity },
    { label: 'Closed', limit: Infinity },
  ]
  const groups = bands.map(() => [] as TreeNode[])
  const band = (label: string) => bands.findIndex(b => b.label === label)
  // A tree and the trees forked from it share a section, so the link between them stays visible.
  const byId = new Map(roots.map(r => [r.agent.id, r]))
  const headOf = (r: TreeNode) => {
    let cur = r
    for (let i = 0; i < 20 && cur.agent.forkOf && byId.has(cur.agent.forkOf); i++) cur = byId.get(cur.agent.forkOf)!
    return cur
  }
  const units = new Map<TreeNode, TreeNode[]>()
  for (const root of roots) {
    const head = headOf(root)
    units.set(head, [...(units.get(head) ?? []), root])
  }
  for (const unit of units.values()) {
    const age = Math.max(0, now - Math.max(...unit.map(r => lastActivity(r, now))))
    const index = unit.every(r => r.agent.closed || r.agent.ended) ? band('Closed') : bands.findIndex(b => age < b.limit)
    groups[index].push(...unit)
  }
  const out: Layout & { sections: { label: string; y: number }[] } = { cards: new Map(), edges: [], links: [], dots: [], width: 0, baseWidth: 0, height: 0, sections: [] }
  groups.forEach((group, index) => {
    if (!group.length) return
    const section = layoutForest(group, maxWidth, hOf, wOf)
    const y = out.height + (out.sections.length ? 24 : 0)
    const contentY = y + 36
    out.sections.push({ label: bands[index].label, y })
    for (const [id, box] of section.cards) out.cards.set(id, { ...box, y: box.y + contentY })
    out.edges.push(...section.edges.map(edge => ({ ...edge, offsetY: contentY })))
    out.links.push(...section.links.map(link => ({ ...link, offsetY: contentY })))
    out.dots.push(...section.dots.map(dot => ({ ...dot, y: dot.y + contentY })))
    out.width = Math.max(out.width, section.width)
    out.baseWidth = Math.max(out.baseWidth, section.baseWidth)
    out.height = contentY + section.height
  })
  return out
}

/** Resolve expansion against actual cards, never the empty envelope of an entire tree. */
function expandCards(roots: TreeNode[], out: Layout, hOf: HeightOf, wOf: WidthOf) {
  const base = new Map([...out.cards].map(([id, box]) => [id, { ...box }]))
  const resize = (n: TreeNode) => {
    const box = out.cards.get(n.agent.id)!
    box.h = hOf(n)
    box.w = Math.max(box.w, wOf(n, box.w))
    n.children.forEach(resize)
  }
  roots.forEach(resize)
  const ids = [...out.cards.keys()]
  const horizontal: { left: string; right: string; gap: number }[] = []
  for (const left of ids) {
    const a = base.get(left)!
    for (const right of ids) {
      const b = base.get(right)!
      if (a.x + a.w <= b.x + 0.01 && a.y < b.y + b.h && b.y < a.y + a.h) {
        horizontal.push({ left, right, gap: Math.min(COL_GAP, b.x - a.x - a.w) })
      }
    }
  }
  // Width changes move only cards to the right on the same original row. Children follow
  // their parent's horizontal displacement, rather than reserving a wider column for it.
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false
    for (const edge of out.edges) {
      const parent = out.cards.get(edge.parentId)!
      const child = out.cards.get(edge.id)!
      const x = base.get(edge.id)!.x + parent.x - base.get(edge.parentId)!.x
      if (x > child.x + 0.01) { child.x = x; changed = true }
    }
    for (const { left, right, gap } of horizontal) {
      const a = out.cards.get(left)!
      const b = out.cards.get(right)!
      const x = a.x + a.w + gap
      if (x > b.x + 0.01) { b.x = x; changed = true }
    }
    if (!changed) break
  }
  // Height changes flow down only through cards whose horizontal bounds intersect.
  // Parent-child links also preserve room for their connectors when on different columns.
  const parentOf = new Map(out.edges.map(e => [e.id, e.parentId]))
  const ordered = ids.sort((a, b) => base.get(a)!.y - base.get(b)!.y)
  ordered.forEach((id, i) => {
    const b = out.cards.get(id)!
    const original = base.get(id)!
    for (const above of ordered.slice(0, i)) {
      const a = out.cards.get(above)!
      const old = base.get(above)!
      const gap = original.y - old.y - old.h
      if (gap < -0.01) continue
      if ((a.x < b.x + b.w && b.x < a.x + a.w) || parentOf.get(id) === above) {
        b.y = Math.max(b.y, a.y + a.h + Math.min(ROW_GAP, gap))
      }
    }
  })
  // Route the connectors to the final card bounds, including independently displaced children.
  for (const edge of out.edges) {
    const a = out.cards.get(edge.parentId)!
    const b = out.cards.get(edge.id)!
    const py = a.y + a.h
    if (edge.kind === 'stack') {
      const rx = a.x + RAIL
      const ey = b.y + ENTRY
      edge.d = `M ${rx} ${py} V ${ey - ELBOW_R} Q ${rx} ${ey} ${rx + ELBOW_R} ${ey} H ${b.x}`
    } else {
      const ax = a.x + a.w / 2
      const bx = b.x + b.w / 2
      const busY = py + ROW_GAP / 2
      const sign = Math.sign(bx - ax) || 1
      const r = Math.min(BUS_R, Math.abs(bx - ax) / 2)
      edge.d = `M ${ax} ${py} V ${busY - r} Q ${ax} ${busY} ${ax + sign * r} ${busY} ` +
        `H ${bx - sign * r} Q ${bx} ${busY} ${bx} ${busY + r} V ${b.y}`
    }
  }
  const kindOf = new Map(out.edges.map(e => [e.parentId, e.kind]))
  for (const dot of out.dots) {
    const box = out.cards.get(dot.id)!
    dot.x = box.x + (kindOf.get(dot.id) === 'row' ? box.w / 2 : RAIL)
    dot.y = box.y + box.h
  }
  out.width = Math.max(0, ...[...out.cards.values()].map(b => b.x + b.w))
  out.height = Math.max(0, ...[...out.cards.values()].map(b => b.y + b.h))
}
