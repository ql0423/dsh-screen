// Win32 bindings through koffi: screen capture, window enumeration, SendInput.
// Everything is in PHYSICAL pixels; the host process sets no DPI virtualization for us.
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')
const kernel32 = koffi.load('kernel32.dll')

const f = (lib, sig) => lib.func(sig)

const GetDC = f(user32, 'void * __stdcall GetDC(void *hWnd)')
const ReleaseDC = f(user32, 'int __stdcall ReleaseDC(void *hWnd, void *hdc)')
const GetSystemMetrics = f(user32, 'int __stdcall GetSystemMetrics(int nIndex)')
const SetCursorPos = f(user32, 'int __stdcall SetCursorPos(int X, int Y)')
const GetCursorPos = f(user32, 'int __stdcall GetCursorPos(void *lpPoint)')
const GetForegroundWindow = f(user32, 'void * __stdcall GetForegroundWindow()')
const SetForegroundWindow = f(user32, 'int __stdcall SetForegroundWindow(void *hWnd)')
const ShowWindow = f(user32, 'int __stdcall ShowWindow(void *hWnd, int nCmdShow)')
const IsWindowVisible = f(user32, 'int __stdcall IsWindowVisible(void *hWnd)')
const IsIconic = f(user32, 'int __stdcall IsIconic(void *hWnd)')
const IsZoomed = f(user32, 'int __stdcall IsZoomed(void *hWnd)')
const GetWindowRect = f(user32, 'int __stdcall GetWindowRect(void *hWnd, void *lpRect)')
const GetWindowTextW = f(user32, 'int __stdcall GetWindowTextW(void *hWnd, void *lpString, int nMaxCount)')
const GetWindowTextLengthW = f(user32, 'int __stdcall GetWindowTextLengthW(void *hWnd)')
const GetClassNameW = f(user32, 'int __stdcall GetClassNameW(void *hWnd, void *lpClassName, int nMaxCount)')
const GetWindowThreadProcessId = f(user32, 'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, void *lpdwProcessId)')
const GetWindowLongW = f(user32, 'long __stdcall GetWindowLongW(void *hWnd, int nIndex)')
const BringWindowToTop = f(user32, 'int __stdcall BringWindowToTop(void *hWnd)')
const AttachThreadInput = f(user32, 'int __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)')
const SetFocus = f(user32, 'void * __stdcall SetFocus(void *hWnd)')
const GetCurrentThreadId = f(kernel32, 'uint32 __stdcall GetCurrentThreadId()')
const SetProcessDpiAwarenessContext = f(user32, 'int __stdcall SetProcessDpiAwarenessContext(intptr value)')
const SendInput = f(user32, 'uint32 __stdcall SendInput(uint32 cInputs, void *pInputs, int cbSize)')
const MapVirtualKeyW = f(user32, 'uint32 __stdcall MapVirtualKeyW(uint32 uCode, uint32 uMapType)')
const VkKeyScanW = f(user32, 'int16 __stdcall VkKeyScanW(uint16 ch)')
const GetKeyState = f(user32, 'int16 __stdcall GetKeyState(int nVirtKey)')
const GetAsyncKeyState = f(user32, 'int16 __stdcall GetAsyncKeyState(int vKey)')
const keybd_event = f(user32, 'void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uint64 dwExtraInfo)')

const CreateCompatibleDC = f(gdi32, 'void * __stdcall CreateCompatibleDC(void *hdc)')
const CreateCompatibleBitmap = f(gdi32, 'void * __stdcall CreateCompatibleBitmap(void *hdc, int cx, int cy)')
const SelectObject = f(gdi32, 'void * __stdcall SelectObject(void *hdc, void *h)')
const BitBlt = f(gdi32, 'int __stdcall BitBlt(void *hdcDest, int x, int y, int cx, int cy, void *hdcSrc, int x1, int y1, uint32 rop)')
const GetDIBits = f(gdi32, 'int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 cLines, void *lpvBits, void *lpbmi, uint32 usage)')
const CreateDIBSection = f(gdi32, 'void * __stdcall CreateDIBSection(void *hdc, void *pbmi, uint32 usage, void *ppvBits, void *hSection, uint32 offset)')
const DeleteObject = f(gdi32, 'int __stdcall DeleteObject(void *ho)')
const DeleteDC = f(gdi32, 'int __stdcall DeleteDC(void *hdc)')

