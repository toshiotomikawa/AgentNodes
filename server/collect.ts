/**
 * Reads agent sessions from the harnesses installed on this PC and turns them into agent tree
 * nodes. Everything is read-only. Databases are opened with readOnly, and only session tables are
 * queried; credential tables and auth files are never touched.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentDetails, AgentNode, AgentStatus, Harness, TokenCounts } from '../src/agent-tree/types'
import { fileURLToPath } from 'node:url'
import { antigravityOpen, codexThreadOpen, openClaudeSessions } from './liveness'
import { costOf, knownPrice, prettyModel, providerOf, type Usage } from './pricing'
import { fields, msg, num, str, time } from './protobuf'

const HOME = os.homedir()
/** An agent that wrote to its log this recently and has not ended its turn counts as running. */
const RUNNING_MS = 3 * 60_000
/** A main session that is not running waits for you this long, then counts as closed. A restart closes it sooner. */
const WAITING_MS = 24 * 3600_000

export interface SourceInfo {
  harness: Harness
  found: boolean
  sessions: number
  error?: string
}

export interface Snapshot {
  now: number
  /** When this PC was last turned on, epoch ms. */
  bootAt: number
  agents: AgentNode[]
  sources: SourceInfo[]
}

const short = (s: string, n = 140) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/** Like `short`, but keeps line breaks, so a message's Markdown survives. */
const clip = (s: string, n: number) => {
  const t = s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function toolKey(name: string): string {
  const n = name.toLowerCase()
  if (n.startsWith('mcp__')) {
    for (const brand of ['github', 'slack', 'notion', 'figma', 'stripe', 'hubspot', 'linear']) if (n.includes(brand)) return brand
    if (n.includes('browser') || n.includes('chrome')) return 'web'
    return 'plug'
  }
  if (/bash|shell|powershell|exec|terminal|command/.test(n)) return 'terminal'
  if (/read|grep|glob|search|find|list|ls/.test(n) && !/web/.test(n)) return 'search'
  if (/edit|write|patch|notebook/.test(n)) return 'edit'
  if (/web|fetch|browse/.test(n)) return 'web'
  if (/agent|task|spawn|session/.test(n)) return 'agent'
  if (/todo|plan/.test(n)) return 'todo'
  return 'tool'
}

function topTools(counts: Map<string, number>): string[] {
  const byKey = new Map<string, number>()
  for (const [name, n] of counts) {
    const k = toolKey(name)
    byKey.set(k, (byKey.get(k) ?? 0) + n)
  }
  return [...byKey].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k)
}

function toolList(counts: Map<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
}

/* ------------------------------------------------------------------ Claude Code */

interface Transcript {
  size: number
  carry: string
  firstAt?: number
  lastAt?: number
  cwd?: string
  model?: string
  /** Reasoning effort of the latest API request. */
  effort?: string
  usage: Map<string, { model: string; u: Usage }>
  firstPrompt?: string
  title?: string
  lastKind: 'none' | 'user' | 'tool' | 'end' | 'interrupt'
  lastText?: string
  tools: Map<string, number>
  /** Tool use ids of Agent/Task calls made in this transcript. */
  spawns: Set<string>
  /** When each shell command ran, by tool use id: start, end once its result came back, and the harnesses it names. */
  shells: Map<string, [number, number, string[]]>
  errors: Set<string>
  /**
   * The session this one continues. When a conversation runs out of context, Claude Code can carry
   * it on in a new transcript file with a new session id, whose summary names the old file.
   */
  continues?: string
  /** The session's own id. Set only for session files, whose copied history carries another id. */
  id?: string
  /**
   * The session this one was forked from, such as a side chat. A fork starts with a copy of the
   * original's history, still tagged with the original's id; those lines are skipped.
   */
  forkOf?: string
  /**
   * Sessions this one talked to agent-to-agent: whom it sent a SendMessage to, by name or pipe, and
   * who sent it a cross-session message, by pipe or desktop session id. Keys are `pipe:`, `name:` or `host:`.
   */
  peers: Set<string>
}

const transcripts = new Map<string, Transcript>()

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
  return ''
}

function isNoise(text: string) {
  return /^\s*<(command-|local-command|system-reminder|task-notification|user-prompt-submit-hook)/.test(text) || text.startsWith('Caveat:')
}

function readTranscript(file: string, size: number, id?: string): Transcript {
  let t = transcripts.get(file)
  if (!t || size < t.size) {
    t = { size: 0, carry: '', usage: new Map(), lastKind: 'none', tools: new Map(), spawns: new Set(), errors: new Set(), shells: new Map(), peers: new Set(), id }
    transcripts.set(file, t)
  }
  if (size === t.size) return t
  const fd = fs.openSync(file, 'r')
  try {
    const CHUNK = 8 << 20
    let pos = t.size
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos))
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      pos += n
      const text = t.carry + buf.subarray(0, n).toString('utf8')
      const lines = text.split('\n')
      t.carry = lines.pop() ?? ''
      for (const line of lines) parseTranscriptLine(t, line)
    }
    t.size = pos
  } finally {
    fs.closeSync(fd)
  }
  return t
}

