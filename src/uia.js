// UI Automation bridge: runs src/uia.ps1 as a one-shot child process and returns parsed JSON.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'uia.ps1')

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

/**
 * @param {object} request action + handle + action-specific fields
 * @returns {{ok:boolean, [k:string]:any}}
 */
export function uia(request, { timeoutMs = 30000 } = {}) {
  const payload = Buffer.from(JSON.stringify(request), 'utf8').toString('base64')
  const result = spawnSync(shell(), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-RequestB64', payload,
  ], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })

  if (result.error) throw new Error(`UIA bridge failed to start: ${result.error.message}`)
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (!stdout) {
    throw new Error(`UIA bridge returned nothing (exit ${result.status})${stderr ? `: ${stderr.slice(0, 500)}` : ''}`)
  }
  // Some PowerShell hosts prepend a BOM or a warning; take the last JSON-looking line.
  const start = stdout.indexOf('{')
  if (start < 0) throw new Error(`UIA bridge returned non-JSON: ${stdout.slice(0, 500)}`)
  const json = stdout.slice(start)
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(`UIA bridge JSON parse error: ${json.slice(0, 500)}`)
  }
}

export const uiaActions = ['window', 'tree', 'find', 'invoke', 'setvalue', 'getvalue', 'select', 'focus']