const EnumWindows = f(user32, 'int __stdcall EnumWindows(void *lpEnumFunc, intptr lParam)')
const PrintWindow = f(user32, 'int __stdcall PrintWindow(void *hWnd, void *hdcBlt, uint32 nFlags)')
const PostMessageW = f(user32, 'int __stdcall PostMessageW(void *hWnd, uint32 Msg, uint64 wParam, int64 lParam)')
const GetWindowLongPtrW = f(user32, 'void * __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)')
const SetWindowPos = f(user32, 'int __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)')
const OpenProcess = f(kernel32, 'void * __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)')
const QueryFullProcessImageNameW = f(kernel32, 'int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, void *lpExeName, void *lpdwSize)')
const CloseHandle = f(kernel32, 'int __stdcall CloseHandle(void *hObject)')

// SendInput(INPUT) layout on x64: 4 type + 4 pad + 32 union = 40 bytes.
const INPUT_SIZE = process.arch === 'x64' ? 40 : 28

const SM = {
  CXSCREEN: 0, CYSCREEN: 1,
  XVIRTUALSCREEN: 76, YVIRTUALSCREEN: 77, CXVIRTUALSCREEN: 78, CYVIRTUALSCREEN: 79, CMONITORS: 80,
}

const MOUSEEVENTF = {
  MOVE: 0x0001, LEFTDOWN: 0x0002, LEFTUP: 0x0004, RIGHTDOWN: 0x0008, RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020, MIDDLEUP: 0x0040, WHEEL: 0x0800, HWHEEL: 0x1000,
  ABSOLUTE: 0x8000, VIRTUALDESK: 0x4000,
}

const KEYEVENTF = { EXTENDEDKEY: 0x0001, KEYUP: 0x0002, UNICODE: 0x0004, SCANCODE: 0x0008 }

const VK = {
  backspace: 0x08, tab: 0x09, enter: 0x0d, return: 0x0d, shift: 0x10, ctrl: 0x11, control: 0x11,
  alt: 0x12, menu: 0x12, pause: 0x13, capslock: 0x14, esc: 0x1b, escape: 0x1b, space: 0x20,
  pageup: 0x21, pagedown: 0x22, end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  printscreen: 0x2c, insert: 0x2d, delete: 0x2e, del: 0x2e,
  win: 0x5b, lwin: 0x5b, rwin: 0x5c, apps: 0x5d,
  numlock: 0x90, scrolllock: 0x91, multiply: 0x6a, add: 0x6b, subtract: 0x6d, decimal: 0x6e, divide: 0x6f,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77,
  f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
  ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
  '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde, grave: 0xc0,
}

let dpiConfigured = false
function ensureDpi() {
  if (dpiConfigured) return
  dpiConfigured = true
  try {
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4; harmless no-op if the manifest already set it.
    SetProcessDpiAwarenessContext(-4)
  } catch { /* already aware, or older Windows */ }
}

export function screenMetrics() {
  ensureDpi()
  const x = GetSystemMetrics(SM.XVIRTUALSCREEN)
  const y = GetSystemMetrics(SM.YVIRTUALSCREEN)
  const width = GetSystemMetrics(SM.CXVIRTUALSCREEN) || GetSystemMetrics(SM.CXSCREEN)
  const height = GetSystemMetrics(SM.CYVIRTUALSCREEN) || GetSystemMetrics(SM.CYSCREEN)
  return { x, y, width, height, monitors: GetSystemMetrics(SM.CMONITORS), primary: { width: GetSystemMetrics(SM.CXSCREEN), height: GetSystemMetrics(SM.CYSCREEN) } }
}

