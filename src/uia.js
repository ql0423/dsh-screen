// UI Automation bridge.
//
// Two carriers, same protocol (base64 JSON in, JSON out):
//   * a warm worker — src/uia-worker.ps1 stays alive with the UIAutomation assemblies
//     loaded, so a request costs ~40ms instead of ~420ms;
//   * a one-shot script — src/uia.ps1, used when the worker is unavailable.
// The worker is killed after a few idle minutes so an idle DSH leaves no stray process.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const oneShotScript = join(here, 'uia.ps1')
const workerScript = join(here, 'uia-worker.ps1')

const candidates = [
  'C:/Program Files/PowerShell/7/pwsh.exe',
  'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  'powershell.exe',
]

let resolved = null
function shell() {
  if (resolved) return resolved
  for (const candidate of candidates) {
    try {
      if (candidate.endsWith('powershell.exe') && !candidate.includes('/')) { resolved = candidate; return resolved }
      if (existsSync(candidate)) { resolved = candidate; return resolved }
    } catch { /* keep looking */ }
  }
  resolved = 'powershell.exe'
  return resolved
}

const IDLE_MS = 5 * 60 * 1000
let worker = null
let spawnFailures = 0
let workerCooldownUntil = 0

/** Tear the warm worker down; safe to call at any time. */
export function stopUiaWorker() {
  const w = worker
  worker = null
  if (!w) return
  clearTimeout(w.idleTimer)
  try { w.child.stdin.end('quit\n') } catch { /* already gone */ }
  const timer = setTimeout(() => { try { w.child.kill() } catch { /* already gone */ } }, 300)
  timer.unref?.()
  try { w.child.unref() } catch { /* nothing to detach */ }
}

function ensureWorker() {
  if (worker) return worker
  const child = spawn(shell(), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', workerScript,
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })

  const w = {
    child,
    buffer: '',
    ready: false,
    dead: false,
    current: null,
    chain: Promise.resolve(),
    idleTimer: null,
    readyWaiters: [],
  }
  worker = w

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    w.buffer += chunk
    let cut
    while ((cut = w.buffer.indexOf('\n')) >= 0) {
      const line = w.buffer.slice(0, cut).trim()
      w.buffer = w.buffer.slice(cut + 1)
      if (!line) continue
      if (!w.ready && line.includes('"ready"')) {
        w.ready = true
        for (const resolve of w.readyWaiters.splice(0)) resolve(true)
        continue
      }
      const pending = w.current
      if (pending) {
        w.current = null
        pending.resolve(line)
      }
    }
  })

  const fail = (reason) => {
    w.dead = true
    if (worker === w) worker = null
    for (const resolve of w.readyWaiters.splice(0)) resolve(false)
    const pending = w.current
    w.current = null
    pending?.reject(new Error(reason))
  }
  child.on('error', (error) => fail(`UIA worker failed to start: ${error.message}`))
  child.on('exit', (code) => fail(`UIA worker exited (code ${code})`))

  w.readyPromise = new Promise((resolve) => {
    w.readyWaiters.push(resolve)
    const timer = setTimeout(() => resolve(false), 15000)
    timer.unref?.()
  })
  // Return the SAME object the stdout handler mutates — a copy here and the reply lands
  // in a different `current`, so the caller waits forever.
  return w
}

function armIdleTimer(w) {
  clearTimeout(w.idleTimer)
  w.idleTimer = setTimeout(() => { if (worker === w) stopUiaWorker() }, IDLE_MS)
  w.idleTimer.unref?.()
}

/** One request through the warm worker; rejects so the caller can fall back. */
function viaWorker(payloadB64, timeoutMs) {
  const w = ensureWorker()
  const run = async () => {
    const ready = await w.readyPromise
    if (!ready || w.dead) throw new Error('UIA worker never became ready')
    const line = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('UIA worker timeout')), timeoutMs)
      w.current = {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
      try {
        w.child.stdin.write(`${payloadB64}\n`)
      } catch (error) {
        clearTimeout(timer)
        w.current = null
        reject(error)
      }
    })
    armIdleTimer(w)
    return line
  }
  const next = w.chain.then(run, run)
  w.chain = next.catch(() => {})
  return next
}

function parseResult(raw) {
  const start = raw.indexOf('{')
  if (start < 0) throw new Error(`UIA bridge returned non-JSON: ${raw.slice(0, 300)}`)
  return JSON.parse(raw.slice(start))
}

/** The original path: pay ~400ms for a fresh process, but never depend on the worker. */
function viaOneShot(payloadB64, timeoutMs) {
  const result = spawnSync(shell(), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', oneShotScript, '-RequestB64', payloadB64,
  ], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })

  if (result.error) throw new Error(`UIA bridge failed to start: ${result.error.message}`)
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (!stdout) {
    throw new Error(`UIA bridge returned nothing (exit ${result.status})${stderr ? `: ${stderr.slice(0, 500)}` : ''}`)
  }
  return parseResult(stdout)
}

/**
 * Ask the UI Automation bridge for something.
 *
 * @param {object} request action + handle + action-specific fields
 * @returns {Promise<{ok:boolean, [k:string]:any}>}
 */
export async function uia(request, { timeoutMs = 30000 } = {}) {
  const payloadB64 = Buffer.from(JSON.stringify(request), 'utf8').toString('base64')
  const warm = process.env.DSH_SCREEN_UIA_WORKER !== '0' && Date.now() > workerCooldownUntil

  if (warm) {
    try {
      const result = parseResult(await viaWorker(payloadB64, timeoutMs))
      spawnFailures = 0
      return result
    } catch (error) {
      // The worker is an optimisation, never a requirement: drop it and do it the slow way.
      spawnFailures += 1
      if (worker) stopUiaWorker()
      if (spawnFailures >= 3) {
        // Three strikes: stop paying a failed start on every call for the next few minutes.
        workerCooldownUntil = Date.now() + 5 * 60 * 1000
        spawnFailures = 0
      }
      try {
        return viaOneShot(payloadB64, timeoutMs)
      } catch (fallbackError) {
        throw new Error(`${fallbackError.message}（worker 失败后回退也失败：${error.message}）`)
      }
    }
  }
  return viaOneShot(payloadB64, timeoutMs)
}

export const uiaActions = ['window', 'tree', 'find', 'invoke', 'setvalue', 'getvalue', 'select', 'focus']