function parseTranscriptLine(t: Transcript, line: string) {
  if (line.startsWith('{"type":"custom-title"') || line.startsWith('{"type":"agent-name"')) {
    try {
      const j = JSON.parse(line)
      t.title = j.customTitle ?? j.agentName ?? t.title
    } catch {}
    return
  }
  if (line.startsWith('{"type":"queue-operation"')) {
    // A message from another session arrives queued, wrapped in a tag that names its sender.
    try {
      const j = JSON.parse(line)
      const text = typeof j.content === 'string' ? j.content : ''
      if ((!t.id || j.sessionId === t.id) && text.startsWith('<cross-session-message')) {
        const head = text.slice(0, text.indexOf('>'))
        const pipe = /cc-msg-([0-9a-f]+)/.exec(head)
        const host = /from-session="([^"]+)"/.exec(head)
        if (pipe) t.peers.add(`pipe:${pipe[1]}`)
        if (host) t.peers.add(`host:${host[1]}`)
      }
    } catch {}
    return
  }
  if (line.startsWith('{"type":"api-request')) {
    // These lines can be huge, so the effort is matched rather than parsed.
    const m = /"output_config":\{[^{}]*"effort":"([a-z]+)"/.exec(line)
    if (m) t.effort = m[1]
    return
  }
  if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) return
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return
  }
  if (j.type !== 'user' && j.type !== 'assistant') return
  if (t.id && j.sessionId && j.sessionId !== t.id && !j.isCompactSummary) {
    t.forkOf ??= j.sessionId
    return
  }
  const at = Date.parse(j.timestamp)
  if (at) {
    t.firstAt ??= at
    t.lastAt = at
  }
  if (j.cwd) t.cwd = j.cwd
  const m = j.message
  if (!m) return
  if (j.type === 'assistant') {
    if (m.model && m.model !== '<synthetic>') t.model = m.model
    // Some versions record the effort on each reply instead of on the request line.
    if (typeof j.effort === 'string') t.effort = j.effort
    if (m.id && m.usage) {
      const u = m.usage
      t.usage.set(m.id, {
        model: m.model,
        u: {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
        },
      })
    }
    let usedTool = false
    let said = ''
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type === 'tool_use') {
        usedTool = true
        t.tools.set(b.name, (t.tools.get(b.name) ?? 0) + 1)
        if (b.name === 'Agent' || b.name === 'Task') t.spawns.add(b.id)
        if (b.name === 'SendMessage' && typeof b.input?.to === 'string') {
          const to: string = b.input.to
          const pipe = /cc-msg-([0-9a-f]+)/.exec(to)
          t.peers.add(pipe ? `pipe:${pipe[1]}` : `name:${to.replace(/\s*\[[^\]]*\]$/, '')}`)
        }
        // A background command returns at once and keeps running unseen, so only foreground ones count.
        if ((b.name === 'Bash' || b.name === 'PowerShell') && !b.input?.run_in_background && at) t.shells.set(b.id, [at, Infinity, harnessesIn(String(b.input?.command ?? ''))])
      } else if (b.type === 'text' && b.text?.trim()) said = b.text
    }
    if (usedTool) t.lastKind = 'tool'
    else if (said) {
      t.lastKind = 'end'
      t.lastText = said
    }
    return
  }
  // User line: a prompt, a tool result, or an interrupt marker.
  if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue
      if (b.is_error) t.errors.add(b.tool_use_id)
      const shell = t.shells.get(b.tool_use_id)
      if (shell && at) shell[1] = at
    }
  }
  if (j.isMeta) return
  const text = textOf(m.content)
  if (j.isCompactSummary) {
    const prev = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl/.exec(text)
    // A later compaction in the same file names this file itself.
    if (prev && prev[1] !== j.sessionId) t.continues = prev[1]
    return
  }
  if (text.includes('[Request interrupted by user')) {
    t.lastKind = 'interrupt'
    return
  }
  t.lastKind = 'user'
  if (!t.firstPrompt && text.trim() && !isNoise(text)) t.firstPrompt = text
}

function transcriptCost(t: Transcript) {
  let sum = 0
  for (const { model, u } of t.usage.values()) sum += costOf(model ?? t.model ?? '', u)
  return sum
}

function transcriptTokens(t: Transcript): Usage {
  const s: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const { u } of t.usage.values()) {
    s.input += u.input
    s.output += u.output
    s.cacheRead += u.cacheRead
    s.cacheWrite += u.cacheWrite
  }
  return s
}

function claudeDetails(t: Transcript, sessionId: string): AgentDetails {
  return {
    modelId: t.model,
    folder: t.cwd,
    sessionId,
    tokens: transcriptTokens(t),
    toolCounts: toolList(t.tools),
    lastMessage: t.lastText ? clip(t.lastText, 4000) : undefined,
  }
}

function claudeStatus(t: Transcript, mtime: number, now: number, isRoot: boolean): AgentStatus {
  const age = now - mtime
  if (t.lastKind === 'interrupt') return 'stopped'
  if (t.lastKind === 'end') return isRoot && age < WAITING_MS ? 'needs-you' : 'done'
  if (age < RUNNING_MS) return 'running'
  return 'done'
}