/**
 * Grab a rectangle of the desktop. Returns BGRA rows (top-down) as a Buffer.
 * @param {{x:number,y:number,width:number,height:number}} rect
 */
export function captureRect({ x, y, width, height }) {
  ensureDpi()
  const screenDc = GetDC(null)
  if (!screenDc) throw new Error('GetDC(NULL) failed')
  let memDc = null
  let bitmap = null
  let previous = null
  try {
    memDc = CreateCompatibleDC(screenDc)
    bitmap = CreateCompatibleBitmap(screenDc, width, height)
    if (!memDc || !bitmap) throw new Error('failed to allocate capture surface')
    previous = SelectObject(memDc, bitmap)
    const ok = BitBlt(memDc, 0, 0, width, height, screenDc, x, y, 0x00cc0020)
    if (!ok) throw new Error('BitBlt failed')

    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(width, 4)
    header.writeInt32LE(-height, 8) // negative height: top-down rows
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    header.writeUInt32LE(0, 16) // BI_RGB
    header.writeUInt32LE(width * height * 4, 20)

    const pixels = Buffer.alloc(width * height * 4)
    const lines = GetDIBits(memDc, bitmap, 0, height, pixels, header, 0)
    if (!lines) throw new Error('GetDIBits failed')
    return { width, height, bgra: pixels }
  } finally {
    if (previous && memDc) SelectObject(memDc, previous)
    if (bitmap) DeleteObject(bitmap)
    if (memDc) DeleteDC(memDc)
    ReleaseDC(null, screenDc)
  }
}

/** BGRA -> packed RGB, so PNG encoding and vision both stay small. */
export function bgraToRgb({ width, height, bgra }) {
  const out = Buffer.alloc(width * height * 3)
  for (let i = 0, o = 0; i < bgra.length; i += 4, o += 3) {
    out[o] = bgra[i + 2]
    out[o + 1] = bgra[i + 1]
    out[o + 2] = bgra[i]
  }
  return { width, height, data: out, channels: 3 }
}

export function cursorPosition() {
  const point = Buffer.alloc(8)
  GetCursorPos(point)
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) }
}

export function moveCursor(x, y) {
  ensureDpi()
  const ok = SetCursorPos(Math.round(x), Math.round(y))
  if (!ok) {
    const code = (() => { try { return koffi.errno() } catch { return '?' } })()
    throw new Error(`SetCursorPos failed (errno ${code}) at ${x},${y}`)
  }
}

/** Move through SendInput instead of SetCursorPos; some fullscreen/anti-cheat contexts block one but not the other. */
export function moveCursorSendInput(x, y) {
  ensureDpi()
  const p = absoluteCoords(x, y)
  mouseEvent(MOUSEEVENTF.ABSOLUTE | MOUSEEVENTF.VIRTUALDESK | MOUSEEVENTF.MOVE, p.nx, p.ny)
}

/**
 * Best-effort move: SetCursorPos first, then SendInput.
 * A fullscreen game with raw input can refuse both, but refusing to throw keeps a drag
 * sequence from dying halfway with the button still logically down.
 */
export function tryMoveCursor(x, y) {
  try {
    moveCursor(x, y)
    return 'setcursorpos'
  } catch {
    try {
      moveCursorSendInput(x, y)
      return 'sendinput'
    } catch {
      return null
    }
  }
}

function absoluteCoords(x, y) {
  const m = screenMetrics()
  // Absolute SendInput coordinates are normalized over the whole virtual desktop.
  const nx = m.width <= 1 ? 0 : Math.round(((x - m.x) * 65535) / (m.width - 1))
  const ny = m.height <= 1 ? 0 : Math.round(((y - m.y) * 65535) / (m.height - 1))
  return { nx: Math.max(0, Math.min(65535, nx)), ny: Math.max(0, Math.min(65535, ny)) }
}

