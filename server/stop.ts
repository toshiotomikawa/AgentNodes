import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface StopResult {
  ok: boolean
  message: string
}

const home = os.homedir()
const win = process.platform === 'win32'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDedicatedCodexResume(commandLine: string, threadId: string): boolean {
  if (!UUID.test(threadId)) return false
  return new RegExp(`^\\s*(?:"[^"]+"|\\S+)\\s+resume\\s+(?:"${threadId}"|${threadId})(?=$|\\s)`, 'i').test(commandLine)
}

/** Image name of a running process, or undefined when it is gone. */
function processName(pid: number): string | undefined {
  if (!win) {
    try {
      return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim() || undefined
    } catch {
      return undefined
    }
  }
  const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  const m = out.match(/^"([^"]+)","(\d+)"/m)
  return m && Number(m[2]) === pid ? m[1] : undefined
}

/** Ends a process and its children (tools, shells) it started. */
function killTree(pid: number) {
  if (win) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else process.kill(pid, 'SIGTERM')
}

/** Claude Code writes ~/.claude/sessions/<pid>.json for every running session. */
function stopClaude(sessionId: string): StopResult {
  const dir = path.join(home, '.claude', 'sessions')
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))
  } catch {}
  for (const f of files) {
    let info: { pid?: number; sessionId?: string }
    try {
      info = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch {
      continue
    }
    if (info.sessionId !== sessionId || !info.pid) continue
    const name = processName(info.pid)
    // The pid may have been reused by another program since the file was written.
    if (!name || !/claude/i.test(name)) continue
    killTree(info.pid)
    return { ok: true, message: 'Claude Code session stopped.' }
  }
  return { ok: false, message: 'This Claude Code session is not running, so there is nothing to stop.' }
}

/** A Codex thread can only be stopped when a codex process was started for it, as in `codex resume <id>`. */
function stopCodex(threadId: string): StopResult {
  if (!win) return { ok: false, message: 'Stopping Codex is only supported on Windows for now.' }
  const ps = `Get-CimInstance Win32_Process -Filter "Name like 'codex%'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim()
  const list: { ProcessId: number; CommandLine: string | null }[] = raw ? [JSON.parse(raw)].flat() : []
  // Only a dedicated `codex resume <UUID>` process, never an app-server or a substring match.
  const hit = list.find((p) => p.CommandLine && isDedicatedCodexResume(p.CommandLine, threadId))
  if (!hit) return { ok: false, message: 'This Codex thread has no process of its own, so it cannot be stopped from here. Stop it in Codex.' }
  killTree(hit.ProcessId)
  return { ok: true, message: 'Codex process stopped.' }
}

/** OpenCode V2 runs a local service; its interrupt route stops the session's current run. */
async function stopOpenCode(sessionId: string): Promise<StopResult> {
  let rt: { url?: string; password?: string }
  try {
    rt = JSON.parse(fs.readFileSync(path.join(home, '.local', 'state', 'opencode', 'service.json'), 'utf8'))
  } catch {
    return { ok: false, message: 'The OpenCode service is not running.' }
  }
  const url = rt.url ? new URL(rt.url) : undefined
  // Only ever talk to a service on this PC.
  if (!url || url.protocol !== 'http:' || url.username || url.password || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return { ok: false, message: 'The OpenCode service is not on this PC.' }
  const res = await fetch(new URL(`/api/session/${encodeURIComponent(sessionId)}/interrupt`, url), {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: 'Basic ' + Buffer.from(`opencode:${rt.password ?? ''}`).toString('base64') },
    signal: AbortSignal.timeout(5000),
  })
  if (res.ok) return { ok: true, message: 'OpenCode session stopped.' }
  if (res.status === 404) return { ok: false, message: 'OpenCode does not know this session any more.' }
  return { ok: false, message: `OpenCode refused to stop it (HTTP ${res.status}).` }
}

/** Stops the real agent behind a node id from collect(). */
export async function stopAgent(id: string): Promise<StopResult> {
  const [kind, rest = ''] = [id.slice(0, 2), id.slice(3)]
  if (!rest || id[2] !== ':') return { ok: false, message: 'Unknown agent.' }
  if ((kind === 'cc' || kind === 'cx') && !UUID.test(rest)) {
    return { ok: false, message: 'Invalid session identifier.' }
  }
  if (kind === 'cc') {
    return stopClaude(rest)
  }
  if (kind === 'cx') return stopCodex(rest)
  if (kind === 'oc') return stopOpenCode(rest)
  return { ok: false, message: 'Unknown agent.' }
}