function collectClaude(since: number, now: number, out: AgentNode[]): SourceInfo {
  const root = path.join(HOME, '.claude', 'projects')
  const info: SourceInfo = { harness: 'claude-code', found: fs.existsSync(root), sessions: 0 }
  if (!info.found) return info
  const open = openClaudeSessions()
  const talked: { node: AgentNode; parts: Transcript[] }[] = []
  for (const proj of fs.readdirSync(root, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue
    const projDir = path.join(root, proj.name)
    let files: fs.Dirent[]
    try {
      files = fs.readdirSync(projDir, { withFileTypes: true })
    } catch {
      continue
    }
    // Read every session in the window first, so a conversation split across files becomes one node.
    const sessions = new Map<string, { t: Transcript; st: fs.Stats }>()
    const load = (sessionId: string) => {
      const hit = sessions.get(sessionId)
      if (hit) return hit
      const file = path.join(projDir, `${sessionId}.jsonl`)
      try {
        const st = fs.statSync(file)
        const s = { t: readTranscript(file, st.size, sessionId), st }
        sessions.set(sessionId, s)
        return s
      } catch {
        return undefined
      }
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue
      if (fs.statSync(path.join(projDir, f.name)).mtimeMs < since) continue
      load(f.name.slice(0, -6))
    }
    // Each session's earlier parts, oldest first. A part may be older than the window; it still counts.
    const continued = new Set<string>()
    const partsOf = (sessionId: string) => {
      const ids = [sessionId]
      for (let prev = sessions.get(sessionId)?.t.continues; prev && !ids.includes(prev) && load(prev); prev = sessions.get(prev)?.t.continues) {
        ids.unshift(prev)
        continued.add(prev)
      }
      return ids
    }
    const chains = [...sessions.keys()].map(partsOf)
    // Every part's id leads to the node of its whole chain, which carries the newest id.
    const nodeOf = new Map<string, string>()
    for (const ids of chains) if (!continued.has(ids[ids.length - 1])) for (const part of ids) nodeOf.set(part, `cc:${ids[ids.length - 1]}`)
    for (const [part, node] of nodeOf) claudeParts.set(part, node)
    const shown = new Set<string>()
    const forks: AgentNode[] = []
    for (const ids of chains) {
      const sessionId = ids[ids.length - 1]
      if (continued.has(sessionId)) continue
      const { st } = sessions.get(sessionId)!
      if (st.mtimeMs < since) continue
      const parts = ids.map((id) => sessions.get(id)!.t)
      const t = joinTranscripts(parts)
      if (!t.usage.size) continue
      info.sessions++
      shown.add(`cc:${sessionId}`)
      const project = t.cwd ? path.basename(t.cwd) : projectName(proj.name)
      // The newest part keeps its id, so Stop reaches the process that is running now.
      const id = `cc:${sessionId}`
      const status = claudeStatus(t, st.mtimeMs, now, true)
      // The open session may still carry an earlier part's id.
      const ended = !!open && status !== 'running' && !ids.some((part) => open.has(part))
      const forkOf = parts.map((p) => p.forkOf).find((f) => f && !ids.includes(f))
      const node: AgentNode = {
        id,
        parentId: null,
        ended,
        name: project,
        model: prettyModel(t.model),
        effort: t.effort,
        provider: 'anthropic',
        harness: 'claude-code',
        status,
        task: short(t.title ?? t.firstPrompt ?? 'Claude Code session'),
        tools: topTools(t.tools),
        cost: transcriptCost(t),
        startedAt: t.firstAt ?? st.birthtimeMs,
        activeAt: st.mtimeMs,
        endedAt: status === 'running' || (status === 'needs-you' && !ended) ? undefined : st.mtimeMs,
        issue: status === 'needs-you' ? { message: short(t.lastText ?? 'Finished its turn and is waiting for you.', 220) } : undefined,
        details: claudeDetails(t, sessionId),
      }
      out.push(node)
      for (const p of parts) shellsOf(node.id, p)
      if (parts.some((p) => p.peers.size)) talked.push({ node, parts })
      if (forkOf && nodeOf.has(forkOf)) {
        node.forkOf = nodeOf.get(forkOf)
        forks.push(node)
      }
      for (const part of ids) collectClaudeSubagents(path.join(projDir, part, 'subagents'), id, t, since, now, out)
    }
    // A link needs both ends on screen.
    for (const f of forks) if (!shown.has(f.forkOf!)) delete f.forkOf
  }
  // Sessions that talked agent-to-agent, once every project is read, since peers may sit in another.
  const keys = claudeSessionKeys()
  const ids = new Set(out.map((a) => a.id))
  for (const { node, parts } of talked) {
    const peers = new Set<string>()
    for (const p of parts) for (const k of p.peers) {
      const peer = claudeParts.get(keys.get(k) ?? '')
      if (peer && peer !== node.id && ids.has(peer)) peers.add(peer)
    }
    if (peers.size) node.peers = [...peers]
  }
  return info
}

/**
 * What other sessions call a Claude Code session: its message pipe, its name and its desktop
 * session id, each to its session id, from ~/.claude/sessions. A name two sessions share is left out.
 */
function claudeSessionKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  const dir = path.join(HOME, '.claude', 'sessions')
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))
  } catch {}
  const shared = new Set<string>()
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (typeof s.sessionId !== 'string') continue
      const pipe = /cc-msg-([0-9a-f]+)/.exec(String(s.messagingSocketPath ?? ''))
      if (pipe) keys.set(`pipe:${pipe[1]}`, s.sessionId)
      if (typeof s.hostSessionId === 'string') keys.set(`host:${s.hostSessionId}`, s.sessionId)
      if (typeof s.name === 'string') {
        const k = `name:${s.name}`
        if (keys.has(k) && keys.get(k) !== s.sessionId) shared.add(k)
        keys.set(k, s.sessionId)
      }
    } catch {}
  }
  for (const k of shared) keys.delete(k)
  return keys
}

/** One view of a conversation stored in several files: usage and tools add up, the rest comes from the newest part. */
function joinTranscripts(parts: Transcript[]): Transcript {
  if (parts.length === 1) return parts[0]
  const last = parts[parts.length - 1]
  const usage = new Map<string, { model: string; u: Usage }>()
  const tools = new Map<string, number>()
  for (const p of parts) {
    for (const [k, v] of p.usage) usage.set(k, v)
    for (const [k, n] of p.tools) tools.set(k, (tools.get(k) ?? 0) + n)
  }
  return {
    ...last,
    firstAt: parts.find((p) => p.firstAt)?.firstAt ?? last.firstAt,
    title: last.title ?? parts.findLast((p) => p.title)?.title,
    firstPrompt: parts.find((p) => p.firstPrompt)?.firstPrompt,
    usage,
    tools,
    spawns: new Set(parts.flatMap((p) => [...p.spawns])),
    errors: new Set(parts.flatMap((p) => [...p.errors])),
  }
}

function collectClaudeSubagents(dir: string, sessionNodeId: string, session: Transcript, since: number, now: number, out: AgentNode[]) {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  const subs: { id: string; meta: any; t: Transcript; mtime: number }[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(dir, name)
    const st = fs.statSync(file)
    if (st.mtimeMs < since) continue
    let meta: any = {}
    try {
      meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    } catch {}
    const t = readTranscript(file, st.size)
    shellsOf(`${sessionNodeId}/${name.slice(0, -6)}`, t)
    subs.push({ id: name.slice(0, -6), meta, t, mtime: st.mtimeMs })
  }
  // A subagent's parent is whichever transcript issued the tool call that spawned it.
  const owner = (toolUseId: string | undefined) => {
    if (!toolUseId) return sessionNodeId
    const sub = subs.find((s) => s.t.spawns.has(toolUseId))
    return sub ? `${sessionNodeId}/${sub.id}` : sessionNodeId
  }
  for (const s of subs) {
    const failed = s.meta.toolUseId && [session, ...subs.map((x) => x.t)].some((t) => t.errors.has(s.meta.toolUseId))
    let status = claudeStatus(s.t, s.mtime, now, false)
    if (failed && status !== 'running') status = 'failed'
    out.push({
      id: `${sessionNodeId}/${s.id}`,
      parentId: owner(s.meta.toolUseId),
      name: s.meta.agentType ? prettyAgentType(s.meta.agentType) : 'Subagent',
      model: prettyModel(s.t.model),
      effort: s.t.effort,
      provider: 'anthropic',
      harness: 'claude-code',
      status,
      task: short(s.meta.description ?? s.t.firstPrompt ?? ''),
      tools: topTools(s.t.tools),
      cost: transcriptCost(s.t),
      startedAt: s.t.firstAt ?? s.mtime,
      endedAt: status === 'running' ? undefined : s.mtime,
      issue: status === 'failed' ? { message: short(s.t.lastText ?? 'The subagent returned an error.', 220) } : undefined,
      details: { ...claudeDetails(s.t, s.id), folder: s.t.cwd ?? session.cwd },
    })
  }
}

