/**
 * Tells whether a session is still open in its app. Read-only: files are opened for reading and
 * processes are only probed, never signalled.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const win = process.platform === 'win32'

/** A pid whose image is claude, keyed by pid and process start, so a reused pid is checked again. */
const claudeImage = new Map<string, boolean>()

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isClaude(pid: number, procStart: string) {
  const key = `${pid}:${procStart}`
  let hit = claudeImage.get(key)
  if (hit === undefined) {
    try {
      const out = win
        ? execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
        : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' })
      hit = /claude/i.test(out)
    } catch {
      hit = false
    }
    claudeImage.set(key, hit)
  }
  return hit
}

/**
 * Session ids of the Claude Code sessions open right now. Claude Code writes
 * ~/.claude/sessions/<pid>.json while a session runs and removes it on exit; a file whose
 * process is gone was left by a crash. Undefined when the folder cannot be read, so nothing is
 * marked closed by mistake.
 */
export function openClaudeSessions(): Set<string> | undefined {
  const dir = path.join(HOME, '.claude', 'sessions')
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))
  } catch {
    return undefined
  }
  const open = new Set<string>()
  for (const f of files) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { pid?: number; sessionId?: string; procStart?: string }
      if (info.pid && info.sessionId && alive(info.pid) && isClaude(info.pid, String(info.procStart ?? ''))) open.add(info.sessionId)
    } catch {}
  }
  return open
}

/**
 * Whether Codex still has a thread open. Codex holds a lock on ~/.codex/thread-writer-locks/<id>.lock
 * while the thread is loaded, so reading it fails with EBUSY. A free or missing lock means the
 * thread was closed. Undefined when the folder is missing.
 */
export function codexThreadOpen(threadId: string): boolean | undefined {
  return lockHeld(path.join(HOME, '.codex', 'thread-writer-locks'), `${threadId}.lock`)
}

/**
 * Whether Antigravity still has a conversation open. The app and the agy terminal each hold a
 * lock on <data dir>/presence/<id>.lock while the conversation is loaded, like Codex does.
 */
export function antigravityOpen(dataDir: string, conversationId: string): boolean | undefined {
  return lockHeld(path.join(dataDir, 'presence'), `${conversationId}.lock`)
}

/** True while another process locks `dir/name`, false when it is free or missing, undefined when this OS cannot tell. */
function lockHeld(dir: string, name: string): boolean | undefined {
  // Elsewhere the lock is advisory and a plain read would succeed, so only Windows can tell.
  if (!win || !fs.existsSync(dir)) return undefined
  let fd: number
  try {
    fd = fs.openSync(path.join(dir, name), 'r')
  } catch {
    return false
  }
  try {
    fs.readSync(fd, Buffer.alloc(1), 0, 1, 0)
    return false
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EBUSY' || (e as NodeJS.ErrnoException).code === 'EPERM'
  } finally {
    fs.closeSync(fd)
  }
}