function mouseEvent(flags, x, y, data = 0) {
  const buf = Buffer.alloc(INPUT_SIZE)
  buf.writeUInt32LE(0, 0) // INPUT_MOUSE
  buf.writeInt32LE(x, 8)
  buf.writeInt32LE(y, 12)
  buf.writeUInt32LE(data >>> 0, 16)
  buf.writeUInt32LE(flags >>> 0, 20)
  buf.writeUInt32LE(0, 24)
  buf.writeUInt32LE(0, 28)
  buf.writeUInt32LE(0, 32)
  const sent = SendInput(1, buf, INPUT_SIZE)
  if (sent !== 1) throw new Error(`SendInput mouse rejected (${sent}) — the desktop may be locked`)
}

const BUTTON_FLAGS = {
  left: [MOUSEEVENTF.LEFTDOWN, MOUSEEVENTF.LEFTUP],
  right: [MOUSEEVENTF.RIGHTDOWN, MOUSEEVENTF.RIGHTUP],
  middle: [MOUSEEVENTF.MIDDLEDOWN, MOUSEEVENTF.MIDDLEUP],
}

export function click(x, y, { button = 'left', count = 1, modifiers = [] } = {}) {
  ensureDpi()
  const [down, up] = BUTTON_FLAGS[button] ?? BUTTON_FLAGS.left
  tryMoveCursor(x, y)
  const held = pressModifiers(modifiers, true)
  try {
    const moveFlags = MOUSEEVENTF.ABSOLUTE | MOUSEEVENTF.VIRTUALDESK | MOUSEEVENTF.MOVE
    const { nx, ny } = absoluteCoords(x, y)
    for (let i = 0; i < count; i++) {
      mouseEvent(moveFlags, nx, ny)
      mouseEvent(down, nx, ny)
      mouseEvent(up, nx, ny)
      if (i + 1 < count) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30)
    }
  } finally {
    pressModifiers(held, false)
  }
}

export function drag(from, to, { button = 'left', durationMs = 400, steps = 20 } = {}) {
  ensureDpi()
  const [down, up] = BUTTON_FLAGS[button] ?? BUTTON_FLAGS.left
  tryMoveCursor(from.x, from.y)
  const first = absoluteCoords(from.x, from.y)
  mouseEvent(down, first.nx, first.ny)
  const sleep = Math.max(8, Math.round(durationMs / Math.max(1, steps)))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const px = Math.round(from.x + (to.x - from.x) * t)
    const py = Math.round(from.y + (to.y - from.y) * t)
    const p = absoluteCoords(px, py)
    mouseEvent(MOUSEEVENTF.ABSOLUTE | MOUSEEVENTF.VIRTUALDESK | MOUSEEVENTF.MOVE, p.nx, p.ny)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep)
  }
  const last = absoluteCoords(to.x, to.y)
  mouseEvent(up, last.nx, last.ny)
}

export function scroll(x, y, { deltaY = 0, deltaX = 0 } = {}) {
  ensureDpi()
  const hasPoint = x !== undefined && y !== undefined
  if (hasPoint) tryMoveCursor(x, y)
  const notches = Math.round(deltaY / 120)
  if (notches !== 0) {
    const step = notches > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(notches); i++) {
      mouseEvent(MOUSEEVENTF.WHEEL, 0, 0, (step * 120) >>> 0)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12)
    }
  }
  const hnotches = Math.round(deltaX / 120)
  if (hnotches !== 0) {
    const step = hnotches > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(hnotches); i++) {
      mouseEvent(MOUSEEVENTF.HWHEEL, 0, 0, (step * 120) >>> 0)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12)
    }
  }
}

function keyEvent(vk, scan, flags, unicode = false) {
  const buf = Buffer.alloc(INPUT_SIZE)
  buf.writeUInt32LE(1, 0) // INPUT_KEYBOARD
  buf.writeUInt16LE(vk & 0xffff, 8)
  buf.writeUInt16LE(scan & 0xffff, 10)
  buf.writeUInt32LE(flags >>> 0, 12)
  buf.writeUInt32LE(0, 16)
  buf.writeUInt32LE(0, 20)
  buf.writeUInt32LE(0, 24)
  buf.writeUInt32LE(0, 28)
  buf.writeUInt32LE(0, 32)
  const sent = SendInput(1, buf, INPUT_SIZE)
  if (sent !== 1) throw new Error(`SendInput keyboard rejected (${sent}) — the desktop may be locked`)
}