function prettyAgentType(t: string) {
  return t.split(/[-_]/).map(cap).join(' ')
}

/** "C--Users-example-projects-AgentNodes" → "AgentNodes". */
function projectName(dirName: string) {
  const parts = dirName.split('-').filter(Boolean)
  return parts[parts.length - 1] ?? dirName
}

/* ------------------------------------------------------------------ Codex */

interface RolloutTail {
  size: number
  usage?: { input: number; cached: number; output: number }
  last?: 'started' | 'complete' | 'aborted'
  lastMessage?: string
  parent?: string
  tools: Map<string, number>
}

const rollouts = new Map<string, RolloutTail>()

function readRollout(file: string): RolloutTail | null {
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  const cached = rollouts.get(file)
  if (cached && cached.size === st.size) return cached
  const r: RolloutTail = { size: st.size, tools: new Map(), parent: cached?.parent }
  const fd = fs.openSync(file, 'r')
  try {
    if (r.parent === undefined) {
      const head = Buffer.alloc(Math.min(4096, st.size))
      fs.readSync(fd, head, 0, head.length, 0)
      r.parent = head.toString('utf8').match(/"parent_thread_id":"([^"]+)"/)?.[1] ?? ''
    }
    const len = Math.min(st.size, 6 << 20)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, st.size - len)
    const lines = buf.toString('utf8').split('\n')
    if (len < st.size) lines.shift()
    for (const line of lines) {
      if (!line.includes('"event_msg"') && !line.includes('"function_call"')) continue
      let j: any
      try {
        j = JSON.parse(line)
      } catch {
        continue
      }
      const p = j.payload ?? {}
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        const u = p.info.total_token_usage
        r.usage = { input: u.input_tokens ?? 0, cached: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0 }
      } else if (p.type === 'task_started') r.last = 'started'
      else if (p.type === 'task_complete') {
        r.last = 'complete'
        if (p.last_agent_message) r.lastMessage = p.last_agent_message
      } else if (p.type === 'turn_aborted') r.last = 'aborted'
      else if (p.type === 'agent_message' && p.message) r.lastMessage = p.message
      else if (p.type === 'function_call' && p.name) r.tools.set(p.name, (r.tools.get(p.name) ?? 0) + 1)
    }
  } finally {
    fs.closeSync(fd)
  }
  rollouts.set(file, r)
  return r
}

function collectCodex(since: number, now: number, out: AgentNode[]): SourceInfo {
  const dbFile = path.join(HOME, '.codex', 'state_5.sqlite')
  const info: SourceInfo = { harness: 'codex', found: fs.existsSync(dbFile), sessions: 0 }
  if (!info.found) return info
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    const rows = db
      .prepare(
        `select id, rollout_path, title, name, model, reasoning_effort, tokens_used, agent_nickname, agent_role, source,
                thread_source, created_at_ms, updated_at_ms, recency_at_ms, cwd
         from threads where updated_at_ms >= ? and archived = 0 order by created_at_ms`,
      )
      .all(since) as any[]
    const edges = new Map<string, string>()
    for (const e of db.prepare('select parent_thread_id, child_thread_id from thread_spawn_edges').all() as any[]) edges.set(e.child_thread_id, e.parent_thread_id)
    const ids = new Set(rows.map((r) => r.id))
    const guardians: { node: AgentNode; parent: string }[] = []
    for (const row of rows) {
      info.sessions++
      const file = String(row.rollout_path ?? '').replace(/^\\\\\?\\/, '')
      const tail = file ? readRollout(file) : null
      const model = row.model ?? 'gpt-6-sol'
      const u = tail?.usage
      const cost = u
        ? costOf(model, { input: Math.max(0, u.input - u.cached), cacheRead: u.cached, output: u.output, cacheWrite: 0 })
        : costOf(model, { input: row.tokens_used ?? 0, output: 0, cacheRead: 0, cacheWrite: 0 })
      const parent = edges.get(row.id) || tail?.parent || null
      const isSub = !!parent || String(row.source ?? '').includes('subagent')
      const age = now - Number(row.updated_at_ms)
      // Reopening a thread in Codex rewrites updated_at without any work; recency_at moves only with real turns.
      const activeAt = Number(row.recency_at_ms) || Number(row.updated_at_ms)
      let status: AgentStatus
      if (tail?.last === 'aborted') status = 'stopped'
      else if (tail?.last === 'started' && age < RUNNING_MS) status = 'running'
      else if (!isSub && tail?.last === 'complete' && age < WAITING_MS) status = 'needs-you'
      else status = 'done'
      const ended = !isSub && status !== 'running' && codexThreadOpen(row.id) === false
      const title = String(row.title ?? '').split('\n')[0]
      const node: AgentNode = {
        id: `cx:${row.id}`,
        parentId: parent && ids.has(parent) ? `cx:${parent}` : null,
        ended,
        name: row.agent_nickname || (row.agent_role ? cap(row.agent_role) : '') || (isSub ? row.name || 'Subagent' : row.name && row.name !== title ? row.name : path.basename(row.cwd ?? '') || 'Codex'),
        model: prettyModel(model),
        effort: row.reasoning_effort ?? undefined,
        provider: 'openai',
        harness: 'codex',
        status,
        task: short(row.thread_source === 'guardian_review' ? 'Review a command before it runs' : title || 'Codex thread'),
        tools: tail ? topTools(tail.tools) : [],
        cost,
        startedAt: Number(row.created_at_ms),
        activeAt,
        endedAt: status === 'running' || (status === 'needs-you' && !ended) ? undefined : activeAt,
        issue: status === 'needs-you' ? { message: short(tail?.lastMessage ?? 'Finished its turn and is waiting for you.', 220) } : undefined,
        details: {
          modelId: model,
          folder: row.cwd ? String(row.cwd).replace(/^\\\\\?\\/, '') : undefined,
          sessionId: row.id,
          tokens: u ? { input: Math.max(0, u.input - u.cached), cacheRead: u.cached, output: u.output, cacheWrite: 0 } : undefined,
          toolCounts: tail ? toolList(tail.tools) : undefined,
          lastMessage: tail?.lastMessage ? clip(tail.lastMessage, 4000) : undefined,
        },
      }
      // Auto-review threads are gathered and folded into one node per session below.
      if (row.thread_source === 'guardian_review') guardians.push({ node, parent: parent ?? '' })
      else out.push(node)
    }
    out.push(...foldGuardians(guardians))
  } finally {
    db.close()
  }
  return info
}

