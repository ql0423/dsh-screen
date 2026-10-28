/**
 * The "I am driving your computer" pill.
 *
 * Why it exists: while the agent works, it usually raises other windows, so the user is
 * looking at some other app and cannot see DSH's progress. A status line that says the
 * machine is being driven is not decoration — without it the user cannot tell a stuck
 * agent from an idle one.
 *
 * It lives in a separate PowerShell process (a WinForms pill) because the host has no
 * window of its own to draw into. The helper is always-on-top, click-through, never
 * takes focus, and is kept out of Alt+Tab. If it cannot start, actions still work:
 * losing the indicator must never make the plugin unusable.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let child = null
let hideTimer = null
let reapTimer = null
let lastError = ''
let lastPulseAt = 0

/** The helper takes a second or two to compile its WinForms bits; idle it away after a while. */
const IDLE_KILL_MS = 10 * 60 * 1000

function alive() {
  return Boolean(child) && !child.killed && child.exitCode === null
}

function ensureChild() {
  if (alive()) return child
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'overlay.ps1'),
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  } catch (error) {
    lastError = error?.message ?? String(error)
    child = null
    return null
  }
  child.on('error', (error) => {
    lastError = error?.message ?? String(error)
    child = null
  })
  child.on('exit', () => { child = null })
  // stderr is only kept for diagnostics; the pill is not allowed to shout into the chat.
  child.stderr?.on('data', (chunk) => { lastError = String(chunk).slice(0, 300) })
  child.stdin?.on('error', () => { /* the helper died; the next pulse restarts it */ })
  armReaper()
  return child
}

/** Keep one idle PowerShell around at most, and only while the plugin is actually in use. */
function armReaper() {
  if (reapTimer) return
  reapTimer = setInterval(() => {
    if (!alive()) {
      clearInterval(reapTimer)
      reapTimer = null
      return
    }
    if (Date.now() - lastPulseAt > IDLE_KILL_MS) {
      stopOverlay()
    }
  }, 60 * 1000)
  reapTimer.unref?.()
}

/**
 * Start the pill before the first action, so the very first pulse is not two seconds late.
 * Safe to call when the overlay is disabled: it simply never gets called.
 */
export function warmOverlay() {
  lastPulseAt = Date.now()
  return Boolean(ensureChild())
}

function send(line) {
  const proc = child
  if (!alive() || !proc.stdin?.writable) return false
  try {
    proc.stdin.write(`${line}\n`)
    return true
  } catch (error) {
    lastError = error?.message ?? String(error)
    return false
  }
}

/**
 * Show the pill now, and keep it up until the actions stop for `idleMs`.
 * Every action calls this, so a burst of steps keeps one pill up instead of flickering.
 */
export function pulseOverlay(text, idleMs = 1600) {
  lastPulseAt = Date.now()
  ensureChild()
  if (!send(`show ${Buffer.from(text, 'utf8').toString('base64')}`)) return false
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    send('hide')
  }, Math.max(400, idleMs))
  hideTimer.unref?.()
  return true
}

export function hideOverlay() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  send('hide')
}

/** Stop the helper process; called when the plugin is disposed. */
export function stopOverlay() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const proc = child
  if (!proc) return
  try { proc.stdin?.write('quit\n') } catch { /* it is already gone */ }
  const killer = setTimeout(() => {
    try { proc.kill() } catch { /* nothing left to kill */ }
  }, 1000)
  killer.unref?.()
  child = null
}

export function overlayStatus() {
  return { running: alive(), error: lastError }
}