export function resolveKey(name) {
  if (!name) throw new Error('empty key name')
  const key = String(name).toLowerCase()
  if (Object.hasOwn(VK, key)) return VK[key]
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0)
  if (/^vk_?[0-9a-f]{1,2}$/.test(key)) return parseInt(key.replace(/^vk_?/, ''), 16)
  throw new Error(`unknown key: ${name}`)
}

/**
 * Is this key physically down right now? Async key state is global: it works even when
 * none of our windows has focus — exactly the case when the user reaches for Esc.
 * Returns false instead of throwing, because a status check must never break an action.
 */
export function isKeyDown(name) {
  try {
    return (GetAsyncKeyState(resolveKey(name)) & 0x8000) !== 0
  } catch {
    return false
  }
}

function pressModifiers(modifiers, down) {
  const held = []
  // pressModifiers(mods, true) returns the list it actually put down so the caller can release exactly those.
  const list = down ? (modifiers ?? []) : (modifiers ?? [])
  for (const mod of list) {
    const vk = resolveKey(mod)
    if (down) {
      keyEvent(vk, MapVirtualKeyW(vk, 0), 0)
      held.push(mod)
    } else {
      keyEvent(vk, MapVirtualKeyW(vk, 0), KEYEVENTF.KEYUP)
    }
  }
  return held
}

export function pressKey(name, { count = 1, holdMs = 0 } = {}) {
  ensureDpi()
  const vk = resolveKey(name)
  const scan = MapVirtualKeyW(vk, 0)
  for (let i = 0; i < count; i++) {
    keyEvent(vk, scan, 0)
    if (holdMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs)
    keyEvent(vk, scan, KEYEVENTF.KEYUP)
    if (count > 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
  }
}

export function hotkey(keys) {
  ensureDpi()
  const list = Array.isArray(keys) ? keys : String(keys).split('+').map(s => s.trim()).filter(Boolean)
  if (!list.length) throw new Error('hotkey needs at least one key')
  const vks = list.map(resolveKey)
  const scans = vks.map(vk => MapVirtualKeyW(vk, 0))
  for (let i = 0; i < vks.length; i++) keyEvent(vks[i], scans[i], 0)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  for (let i = vks.length - 1; i >= 0; i--) keyEvent(vks[i], scans[i], KEYEVENTF.KEYUP)
}

/** Type arbitrary text (including CJK) via KEYEVENTF_UNICODE — no IME needed. */
export function typeText(text, { perCharDelayMs = 0 } = {}) {
  ensureDpi()
  const value = String(text)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    // Surrogate pairs are sent as their own UTF-16 units, which is what Windows expects.
    keyEvent(0, code, KEYEVENTF.UNICODE)
    keyEvent(0, code, KEYEVENTF.UNICODE | KEYEVENTF.KEYUP)
    if (perCharDelayMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, perCharDelayMs)
  }
}

function readWide(fn, hwnd, length) {
  if (length <= 0) return ''
  const buf = Buffer.alloc((length + 1) * 2)
  const n = fn(hwnd, buf, length + 1)
  if (n <= 0) return ''
  return buf.toString('utf16le', 0, n * 2)
}

function windowTitle(hwnd) {
  const len = GetWindowTextLengthW(hwnd)
  return readWide(GetWindowTextW, hwnd, len)
}

function windowClass(hwnd) {
  const buf = Buffer.alloc(512)
  const n = GetClassNameW(hwnd, buf, 256)
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
}