/**
 * Codex's auto-review starts a new "guardian" thread whenever it needs to judge a planned action,
 * and keeps it only for a while, so one session collects many. They are one helper to the user,
 * so each session gets a single Guardian review node that adds up all of its threads.
 */
function foldGuardians(threads: { node: AgentNode; parent: string }[]): AgentNode[] {
  // Grouped by the parent thread itself, so reviews whose session began before the window still fold.
  const byParent = new Map<string, AgentNode[]>()
  for (const { node, parent } of threads) byParent.set(parent, [...(byParent.get(parent) ?? []), node])
  const out: AgentNode[] = []
  for (const [parent, group] of byParent) {
    if (!parent) {
      out.push(...group)
      continue
    }
    const last = group[group.length - 1]
    const running = group.some((g) => g.status === 'running')
    const sum = (f: (t: TokenCounts) => number) => group.reduce((s, g) => s + (g.details?.tokens ? f(g.details.tokens) : 0), 0)
    const tools = new Map<string, number>()
    for (const g of group) for (const [k, n] of g.details?.toolCounts ?? []) tools.set(k, (tools.get(k) ?? 0) + n)
    out.push({
      ...last,
      id: `cx:${parent}/guardian`,
      status: running ? 'running' : 'done',
      task: 'Reviews commands before they run',
      cost: group.reduce((s, g) => s + g.cost, 0),
      startedAt: Math.min(...group.map((g) => g.startedAt)),
      endedAt: running ? undefined : Math.max(...group.map((g) => g.endedAt ?? g.startedAt)),
      issue: undefined,
      details: {
        ...last.details,
        tokens: { input: sum((t) => t.input), output: sum((t) => t.output), cacheRead: sum((t) => t.cacheRead), cacheWrite: sum((t) => t.cacheWrite) },
        toolCounts: toolList(tools),
        lastMessage: group.findLast((g) => g.details?.lastMessage)?.details?.lastMessage,
        threads: group.length,
      },
    })
  }
  return out
}

/* ------------------------------------------------------------------ OpenCode */

function collectOpenCode(since: number, now: number, out: AgentNode[]): SourceInfo {
  const dbFile = path.join(HOME, '.local', 'share', 'opencode', 'opencode.db')
  const info: SourceInfo = { harness: 'opencode', found: fs.existsSync(dbFile), sessions: 0 }
  if (!info.found) return info
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    const hasV2 = !!db.prepare("select 1 from sqlite_master where type='table' and name='session_v2'").get()
    if (!hasV2) {
      info.error = 'This OpenCode version has no session_v2 table.'
      return info
    }
    // Only session columns. The account and credential tables are never read.
    const rows = db
      .prepare(
        `select id, parent_id, title, agent, model, cost, tokens_input, tokens_output, tokens_reasoning,
                tokens_cache_read, tokens_cache_write, time_created, time_updated, time_idle, idle_outcome, directory
         from session_v2 where time_updated >= ? and time_archived is null order by time_created`,
      )
      .all(since) as any[]
    const ids = new Set(rows.map((r) => r.id))
    for (const r of rows) {
      info.sessions++
      let model: { id?: string; providerID?: string; variant?: string } = {}
      try {
        model = JSON.parse(r.model ?? '{}')
      } catch {}
      const modelId = model.id ?? ''
      const usage: Usage = {
        input: Number(r.tokens_input ?? 0),
        output: Number(r.tokens_output ?? 0) + Number(r.tokens_reasoning ?? 0),
        cacheRead: Number(r.tokens_cache_read ?? 0),
        cacheWrite: Number(r.tokens_cache_write ?? 0),
      }
      // Our price table when we know the model, else OpenCode's own API-price estimate.
      const cost = knownPrice(modelId) ? costOf(modelId, usage) : Number(r.cost ?? 0)
      const age = now - Number(r.time_updated)
      const isSub = !!r.parent_id
      let status: AgentStatus
      if (r.idle_outcome === 'failed') status = 'failed'
      else if (r.idle_outcome === 'interrupted') status = 'stopped'
      else if (!r.time_idle || Number(r.time_idle) < Number(r.time_updated) - 1000) status = age < RUNNING_MS ? 'running' : 'done'
      else status = !isSub && age < WAITING_MS ? 'needs-you' : 'done'
      out.push({
        id: `oc:${r.id}`,
        parentId: isSub && ids.has(r.parent_id) ? `oc:${r.parent_id}` : null,
        name: isSub ? cap(r.agent ?? 'subagent') : path.basename(String(r.directory ?? '')) || 'OpenCode',
        model: prettyModel(modelId),
        effort: model.variant,
        provider: providerOf(modelId),
        harness: 'opencode',
        status,
        task: short(r.title ?? 'OpenCode session'),
        tools: [],
        cost,
        startedAt: Number(r.time_created),
        activeAt: Number(r.time_updated),
        endedAt: status === 'running' || status === 'needs-you' ? undefined : Number(r.time_idle ?? r.time_updated),
        issue:
          status === 'failed'
            ? { message: 'The session ended with an error.' }
            : status === 'needs-you'
              ? { message: 'Finished its turn and is waiting for you.' }
              : undefined,
        details: {
          modelId: model.providerID ? `${model.providerID}/${modelId}` : modelId,
          folder: r.directory ?? undefined,
          sessionId: r.id,
          tokens: usage,
        },
      })
    }
  } finally {
    db.close()
  }
  return info
}

/* ------------------------------------------------------------------ Pi */

/** Pi writes one JSONL per session under ~/.pi/agent/sessions/<cwd>/. Small files, so reparsed when size changes. */
const piCache = new Map<string, { size: number; node: AgentNode }>()

