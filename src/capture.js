// Screenshot pipeline: Win32 pixels -> downscaled RGB -> PNG on disk, plus a JSON-friendly summary.
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureRect, captureWindow, bgraToRgb, screenMetrics, foregroundWindow, handleFromNumber, rectOfWindow, listWindows, cursorPosition, processNameOfPid } from './win32.js'
import { encodePng, downscale } from './png.js'

let shotDirCache = null

/** The last frame handed out, so a byte-identical one is not stored twice. */
let lastFrame = { key: null, hash: null, path: null, bytes: 0 }

/** Wait without burning a CPU core; used for the settle before a post-action frame. */
export function settle(ms) {
  const span = Math.max(0, Math.round(ms))
  if (span > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, span)
}

export function shotDir(configured) {
  if (shotDirCache) return shotDirCache
  const dir = configured || join(tmpdir(), 'dsh-screen', 'shots')
  mkdirSync(dir, { recursive: true })
  shotDirCache = dir
  return dir
}

function stamp() {
  const now = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
}

/**
 * Grab the desktop, one window, or a rectangle and write a PNG.
 *
 * `dedupe` (default on) skips encoding and writing when the pixels are identical to the
 * frame handed out last time — the model's earlier view, and the coordinates taken from
 * it, still describe this screen. `forceImage` overrides that.
 *
 * @param {{dir?:string, window?:number|string, region?:{x:number,y:number,width:number,height:number},
 *          maxWidth?:number, maxHeight?:number, name?:string, dedupe?:boolean, forceImage?:boolean}} options
 */
export function grab(options = {}) {
  const { window: windowRef, region, maxWidth = 1600, maxHeight = 1200, name } = options
  const dedupe = options.dedupe !== false
  let source
  let origin
  let label

  if (windowRef !== undefined && windowRef !== null) {
    const hwnd = handleFromNumber(windowRef)
    const captured = captureWindow(hwnd)
    source = { width: captured.width, height: captured.height, bgra: captured.bgra }
    origin = { x: captured.rect.x, y: captured.rect.y }
    label = `window ${hwnd} (${captured.via})`
  } else if (region) {
    const rect = {
      x: Math.round(region.x ?? 0),
      y: Math.round(region.y ?? 0),
      width: Math.max(1, Math.round(region.width ?? 0)),
      height: Math.max(1, Math.round(region.height ?? 0)),
    }
    source = captureRect(rect)
    origin = { x: rect.x, y: rect.y }
    label = `region ${rect.width}x${rect.height}@${rect.x},${rect.y}`
  } else {
    const metrics = screenMetrics()
    source = captureRect(metrics)
    origin = { x: metrics.x, y: metrics.y }
    label = 'full screen'
  }

  const rgb = bgraToRgb(source)
  const scaled = downscale(rgb, maxWidth, maxHeight)
  const scaleX = source.width / scaled.width
  const scaleY = source.height / scaled.height

  const hash = createHash('sha1').update(scaled.data).digest('hex')
  const key = `${label}|${maxWidth}x${maxHeight}|${source.width}x${source.height}`
  if (dedupe && !options.forceImage && lastFrame.key === key && lastFrame.hash === hash) {
    try {
      return {
        path: lastFrame.path,
        bytes: statSync(lastFrame.path).size,
        imageWidth: scaled.width,
        imageHeight: scaled.height,
        sourceWidth: source.width,
        sourceHeight: source.height,
        origin,
        scaleX,
        scaleY,
        label,
        hash,
        unchanged: true,
      }
    } catch { /* the old file was pruned; fall through and write a new one */ }
  }

  const png = encodePng(scaled)
  const dir = shotDir(options.dir)
  const file = join(dir, `${name || 'screen'}-${stamp()}.png`)
  writeFileSync(file, png)
  const bytes = statSync(file).size
  lastFrame = { key, hash, path: file, bytes }

  return {
    path: file,
    bytes,
    imageWidth: scaled.width,
    imageHeight: scaled.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
    origin,
    // Multiply image coordinates by these to get physical screen coordinates for clicking.
    scaleX,
    scaleY,
    label,
    hash,
    unchanged: false,
  }
}

/** A short, model-friendly description of what is on screen right now. */
export function describeDesktop({ maxWindows = 12 } = {}) {
  const metrics = screenMetrics()
  const foreground = foregroundWindow()
  const windows = listWindows()
    .filter(w => w.title && w.title.trim())
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
  const fgHandle = foreground?.handle
  const named = windows.slice(0, maxWindows).map(w => ({
    handle: w.handle,
    title: w.title,
    class: w.class,
    pid: w.pid,
    process: exeBaseName(w.pid),
    rect: w.rect,
    minimized: w.minimized,
    foreground: w.handle === fgHandle,
  }))
  return {
    screen: metrics,
    cursor: cursorPosition(),
    foreground: foreground ? { handle: foreground.handle, title: foreground.title, class: foreground.class, pid: foreground.pid, process: exeBaseName(foreground.pid), rect: foreground.rect } : null,
    windows: named,
    windowCount: windows.length,
  }
}

/** Executable base name for a pid, or '' when the process is not readable. */
function exeBaseName(pid) {
  try {
    const full = processNameOfPid(pid)
    if (!full) return ''
    const parts = full.split(/[\\/]/)
    return parts[parts.length - 1] || ''
  } catch {
    return ''
  }
}

export function windowRectByHandle(handle) {
  return rectOfWindow(handleFromNumber(handle))
}