function windowRect(hwnd) {
  const rect = Buffer.alloc(16)
  if (!GetWindowRect(hwnd, rect)) return null
  const left = rect.readInt32LE(0)
  const top = rect.readInt32LE(4)
  const right = rect.readInt32LE(8)
  const bottom = rect.readInt32LE(12)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

let enumCallback = null
let collector = null

/** Visible top-level windows with their rects, process ids and styles. */
export function listWindows() {
  ensureDpi()
  if (!enumCallback) {
    const proto = koffi.proto('bool __stdcall WNDENUMPROC(void *hwnd, intptr lParam)')
    enumCallback = koffi.register((hwnd) => {
      try {
        if (!IsWindowVisible(hwnd)) return true
        const rect = windowRect(hwnd)
        if (!rect || rect.width <= 0 || rect.height <= 0) return true
        const pidBuf = Buffer.alloc(4)
        GetWindowThreadProcessId(hwnd, pidBuf)
        const title = windowTitle(hwnd)
        const cls = windowClass(hwnd)
        if (!title && !cls) return true
        collector?.push({
          handle: Number(koffi.address(hwnd) ?? 0) || String(hwnd),
          hwndRaw: hwnd,
          title,
          class: cls,
          pid: pidBuf.readUInt32LE(0),
          rect,
          minimized: Boolean(IsIconic(hwnd)),
          maximized: Boolean(IsZoomed(hwnd)),
          style: GetWindowLongW(hwnd, -16),
        })
      } catch { /* skip windows that vanish mid-enumeration */ }
      return true
    }, koffi.pointer(proto))
  }
  const collected = []
  collector = collected
  try {
    EnumWindows(enumCallback, 0)
  } finally {
    collector = null
  }
  return collected
}

export function foregroundWindow() {
  ensureDpi()
  const hwnd = GetForegroundWindow()
  if (!hwnd) return null
  const pidBuf = Buffer.alloc(4)
  GetWindowThreadProcessId(hwnd, pidBuf)
  return {
    handle: Number(koffi.address(hwnd) ?? 0) || String(hwnd),
    hwndRaw: hwnd,
    title: windowTitle(hwnd),
    class: windowClass(hwnd),
    pid: pidBuf.readUInt32LE(0),
    rect: windowRect(hwnd),
    minimized: Boolean(IsIconic(hwnd)),
    maximized: Boolean(IsZoomed(hwnd)),
  }
}

/** Numeric identity of a handle, so two handles can be compared without object equality. */
function addressOf(hwnd) {
  try { return Number(koffi.address(hwnd) ?? 0) } catch { return 0 }
}

/** True when that exact window owns the foreground right now. */
export function isForeground(hwndRaw) {
  const fg = GetForegroundWindow()
  if (!fg || !hwndRaw) return false
  return addressOf(fg) === addressOf(hwndRaw)
}

/**
 * Bring a window to the foreground, defeating Windows' foreground lock.
 *
 * `SetForegroundWindow` alone is refused unless the caller already owns the
 * foreground; the documented workaround is to attach this thread to the input queue
 * of the foreground thread (and of the target), then try again. When even that is
 * refused — a different desktop, a busy target — a synthetic ALT tap resets the
 * lock and a second attempt usually lands. Returns true only when the window really
 * is in front, so a caller can refuse to click into the wrong app.
 */
export function focusWindow(hwndRaw) {
  ensureDpi()
  if (!hwndRaw) return false
  if (IsIconic(hwndRaw)) ShowWindow(hwndRaw, 9) // SW_RESTORE
  if (isForeground(hwndRaw)) return true

  const current = GetCurrentThreadId() >>> 0
  const targetThread = GetWindowThreadProcessId(hwndRaw, null) >>> 0
  const fg = GetForegroundWindow()
  const fgThread = fg ? GetWindowThreadProcessId(fg, null) >>> 0 : 0
  const attached = []
  for (const thread of new Set([fgThread, targetThread])) {
    if (!thread || thread === current) continue
    try {
      if (AttachThreadInput(current, thread, 1)) attached.push(thread)
    } catch { /* one queue refusing must not stop the other */ }
  }
  try {
    BringWindowToTop(hwndRaw)
    SetForegroundWindow(hwndRaw)
    try { SetFocus(hwndRaw) } catch { /* SetFocus fails across threads; foreground is what matters */ }
  } finally {
    for (const thread of attached) {
      try { AttachThreadInput(current, thread, 0) } catch { /* detached with the call */ }
    }
  }
  if (isForeground(hwndRaw)) return true

  // Last resort: a lone ALT press/release clears the foreground lock.
  try {
    keyEvent(VK.alt, 0, 0)
    keyEvent(VK.alt, 0, KEYEVENTF.KEYUP)
  } catch { /* desktop locked; the verification below reports it */ }
  BringWindowToTop(hwndRaw)
  SetForegroundWindow(hwndRaw)
  return isForeground(hwndRaw)
}

export function windowHandleByTitle(match) {
  const wanted = String(match).toLowerCase()
  const windows = listWindows()
  const exact = windows.find(w => w.title.toLowerCase() === wanted)
  if (exact) return exact
  const partial = windows.find(w => w.title.toLowerCase().includes(wanted))
  return partial ?? null
}

export function isLocked() {
  // A blocked input desktop means SendInput would silently fail; GetForegroundWindow keeps answering.
  return GetForegroundWindow() === 0
}

/** Executable path behind a window, so the caller can tell apps apart by binary, not only by title. */
export function processNameOfPid(pid) {
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (!handle) return null
  try {
    const sizeBuf = Buffer.alloc(4)
    sizeBuf.writeUInt32LE(1024, 0)
    const nameBuf = Buffer.alloc(2048)
    if (!QueryFullProcessImageNameW(handle, 0, nameBuf, sizeBuf)) return null
    const length = sizeBuf.readUInt32LE(0)
    const full = nameBuf.toString('utf16le', 0, length * 2)
    return full
  } finally {
    CloseHandle(handle)
  }
}

/**
 * Render one window into a bitmap even when it is occluded or partly offscreen.
 * Falls back to a screen grab of the window rectangle when PrintWindow is refused.
 */
export function captureWindow(hwndRaw, { flags = 2 } = {}) {
  ensureDpi()
  const rect = windowRect(hwndRaw)
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('window has no capturable area')
  const screenDc = GetDC(null)
  let memDc = null
  let bitmap = null
  let previous = null
  try {
    memDc = CreateCompatibleDC(screenDc)
    bitmap = CreateCompatibleBitmap(screenDc, rect.width, rect.height)
    if (!memDc || !bitmap) throw new Error('failed to allocate capture surface')
    previous = SelectObject(memDc, bitmap)
    const ok = PrintWindow(hwndRaw, memDc, flags)
    if (!ok) {
      // PrintWindow is refused by some composited apps; grab the on-screen pixels instead.
      if (!BitBlt(memDc, 0, 0, rect.width, rect.height, screenDc, rect.x, rect.y, 0x00cc0020)) {
        throw new Error('PrintWindow and BitBlt both failed')
      }
    }
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(rect.width, 4)
    header.writeInt32LE(-rect.height, 8)
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    header.writeUInt32LE(0, 16)
    header.writeUInt32LE(rect.width * rect.height * 4, 20)
    const pixels = Buffer.alloc(rect.width * rect.height * 4)
    if (!GetDIBits(memDc, bitmap, 0, rect.height, pixels, header, 0)) throw new Error('GetDIBits failed')
    return { width: rect.width, height: rect.height, bgra: pixels, rect, via: ok ? 'printwindow' : 'screen' }
  } finally {
    if (previous && memDc) SelectObject(memDc, previous)
    if (bitmap) DeleteObject(bitmap)
    if (memDc) DeleteDC(memDc)
    ReleaseDC(null, screenDc)
  }
}

/** Find a live window handle from the value stored by listWindows (a JS number). */
export function handleFromNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric === 0) throw new Error(`bad window handle: ${value}`)
  return numeric
}

export function rectOfWindow(hwndRaw) {
  ensureDpi()
  return windowRect(hwndRaw)
}

export function closeWindow(hwndRaw) {
  ensureDpi()
  const WM_CLOSE = 0x0010
  return Boolean(PostMessageW(hwndRaw, WM_CLOSE, 0, 0))
}

export const constants = { MOUSEEVENTF, KEYEVENTF, VK, SM, INPUT_SIZE }