function parsePi(file: string, st: fs.Stats, now: number): AgentNode | null {
  const hit = piCache.get(file)
  let node = hit && hit.size === st.size ? hit.node : null
  if (!node) {
    let head: any
    let modelId = ''
    let providerId = ''
    let effort: string | undefined
    let task = ''
    let last = ''
    let lastStop = ''
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    let piCost = 0
    const tools = new Map<string, number>()
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let o: any
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.type === 'session') head = o
      else if (o.type === 'model_change') (modelId = o.modelId ?? modelId), (providerId = o.provider ?? providerId)
      else if (o.type === 'thinking_level_change') effort = o.thinkingLevel
      else if (o.type === 'message' && o.message) {
        const m = o.message
        const text = (Array.isArray(m.content) ? m.content : []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
        if (m.role === 'user' && !task && text) task = text
        if (m.role === 'assistant') {
          if (m.model) modelId = m.model
          if (m.provider) providerId = m.provider
          if (m.thinkingLevel) effort = m.thinkingLevel
          const u = m.usage
          if (u) {
            usage.input += Number(u.input ?? 0)
            usage.output += Number(u.output ?? 0) + Number(u.reasoning ?? 0)
            usage.cacheRead += Number(u.cacheRead ?? 0)
            usage.cacheWrite += Number(u.cacheWrite ?? 0)
            piCost += Number(u.cost?.total ?? 0)
          }
          for (const b of m.content ?? []) if (b.type === 'toolCall') tools.set(b.name, (tools.get(b.name) ?? 0) + 1)
          lastStop = m.stopReason ?? ''
          if (text) last = text
        } else if (m.role === 'user' || m.role === 'toolResult') lastStop = ''
      }
    }
    if (!head) return null
    const id = String(head.id)
    const cost = knownPrice(modelId) ? costOf(modelId, usage) : piCost
    node = {
      id: `pi:${id}`,
      parentId: null,
      name: path.basename(String(head.cwd ?? '')) || 'Pi',
      model: prettyModel(modelId),
      effort,
      provider: providerOf(modelId),
      harness: 'pi',
      status: 'done',
      task: short(task || 'Pi session'),
      tools: topTools(tools),
      cost,
      startedAt: Date.parse(head.timestamp),
      details: {
        modelId: providerId ? `${providerId}/${modelId}` : modelId,
        folder: head.cwd,
        sessionId: id,
        tokens: usage,
        toolCounts: toolList(tools),
        lastMessage: last ? clip(last, 4000) : undefined,
      },
    }
    // Stop reason of the last assistant message is kept in the status below, via lastStop.
    ;(node as any)._stop = lastStop
    piCache.set(file, { size: st.size, node })
  }
  const age = now - st.mtimeMs
  const turnOver = (node as any)._stop === 'stop'
  const status: AgentStatus = !turnOver && age < RUNNING_MS ? 'running' : turnOver && age < WAITING_MS ? 'needs-you' : 'done'
  const { _stop, ...rest } = node as any
  return {
    ...rest,
    status,
    activeAt: st.mtimeMs,
    endedAt: status === 'done' ? st.mtimeMs : undefined,
    issue: status === 'needs-you' ? { message: 'Finished its turn and is waiting for you.' } : undefined,
  }
}

function collectPi(since: number, now: number, out: AgentNode[]): SourceInfo {
  const root = path.join(HOME, '.pi', 'agent', 'sessions')
  const info: SourceInfo = { harness: 'pi', found: fs.existsSync(root), sessions: 0 }
  if (!info.found) return info
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const f of fs.readdirSync(path.join(root, dir.name))) {
      if (!f.endsWith('.jsonl')) continue
      const file = path.join(root, dir.name, f)
      const st = fs.statSync(file)
      if (st.mtimeMs < since) continue
      const node = parsePi(file, st, now)
      if (!node) continue
      info.sessions++
      out.push(node)
    }
  }
  return info
}

/* ------------------------------------------------------------------ Antigravity */

/**
 * Antigravity keeps one data folder per front end: the app in ~/.gemini/antigravity, the agy
 * terminal in ~/.gemini/antigravity-cli and the older IDE in ~/.gemini/antigravity-ide. Each has a
 * conversation_summaries.db with one row per conversation, subagents included, and a
 * conversations/<id>.db per conversation whose steps carry the token usage.
 */
const AG_DIRS = ['antigravity', 'antigravity-cli', 'antigravity-ide']

interface AgUsage {
  /** Rows of `steps` already read; steps are only appended. */
  lastIdx: number
  /** Response ids already counted, since several steps can share one model response. */
  seen: Set<string>
  usage: Usage
  /** Model id from the newest generation, and the generation it came from. */
  model: string
  genIdx: number
  /** Size and time of the database and its write-ahead log when last read. */
  stamp: string
}

const agUsage = new Map<string, AgUsage>()

function stampOf(file: string) {
  return [file, `${file}-wal`].map((f) => (fs.existsSync(f) ? `${fs.statSync(f).size}:${fs.statSync(f).mtimeMs}` : '-')).join('|')
}

/** Token usage and model of one conversation, read incrementally from its own database. */
function readAgConversation(file: string): AgUsage | null {
  if (!fs.existsSync(file)) return null
  let u = agUsage.get(file)
  if (!u) agUsage.set(file, (u = { lastIdx: -1, seen: new Set(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model: '', genIdx: -1, stamp: '' }))
  const stamp = stampOf(file)
  if (stamp === u.stamp) return u
  u.stamp = stamp
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    for (const r of db.prepare('select idx, metadata from steps where idx > ? order by idx').all(u.lastIdx) as any[]) {
      u.lastIdx = Number(r.idx)
      // Step metadata field 9 is the model usage of the response that produced the step.
      const use = msg(fields(r.metadata), 9)
      if (!use.size) continue
      const id = str(use, 11) || `step-${r.idx}`
      if (u.seen.has(id)) continue
      u.seen.add(id)
      u.usage.input += num(use, 2)
      u.usage.output += num(use, 3)
      u.usage.cacheWrite += num(use, 4)
      u.usage.cacheRead += num(use, 5)
    }
    const last = db.prepare('select max(idx) idx from gen_metadata').get() as any
    if (last?.idx != null && Number(last.idx) !== u.genIdx) {
      u.genIdx = Number(last.idx)
      const row = db.prepare('select data from gen_metadata where idx = ?').get(u.genIdx) as any
      const gen = fields(row?.data)
      // The requested model, such as gemini-3.8-flash-high, is field 3.28; 1.19 holds a shortened serving name.
      u.model = str(msg(gen, 3), 28) || str(msg(gen, 1), 19) || u.model
    }
  } finally {
    db.close()
  }
  return u
}

/** Antigravity datetimes look like "2026-10-20 03:21:44.9337392+00:00". */
function agTime(s: unknown): number {
  const ms = Date.parse(String(s ?? '').replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

function agFolder(uris: unknown): string | undefined {
  try {
    const first = (JSON.parse(String(uris ?? '[]')) as string[])[0]
    return first ? fileURLToPath(first) : undefined
  } catch {
    return undefined
  }
}

function collectAntigravity(since: number, now: number, out: AgentNode[]): SourceInfo {
  const base = path.join(HOME, '.gemini')
  const dirs = AG_DIRS.map((d) => path.join(base, d)).filter((d) => fs.existsSync(path.join(d, 'conversation_summaries.db')))
  const info: SourceInfo = { harness: 'antigravity', found: dirs.length > 0, sessions: 0 }
  // The app also lists agy's conversations, so rows are merged by id. The row kept is the one whose
  // folder holds the conversation's own database, newest first when both do.
  const byId = new Map<string, { dir: string; row: any; hasDb: boolean }>()
  for (const dir of dirs) {
    const db = new DatabaseSync(path.join(dir, 'conversation_summaries.db'), { readOnly: true })
    let rows: any[]
    try {
      rows = db
        .prepare(
          `select conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, agent_name,
                  parent_conversation_id, killed, raw_summary
           from conversation_summaries`,
        )
        .all() as any[]
    } finally {
      db.close()
    }
    for (const row of rows) {
      if (agTime(row.last_modified_time) < since || !(Number(row.step_count) > 0)) continue
      const hasDb = fs.existsSync(path.join(dir, 'conversations', `${row.conversation_id}.db`))
      const prev = byId.get(row.conversation_id)
      const newer = !prev || agTime(row.last_modified_time) > agTime(prev.row.last_modified_time)
      if (!prev || (hasDb && !prev.hasDb) || (hasDb === prev.hasDb && newer)) byId.set(row.conversation_id, { dir, row, hasDb })
    }
  }
  const ids = new Set(byId.keys())
  for (const { dir, row: r } of byId.values()) {
    info.sessions++
    const id = String(r.conversation_id)
    const summary = fields(r.raw_summary)
    const conv = readAgConversation(path.join(dir, 'conversations', `${id}.db`))
    const modelId = conv?.model || ''
    const usage = conv?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const activeAt = agTime(r.last_modified_time)
    const isSub = !!r.parent_conversation_id
    // Open in either front end counts. A RUNNING row is trusted only while the conversation is
    // still loaded, since a crash leaves it behind.
    const locks = dirs.map((d) => antigravityOpen(d, id))
    const open = locks.includes(true) ? true : locks.includes(false) ? false : undefined
    let status: AgentStatus
    if (Number(r.killed)) status = 'stopped'
    else if (r.status === 'CASCADE_RUN_STATUS_RUNNING' && (open ?? now - activeAt < RUNNING_MS)) status = 'running'
    else status = !isSub && now - activeAt < WAITING_MS ? 'needs-you' : 'done'
    const ended = !isSub && status !== 'running' && open === false
    // Field 17.8 describes a subagent: its kind and the job it was given.
    const sub = msg(msg(summary, 17), 8)
    const folder = agFolder(r.workspace_uris)
    out.push({
      id: `ag:${id}`,
      parentId: isSub && ids.has(r.parent_conversation_id) ? `ag:${r.parent_conversation_id}` : null,
      ended,
      name: isSub ? (r.agent_name && r.agent_name !== 'self' ? cap(r.agent_name) : 'Subagent') : (folder && path.basename(folder)) || 'Antigravity',
      model: prettyModel(modelId),
      provider: providerOf(modelId),
      harness: 'antigravity',
      status,
      task: short(str(sub, 2) || r.title || r.preview || 'Antigravity conversation'),
      tools: [],
      cost: costOf(modelId, usage),
      startedAt: time(summary, 7) || activeAt,
      activeAt,
      endedAt: status === 'running' || (status === 'needs-you' && !ended) ? undefined : activeAt,
      issue: status === 'needs-you' ? { message: 'Finished its turn and is waiting for you.' } : undefined,
      details: {
        modelId: modelId || undefined,
        folder,
        sessionId: id,
        tokens: usage,
      },
    })
  }
  return info
}

/* ------------------------------------------------------------------ Entry */

/** Uptime counts from the last real boot. With Windows Fast Startup on, that can be days old. */
export const bootTime = () => Math.round(Date.now() - os.uptime() * 1000)

/** `since` is epoch ms: sessions with activity after it are included. */
/** Shell commands run by Claude Code sessions and subagents in this pass, to find what they dispatched. */
let shellRuns: { by: string; from: number; to: number; names: string[] }[] = []
/** Every Claude Code session id seen in this pass, earlier parts of a continued chain included, to its node. */
let claudeParts = new Map<string, string>()

/**
 * Dispatchers may record what they start in ~/.agentnodes/dispatch.jsonl, one JSON object per
 * line: {"by": "<dispatcher session id>", "child": "<started session id>", "harness": "opencode", "at": "<ISO time>"}.
 * Ids are the harness's own (a Claude Code session id, an OpenCode session id, a Codex thread id,
 * an Antigravity conversation id). A record is exact, so it wins over timing.
 */
function readDispatchLedger(): { by: string; child: string }[] {
  let text: string
  try {
    text = fs.readFileSync(path.join(HOME, '.agentnodes', 'dispatch.jsonl'), 'utf8')
  } catch {
    return []
  }
  const out: { by: string; child: string }[] = []
  for (const line of text.split('\n')) {
    try {
      const j = JSON.parse(line)
      if (typeof j.by === 'string' && typeof j.child === 'string') out.push({ by: j.by, child: j.child })
    } catch {}
  }
  return out
}

/** The harnesses a command starts by name, such as `opencode run` or `agy`. */
const HARNESS_COMMANDS: [string, RegExp][] = [
  ['opencode', /\bopencode\b/i],
  ['codex', /\bcodex\b/i],
  ['claude-code', /\bclaude\b/i],
  ['antigravity', /\bagy\b|antigravity/i],
  ['pi', /(^|[\s;&|"'(])pi(\.cmd|\.exe)?\s/i],
]
const harnessesIn = (cmd: string) => HARNESS_COMMANDS.filter(([, re]) => re.test(cmd)).map(([h]) => h)

function shellsOf(nodeId: string, t: Transcript) {
  // A command with no result yet is still running, up to the longest a command may run.
  for (const [from, to, names] of t.shells.values()) shellRuns.push({ by: nodeId, from, to: Math.min(to, from + 600_000), names })
}

/**
 * A session that began while exactly one Claude Code agent was running a shell command was
 * started by that command, directly (`opencode run`, `codex exec`, `claude -p`) or through a
 * script it ran. It becomes that agent's child. With two agents running commands at that moment
 * it is left alone, since the start time cannot tell them apart.
 */
function linkDispatched(agents: AgentNode[]) {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const rootOf = (id: string) => {
    let cur = byId.get(id)
    for (let i = 0; i < 20 && cur?.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)
    return cur?.id
  }
  // A harness's own id leads to its node: `oc:<id>`, `cx:<id>`, and so on, or a Claude chain's newest id.
  const nodeOfRaw = new Map<string, string>()
  for (const a of agents) if (!a.parentId) nodeOfRaw.set(a.id.slice(a.id.indexOf(':') + 1), a.id)
  for (const [part, node] of claudeParts) nodeOfRaw.set(part, node)
  const recorded = new Map<string, string>()
  for (const r of readDispatchLedger()) {
    const child = nodeOfRaw.get(r.child)
    const by = nodeOfRaw.get(r.by)
    if (child && by && child !== by) recorded.set(child, by)
  }
  const SLACK = 1000
  // Codex threads also start agents, often from background scripts, so their command times say
  // little. A Codex thread at work when a session began makes the timing match ambiguous.
  const codexBusy = agents.filter((c) => c.harness === 'codex' && !c.parentId)
  const busyAt = (t: number) => codexBusy.filter((c) => c.startedAt - SLACK <= t && t <= (c.activeAt ?? c.startedAt) + SLACK).map((c) => c.id)
  // A session working inside a Codex thread's own worktree was started by that thread.
  const dir = (a: AgentNode) => (a.details?.folder ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const worktreeOwner = (a: AgentNode) => {
    const d = dir(a)
    if (!d.includes('/.codex/worktrees/')) return undefined
    const owners = codexBusy.filter((c) => c.id !== a.id && dir(c) && d.startsWith(dir(c) + '/') && c.startedAt <= a.startedAt)
    const busy = owners.filter((c) => a.startedAt <= (c.activeAt ?? c.startedAt) + SLACK)
    return busy.length === 1 ? busy[0].id : owners.length === 1 ? owners[0].id : undefined
  }
  for (const a of [...agents].sort((x, y) => x.startedAt - y.startedAt)) {
    if (a.parentId || a.forkOf) continue
    const owner = recorded.has(a.id) ? undefined : worktreeOwner(a)
    if (owner) recorded.set(a.id, owner)
    const runs = shellRuns.filter((r) => r.from - SLACK <= a.startedAt && a.startedAt <= r.to + SLACK && byId.has(r.by))
    // A command that names the session's harness, such as `opencode run`, started it for sure.
    const named = runs.filter((r) => r.names.includes(a.harness))
    const by = recorded.has(a.id)
      ? new Set([recorded.get(a.id)!])
      : named.length
        ? new Set(named.map((r) => r.by))
        : new Set([...runs.map((r) => r.by), ...busyAt(a.startedAt)])
    // A Codex thread alone is never a timing match: it only rules out a Claude Code one.
    if (!recorded.has(a.id) && ![...by].some((b) => b.startsWith('cc:'))) continue
    for (const b of by) if (rootOf(b) === a.id) by.delete(b)
    if (by.size !== 1) continue
    const parent = [...by][0]
    // A finished run is done, not waiting: nobody answers a dispatched agent but its dispatcher.
    const settled = a.status === 'needs-you' ? { status: 'done' as const, issue: undefined, endedAt: a.activeAt ?? a.startedAt } : {}
    const linked = { ...a, ...settled, parentId: parent, ended: undefined, dispatched: true }
    byId.set(a.id, linked)
    agents[agents.indexOf(a)] = linked
  }
  return agents
}

export function collect(since: number): Snapshot {
  const now = Date.now()
  shellRuns = []
  claudeParts = new Map()
  const agents: AgentNode[] = []
  const sources: SourceInfo[] = []
  for (const [harness, fn] of [
    ['claude-code', collectClaude],
    ['codex', collectCodex],
    ['opencode', collectOpenCode],
    ['pi', collectPi],
    ['antigravity', collectAntigravity],
  ] as const) {
    try {
      sources.push(fn(since, now, agents))
    } catch {
      sources.push({ harness, found: true, sessions: 0, error: 'Unable to read this local source.' })
    }
  }
  const bootAt = bootTime()
  return { now, bootAt, agents: endTrees(settleRoots(linkDispatched(agents), now, bootAt)), sources }
}

/**
 * A main session that is not running waits for you, with its clock still ticking, until a day
 * has passed since it last wrote or the PC restarted. Then it counts as closed.
 */
function settleRoots(agents: AgentNode[], now: number, bootAt: number) {
  return agents.map((a) => {
    if (a.parentId || a.status === 'running' || a.activeAt === undefined) return a
    if (now - a.activeAt >= WAITING_MS || a.activeAt < bootAt) {
      const over = a.status === 'needs-you'
      return { ...a, ended: true, ...(over ? { status: 'done' as const, endedAt: a.activeAt, issue: undefined } : {}) }
    }
    if (a.ended || a.status !== 'done') return a
    const message = a.details?.lastMessage ? short(a.details.lastMessage, 220) : 'Finished its turn and is waiting for you.'
    return { ...a, status: 'needs-you' as const, endedAt: undefined, issue: { message } }
  })
}

/** A session closed in its app is over, along with its subagents: nothing in it runs or waits any more. */
function endTrees(agents: AgentNode[]) {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const rootOf = (a: AgentNode) => {
    let cur = a
    for (let i = 0; i < 20 && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)!
    return cur
  }
  return agents.map((a) => {
    if (!rootOf(a).ended) return a.ended ? { ...a, ended: undefined } : a
    if (a.status !== 'running' && a.status !== 'needs-you') return a
    return { ...a, status: 'done' as const, issue: undefined, endedAt: a.endedAt ?? Date.now() }
  })
}
