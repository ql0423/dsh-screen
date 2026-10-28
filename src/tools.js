// The tool surface: what the agent can call to see and drive the Windows desktop.
import { spawn } from 'node:child_process'
import { defineTool } from './runtime.js'
import {
  listWindows, foregroundWindow, focusWindow, windowHandleByTitle, closeWindow,
  click, drag, scroll, tryMoveCursor, cursorPosition, typeText, pressKey, hotkey,
  processNameOfPid, screenMetrics, isKeyDown, shellOpen, splitAppSpec,
} from './win32.js'
import { grab, describeDesktop, settle } from './capture.js'
import { uia } from './uia.js'
import { gate } from './safety.js'
import { pulseOverlay } from './overlay.js'

const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

/**
 * Tell the user, on their own screen, that the machine is being driven.
 * Without this they are looking at some other window and cannot tell a working agent
 * from one that has already finished (or hung).
 */
function showDriving(config, detail) {
  if (config.overlay === false) return
  const hint = config.cancelOnEsc ? '　·　按 Esc 取消' : ''
  pulseOverlay(`●  DSH 正在操作你的电脑${detail ? `　${detail}` : ''}${hint}`, config.overlayIdleMs ?? 1600)
}

/**
 * Esc as a brake, opt-in. Read from async key state so it works while the agent is busy
 * in another window. A synthetic Esc we sent ourselves must not trip it, so the caller
 * passes the time of its own last Esc.
 */
function escPressed(config, ignoreUntil = 0) {
  if (!config.cancelOnEsc) return false
  if (Date.now() < ignoreUntil) return false
  return isKeyDown('esc')
}

/**
 * Only one screenshot is "current" at a time; actions may reference its pixel space.
 * `lastLookAt` is about freshness of *knowledge*: a UI Automation read counts as a look
 * even though it produced no image at all.
 */
const state = { lastShot: null, lastLookAt: 0, ignoreEscUntil: 0 }

/** Control types that can be operated even when they advertise no UIA pattern. */
const OPERABLE_TYPES = new Set([
  'Button', 'Edit', 'ComboBox', 'ListItem', 'MenuItem', 'TabItem', 'CheckBox',
  'RadioButton', 'Slider', 'Hyperlink', 'SplitButton', 'TreeItem', 'DataItem',
  'Document', 'Spinner',
])

/** Which UIA pattern decides how this control should be driven, best first. */
function actionFor(node) {
  const patterns = Array.isArray(node.patterns) ? node.patterns : []
  const has = name => patterns.includes(name)
  if (has('invoke')) return 'invoke'
  if (has('value')) return 'fill'
  if (has('toggle')) return 'toggle'
  if (has('selectionitem')) return 'select'
  if (has('expandcollapse')) return 'expand'
  if (has('scroll')) return 'scroll'
  if (OPERABLE_TYPES.has(node.type)) return 'click'
  return null
}

function centerOf(rect) {
  if (!rect || !rect.width || !rect.height) return null
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
}

function metaNote(meta) {
  if (!meta || typeof meta !== 'object') return ''
  const parts = []
  if (meta.toggle) parts.push(`toggle:${meta.toggle}`)
  if (meta.expand) parts.push(`state:${meta.expand}`)
  if (meta.password) parts.push('password')
  else if (meta.value !== undefined && meta.value !== '') parts.push(`value:${JSON.stringify(meta.value).slice(0, 40)}`)
  if (meta.readonly) parts.push('readonly')
  if (meta.min !== undefined && meta.max !== undefined) parts.push(`range:${meta.min}-${meta.max}`)
  return parts.length ? `  [${parts.join('] [')}]` : ''
}

/**
 * Read a window's controls through UI Automation and shape them for the model: one line
 * per operable control with its centre, its path (for `control:`), and how to drive it.
 */
async function uiaView(target, { maxDepth = 4, maxNodes = 160 } = {}) {
  const response = await uia({
    action: 'tree',
    ...(target?.handle ? { handle: target.handle } : {}),
    maxDepth,
    maxNodes,
    meta: true,
  }, { timeoutMs: 25000 })
  if (!response.ok) throw new Error(`UIA 读取失败：${response.error ?? '未知原因'}`)
  const bounds = desktopBounds()
  const nodes = (response.nodes ?? []).map(node => ({
    ...node,
    action: actionFor(node),
    center: centerOf(node.rect),
  }))
  const controls = nodes.filter(node => {
    if (!node.action || !node.center || node.offscreen) return false
    // A control can claim to be visible and still sit outside every monitor (scrolled-out
    // rows do this). Clicking there would send the mouse into nowhere.
    if (!bounds) return true
    const { x, y } = node.center
    return x >= bounds.x1 - 1 && y >= bounds.y1 - 1 && x <= bounds.x2 + 1 && y <= bounds.y2 + 1
  })
  return { nodes, controls, truncated: Boolean(response.truncated) }
}

/** Union of every visible window's rectangle — the area a click can actually land in. */
function desktopBounds() {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const w of listWindows()) {
    if (!w.rect) continue
    x1 = Math.min(x1, w.rect.x)
    y1 = Math.min(y1, w.rect.y)
    x2 = Math.max(x2, w.rect.x + w.rect.width)
    y2 = Math.max(y2, w.rect.y + w.rect.height)
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null
}

/** The model-facing list of controls. */
function controlLines(view, { title, limit = 120 } = {}) {
  if (!view.controls.length) {
    return `窗口「${title}」里 UIA 没给出可操作的控件（只有 ${view.nodes.length} 个节点）。`
  }
  const lines = view.controls.slice(0, limit).map(node => {
    const name = node.name ? JSON.stringify(node.name.slice(0, 48)) : '""'
    const focused = node.focused ? '  [focused]' : ''
    return `  (${node.center.x},${node.center.y})  ${node.path.padEnd(10)}  ${node.type.padEnd(12)} ${name.padEnd(46)} [${node.action}]${focused}${metaNote(node.meta)}`
  })
  if (view.controls.length > limit) {
    lines.push(`  …还有 ${view.controls.length - limit} 个没列出来（把 maxNodes 调大，或先用 window 限定到一个窗口）`)
  }
  return lines.join('\n')
}

/**
 * Drive a control addressed by its UIA path instead of by a remembered pixel.
 * Two wins: the rectangle is measured at the moment of the action (nothing can drift
 * underneath it), and where a pattern allows it the control is operated directly —
 * so a filled field needs no keyboard and a button needs no mouse.
 * @returns {Promise<{handled:boolean, point?:{x:number,y:number}, notes:string[]}|null>}
 */
async function uiaStep(step, target) {
  if (!step.control) return null
  const path = String(step.control).trim()
  const handle = target?.handle ?? foregroundWindow()?.handle
  if (!handle) throw new Error('control 要配一个窗口：前台没有窗口，用 window 指定一个')
  const read = await uia({ action: 'rect', handle, path }, { timeoutMs: 20000 })
  if (!read.ok) throw new Error(`窗口里找不到控件 ${path}：${read.error ?? '未知原因'}`)
  const element = read.element
  const label = `控件 ${path}${element.name ? `「${element.name}」` : ''}`
  const patterns = Array.isArray(element.patterns) ? element.patterns : []
  const point = centerOf(element.rect)

  if (step.action === 'type') {
    if (patterns.includes('value') && !element.meta?.readonly) {
      const filled = await uia({ action: 'setvalue', handle, path, value: String(step.text ?? '') }, { timeoutMs: 20000 })
      if (filled.ok) {
        return { handled: true, notes: [`直接给${label}喂了 ${String(step.text ?? '').length} 个字符（UIA 赋值，没碰键盘）`] }
      }
    }
    if (!point) throw new Error(`${label} 没有可点的矩形，没法聚焦后打字`)
    return { handled: false, point, notes: [] }
  }

  if (step.action === 'click' || step.action === 'double_click') {
    const how = step.how ?? (patterns.includes('invoke') ? 'invoke' : 'click')
    if (how === 'invoke') {
      const pressed = await uia({ action: 'invoke', handle, path }, { timeoutMs: 20000 })
      if (pressed.ok) {
        return { handled: true, notes: [`用 UIA 直接按了${label}（没动鼠标，前台是谁都行）`] }
      }
    }
    if (!point) throw new Error(`${label} 没有可点的矩形`)
    return { handled: false, point, notes: [`${label} 的中心是 (${point.x},${point.y})`] }
  }

  if (!point) return null
  return { handled: false, point, notes: [] }
}

function resolveWindow(ref) {
  if (ref === undefined || ref === null || ref === '') return null
  if (typeof ref === 'number') return { handle: ref, title: '' }
  const raw = String(ref).trim()
  if (/^\d+$/.test(raw)) return { handle: Number(raw), title: '' }
  const found = windowHandleByTitle(raw)
  if (!found) {
    const titles = listWindows().map(w => w.title).filter(Boolean).slice(0, 12)
    throw new Error(`没有标题包含「${raw}」的窗口。当前窗口有：${titles.join(' / ') || '（无）'}`)
  }
  return { handle: found.handle, title: found.title }
}

function formatRect(rect) {
  return rect ? `${rect.width}x${rect.height} @ (${rect.x},${rect.y})` : '未知位置'
}

function windowLines(desk) {
  const lines = []
  const fg = desk.foreground
  if (fg) {
    lines.push(`前台窗口：${fg.title || '(无标题)'}  [${fg.class}${fg.process ? ` / ${fg.process}` : ''}] handle=${fg.handle} pid=${fg.pid} ${formatRect(fg.rect)}`)
  } else {
    lines.push('前台窗口：无')
  }
  lines.push(`屏幕：${desk.screen.width}x${desk.screen.height}，光标在 (${desk.cursor.x},${desk.cursor.y})，共 ${desk.windowCount} 个可见窗口`)
  for (const w of desk.windows) {
    lines.push(`  ${w.foreground ? '*' : ' '} handle=${w.handle}  ${w.title.slice(0, 48)}  [${w.class}${w.process ? ` / ${w.process}` : ''}]  ${formatRect(w.rect)}${w.minimized ? ' (最小化)' : ''}`)
  }
  return lines.join('\n')
}

function coordHint(shot) {
  return `图片是 ${shot.imageWidth}x${shot.imageHeight}（原画 ${shot.sourceWidth}x${shot.sourceHeight}），换算：屏幕x = ${shot.origin.x} + 图片x × ${shot.scaleX.toFixed(4)}，屏幕y = ${shot.origin.y} + 图片y × ${shot.scaleY.toFixed(4)}。screen_act 也可以直接传 imageX / imageY，本插件自己换算。`
}

function observe(config, { settleMs, force = false, note } = {}) {
  // Give the screen a moment to repaint: a frame grabbed in the same tick as the click
  // can still show the old state, which reads as "the click did nothing".
  settle(settleMs ?? config.settleMs ?? 180)
  const shot = grab({
    dir: config.shotDir,
    maxWidth: config.observeMaxWidth ?? 1280,
    maxHeight: config.observeMaxHeight ?? 900,
    name: 'after',
    forceImage: force,
  })
  state.lastShot = { ...shot, at: Date.now() }
  state.lastLookAt = Date.now()
  const desk = describeDesktop({ maxWindows: 6 })
  const head = shot.unchanged
    ? `画面和上一张逐像素一样（没重存文件，你手上那张图继续有效）：${shot.path}（${shot.imageWidth}x${shot.imageHeight}）`
    : `动作执行完，已经重新截了一张：${shot.path}（${shot.imageWidth}x${shot.imageHeight}）`
  return { shot, text: `${head}\n${windowLines(desk)}${note ? `\n${note}` : ''}` }
}

/**
 * Run one action and describe it. Shared by screen_act (one step) and screen_sequence
 * (a batch), so both behave identically — the only difference is how many frames come back.
 * @returns {string[]} notes to report
 */
function performAction(action, args, config, { point, target }) {
  const notes = []
  switch (action) {
    case 'click':
    case 'double_click':
    case 'right_click': {
      if (!point) throw new Error('click 需要 x/y 或 imageX/imageY')
      const button = args.button ?? (action === 'right_click' ? 'right' : 'left')
      const count = args.count ?? (action === 'double_click' ? 2 : 1)
      click(point.x, point.y, { button, count })
      notes.push(`在 (${Math.round(point.x)},${Math.round(point.y)}) 用 ${button} 键点了 ${count} 次`)
      break
    }
    case 'move': {
      if (!point) throw new Error('move 需要 x/y 或 imageX/imageY')
      const how = tryMoveCursor(point.x, point.y)
      notes.push(how
        ? `鼠标移到 (${Math.round(point.x)},${Math.round(point.y)})（${how}）`
        : `鼠标移动被系统或前台程序拒绝了：( ${Math.round(point.x)},${Math.round(point.y)} ) 没动成`)
      break
    }
    case 'drag': {
      if (!point || args.toX === undefined || args.toY === undefined) throw new Error('drag 需要起点 x/y 和终点 toX/toY')
      drag(point, { x: args.toX, y: args.toY }, { button: args.button ?? 'left' })
      notes.push(`从 (${Math.round(point.x)},${Math.round(point.y)}) 拖到 (${args.toX},${args.toY})`)
      break
    }
    case 'scroll': {
      const cursor = cursorPosition()
      const at = point ?? cursor
      scroll(at.x, at.y, { deltaY: args.deltaY ?? 0, deltaX: args.deltaX ?? 0 })
      notes.push(`在 (${Math.round(at.x)},${Math.round(at.y)}) 滚动 dx=${args.deltaX ?? 0} dy=${args.deltaY ?? 0}`)
      break
    }
    case 'type': {
      if (typeof args.text !== 'string') throw new Error('type 需要 text')
      typeText(args.text, { perCharDelayMs: config.typeDelayMs ?? 0 })
      notes.push(`输入了 ${args.text.length} 个字符：${JSON.stringify(args.text.slice(0, 60))}${args.text.length > 60 ? '…' : ''}`)
      break
    }
    case 'key': {
      if (!args.key) throw new Error('key 需要 key 名')
      const count = args.count ?? 1
      pressKey(args.key, { count })
      notes.push(`按了 ${args.key}${count > 1 ? ` × ${count}` : ''}`)
      break
    }
    case 'hotkey': {
      if (!args.keys) throw new Error('hotkey 需要 keys')
      hotkey(args.keys)
      notes.push(`按了组合键 ${args.keys}`)
      break
    }
    case 'open': {
      if (!args.app) throw new Error('open 需要 app')
      // ShellExecute, not cmd: a URL must reach the default browser instead of being run
      // as a shell command (which silently fails and still reports a pid).
      const spec = splitAppSpec(args.app)
      if (!spec) throw new Error('open 需要 app')
      const launched = shellOpen(spec.file, spec.params)
      notes.push(launched.ok
        ? `打开了 ${spec.file}${spec.params ? ` ${spec.params}` : ''}（由系统默认程序处理）`
        : `打开失败：${spec.file}（ShellExecute 返回 ${launched.code}${launched.error ? `，${launched.error}` : ''}）`)
      break
    }
    case 'close': {
      if (!target) throw new Error('close 需要 window')
      const ok = closeWindow(target.handle)
      notes.push(`${ok ? '已请求关闭' : '关闭请求失败'}：${target.title || target.handle}`)
      break
    }
    default:
      throw new Error(`未知动作：${action}`)
  }
  return notes
}

/** Resolve a step's target point: explicit screen pixels, or pixels of the current screenshot. */
function pointOf(args) {
  if (args.imageX !== undefined && args.imageY !== undefined) {
    const shot = state.lastShot
    if (!shot) throw new Error('还没有截图可以参照：先 screen_look 截一张，再用 imageX/imageY')
    return { x: shot.origin.x + args.imageX * shot.scaleX, y: shot.origin.y + args.imageY * shot.scaleY }
  }
  if (args.x !== undefined && args.y !== undefined) return { x: args.x, y: args.y }
  return null
}

/** How stale the last look may be before the hands are refused, in ms. */
function staleAfterMs(config) {
  return (config.requireFreshLookSeconds ?? 120) * 1000
}

/** One human-readable line for a planned step. */
function summarizeStep(step = {}) {
  const at = step.imageX !== undefined && step.imageY !== undefined
    ? `图内(${step.imageX},${step.imageY})`
    : step.x !== undefined && step.y !== undefined ? `(${step.x},${step.y})` : ''
  const where = step.window ? `${step.window} · ` : ''
  switch (step.action) {
    case 'click':
    case 'double_click':
    case 'right_click': return `${where}${step.action} @ ${at}${step.button ? ` ${step.button}` : ''}`
    case 'move': return `${where}move → ${at}`
    case 'drag': return `${where}drag ${at} → (${step.toX},${step.toY})`
    case 'scroll': return `${where}scroll ${at} dy=${step.deltaY ?? 0}`
    case 'type': return `${where}type ${JSON.stringify(String(step.text ?? '').slice(0, 40))}`
    case 'key': return `${where}key ${step.key}${step.count ? ` ×${step.count}` : ''}`
    case 'hotkey': return `${where}hotkey ${step.keys}`
    case 'open': return `open ${step.app}（敏感）`
    case 'close': return `${where}close（敏感）`
    default: return `${where}${step.action || '?'}`
  }
}

/**
 * @param {{get(name:string):any}} ctx plugin context
 * @param {object} config resolved plugin config
 * @returns {Array} tools ready for ctx.tools.register
 */
export function createTools(ctx, config) {
  const look = defineTool({
    name: 'screen_look',
    description: [
      '看主人的 Windows 桌面。默认 mode=auto：先去读这个窗口的 UI Automation 控件清单——',
      '控件够用就只回一张文字清单（每个控件的中心坐标、路径、该怎么操作），**完全不截图**，省下读图的时间和 token；',
      '控件太少（游戏、自绘界面、Chromium 页面这类不暴露 UIA 的）才乖乖截图。',
      'mode=pixels 强制截图；mode=uia 强制只看控件清单。',
      '截图本身要用 read_image 打开返回的 path 才能看见内容。',
      '动手之前先 look 一眼，这是本插件的规矩。',
    ].join(''),
    parameters: {
      window: { type: 'string', description: '窗口标题片段或 handle；省略就是前台窗口。' },
      mode: {
        type: 'string',
        enum: ['auto', 'uia', 'pixels'],
        description: 'auto（默认）有 UIA 就走文字清单，没有才截图；uia 只读控件；pixels 只截图。',
      },
      region: {
        type: 'object',
        additionalProperties: false,
        description: '只截一块区域，物理像素坐标（仅 pixels 模式）。',
        properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
      },
      maxNodes: { type: 'number', description: 'UIA 最多读多少个节点（默认 160）。' },
      maxWidth: { type: 'number', description: '图片最大宽度（默认 1600，越小越省 token）。' },
      maxHeight: { type: 'number', description: '图片最大高度（默认 1200）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true, description: 'uia 或 pixels：这次走的是哪条路' },
          path: { type: 'string', description: '截图路径（只有 pixels 模式才有）' },
          imageWidth: { type: 'number' },
          imageHeight: { type: 'number' },
          sourceWidth: { type: 'number' },
          sourceHeight: { type: 'number' },
          originX: { type: 'number' },
          originY: { type: 'number' },
          scaleX: { type: 'number' },
          scaleY: { type: 'number' },
          controls: { type: 'number', description: 'UIA 给出多少个可操作控件' },
          foreground: { type: 'string' },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.path ? `${value.summary}\n\n用 read_image 打开这张图：${value.path}` : value.summary,
      }],
    },
    timeoutMs: 40000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const target = resolveWindow(args.window)
      const mode = args.mode ?? 'auto'
      const desk = describeDesktop({ maxWindows: args.window ? 3 : 12 })
      const handle = target?.handle ?? desk.foreground?.handle
      const winTitle = target?.title
        || desk.windows.find(w => w.handle === handle)?.title
        || listWindows().find(w => w.handle === handle)?.title
        || (handle ? `handle=${handle}` : '前台窗口')
      let fallbackReason = ''
      let seenControls = 0

      if (mode !== 'pixels' && handle) {
        let view = null
        try {
          view = await uiaView({ handle }, { maxNodes: args.maxNodes ?? 160 })
        } catch (error) {
          fallbackReason = `UIA 读不了这个窗口：${error.message}`
        }
        const count = view?.controls.length ?? 0
        seenControls = count
        if (view && count >= (config.uiaMinControls ?? 3)) {
          // Knowledge is fresh, but there is no image to anchor imageX/imageY against.
          state.lastLookAt = Date.now()
          state.lastShot = null
          const head = `没截图——「${winTitle}」的 UIA 够用：${count} 个可操作控件，照这张清单直接干活`
          return {
            mode: 'uia',
            controls: count,
            foreground: desk.foreground?.title ?? '',
            summary: [
              head,
              controlLines(view, { title: winTitle }),
              view.truncated ? '（树被截断了，只列了前一部分）' : '',
              '坐标是屏幕物理像素，可以直接喂 screen_act 的 x/y；也可以把第二列的 path 当 control 传给 screen_act / screen_sequence，本鱼动手时会重新量它的位置。',
            ].filter(Boolean).join('\n'),
          }
        }
        if (mode === 'uia') {
          return {
            mode: 'uia',
            controls: count,
            foreground: desk.foreground?.title ?? '',
            summary: `「${winTitle}」没有可用的 UIA 控件（${count} 个）。这个程序大概得靠截图——用 screen_look mode=pixels。`,
          }
        }
        fallbackReason = fallbackReason || `UIA 只给出 ${count} 个可操作控件`
        if (view && count === 0 && view.nodes.length > 1) {
          // Nodes exist but none is usable: usually they are behind another window, which
          // is worth saying out loud — the fix is to raise the window, not to squint at a picture.
          fallbackReason += `（读到 ${view.nodes.length} 个节点，但都被挡住或不可操作——把窗口切前台再看会更准）`
        }
      }

      const shot = grab({
        dir: config.shotDir,
        window: target?.handle,
        region: args.region,
        maxWidth: args.maxWidth ?? 1600,
        maxHeight: args.maxHeight ?? 1200,
        name: 'look',
      })
      state.lastShot = { ...shot, at: Date.now() }
      state.lastLookAt = Date.now()
      return {
        mode: 'pixels',
        path: shot.path,
        controls: seenControls,
        imageWidth: shot.imageWidth,
        imageHeight: shot.imageHeight,
        sourceWidth: shot.sourceWidth,
        sourceHeight: shot.sourceHeight,
        originX: shot.origin.x,
        originY: shot.origin.y,
        scaleX: shot.scaleX,
        scaleY: shot.scaleY,
        foreground: desk.foreground?.title ?? '',
        summary: [
          `${shot.label} 已截取（${Math.round(shot.bytes / 1024)} KB）`,
          fallbackReason ? `为什么走截图：${fallbackReason}` : '',
          windowLines(desk),
          coordHint(shot),
        ].filter(Boolean).join('\n'),
      }
    },
  })

  const windows = defineTool({
    name: 'screen_windows',
    description: '列出当前所有可见窗口：标题、窗口类、handle、位置大小、是否最小化、是否在前台。想找某个窗口的 handle 就用它。',
    parameters: {},
    output: text,
    timeoutMs: 20000,
    isConcurrencySafe: () => true,
    async execute() {
      const desk = describeDesktop({ maxWindows: 60 })
      return windowLines(desk)
    },
  })

  const focus = defineTool({
    name: 'screen_focus',
    description: '把某个窗口切到前台（最小化的会先还原）。键盘输入只会送到前台窗口，所以要先 focus 再打字。',
    parameters: { window: { type: 'string', required: true, description: '窗口标题片段或 handle。' } },
    output: text,
    timeoutMs: 20000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const target = resolveWindow(args.window)
      if (!target) throw new Error('screen_focus 需要一个窗口')
      const ok = focusWindow(target.handle)
      const fg = foregroundWindow()
      if (!ok) {
        return `切前台失败：handle=${target.handle}「${target.title || '未命名'}」没能上前台。\n`
          + `当前前台：${fg ? `${fg.title || '(无标题)'} handle=${fg.handle}` : '无'}\n`
          + '系统的前台锁挡住了这次切换（常见于刚启动的程序或别的程序正抢焦点）。重试一次通常就好了；'
          + '还是不行的话，手动点一下那个窗口也可以。'
      }
      return `已切到前台：handle=${target.handle}「${target.title || '未命名'}」\n当前前台：${fg ? `${fg.title} handle=${fg.handle}` : '无'}（已核实是它本人）`
    },
  })

  const uiaTool = defineTool({
    name: 'screen_uia',
    description: [
      '读一个窗口的 UI 自动化（UIA）控件树，或者按控件操作——比盲点鼠标稳得多，而且不需要窗口在前台。',
      'action=tree 拿控件树（每个节点有 path、类型、名字、坐标、可用模式）；action=find 按名字/类型/id 找控件；',
      'action=rect 按 path 取单个控件当下的位置和状态（最轻，点它之前用它量一次）；',
      'action=invoke 点按钮、setvalue 填输入框、getvalue 读输入框、select 选中列表项、focus 聚焦。',
      'path 用 tree 返回的路径字符串（如 0/2/1/1），只在这个窗口内有效。',
    ].join(''),
    parameters: {
      window: { type: 'string', description: '窗口标题片段或 handle；省略就是当前前台窗口。' },
      action: { type: 'string', enum: ['window', 'tree', 'rect', 'find', 'invoke', 'setvalue', 'getvalue', 'select', 'focus'], required: true },
      path: { type: 'string', description: 'tree 返回的控件路径，如 0/3/1/1/1。' },
      name: { type: 'string', description: '按控件名字找（find/invoke/setvalue 等）。' },
      automationId: { type: 'string', description: 'find：按 AutomationId 找。' },
      className: { type: 'string', description: 'find：按窗口类名找。' },
      controlType: { type: 'string', description: 'find：按控件类型找，如 Button、Edit、MenuItem。' },
      value: { type: 'string', description: 'setvalue 要写入的文本。' },
      maxDepth: { type: 'number', description: 'tree 最大深度，默认 6。' },
      maxNodes: { type: 'number', description: 'tree 最大节点数，默认 400。' },
      onlyNamed: { type: 'boolean', description: 'tree 只返回有名字或有可用模式的节点（推荐 true，省 token）。' },
    },
    output: text,
    timeoutMs: 60000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const target = args.window ? resolveWindow(args.window) : null
      const request = {
        action: args.action,
        ...(target ? { handle: target.handle } : {}),
        ...(args.path !== undefined ? { path: args.path } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.automationId !== undefined ? { automationId: args.automationId } : {}),
        ...(args.className !== undefined ? { className: args.className } : {}),
        ...(args.controlType !== undefined ? { controlType: args.controlType } : {}),
        ...(args.value !== undefined ? { value: args.value } : {}),
        ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
        ...(args.maxNodes !== undefined ? { maxNodes: args.maxNodes } : {}),
        ...(args.onlyNamed !== undefined ? { onlyNamed: args.onlyNamed } : {}),
      }
      const result = await uia(request, { timeoutMs: 55000 })
      if (!result.ok) throw new Error(`UIA ${args.action} 失败：${result.error}`)

      if (args.action === 'tree') {
        const lines = [`UIA 控件树：${result.count} 个节点${result.truncated ? '（已截断）' : ''}`]
        for (const n of result.nodes ?? []) {
          const patterns = Array.isArray(n.patterns) ? n.patterns.join(',') : ''
          const rect = n.rect ? `@${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}` : ''
          lines.push(`${String(n.path).padEnd(12)} ${String(n.type).padEnd(16)} ${JSON.stringify(n.name ?? '')} ${patterns ? `[${patterns}]` : ''} ${rect}`)
        }
        return lines.join('\n')
      }
      if (args.action === 'find') {
        const lines = [`找到 ${result.count} 个匹配控件`]
        for (const n of result.matches ?? []) {
          const rect = n.rect ? `@${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}` : ''
          lines.push(`${String(n.type).padEnd(16)} ${JSON.stringify(n.name ?? '')} id=${n.automationId || '-'} ${rect}`)
        }
        return lines.join('\n')
      }
      if (args.action === 'window') {
        const r = result.root
        return `窗口：${JSON.stringify(r.name)} 类型=${r.type} 位置=${r.rect ? `${r.rect.width}x${r.rect.height}@${r.rect.x},${r.rect.y}` : '未知'} 可用模式=${(r.patterns ?? []).join(',') || '无'}`
      }
      return `UIA ${args.action} 完成${result.value !== undefined ? `，当前值：${JSON.stringify(result.value)}` : ''}${result.invoked ? `，控件：${JSON.stringify(result.invoked.name ?? '')}` : ''}`
    },
  })

  const act = defineTool({
    name: 'screen_act',
    description: [
      '在 Windows 桌面上动手：点鼠标、拖拽、滚轮、打字、按快捷键、启动或关闭程序。',
      '坐标是物理屏幕像素；也可以传 imageX/imageY，按上一张 screen_look 截图里的像素来点，插件自己换算。',
      '动手前先 screen_look 看一眼；能点控件就优先用 screen_uia 的 invoke/setvalue，比坐标点击稳。',
      '敏感动作（启动程序、关闭窗口、Alt+F4、Win 键组合）会被安全闸拦下，需要先问主人、再带 confirmed: true 重调。',
      '执行完默认自动再截一张图，省得你再 look 一次（observe: false 可以关掉）。',
    ].join(''),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key', 'hotkey', 'open', 'close'],
        description: '要做的动作。',
      },
      window: { type: 'string', description: '动作前先把这个窗口切到前台（标题片段或 handle）。' },
      x: { type: 'number', description: '物理屏幕 x 坐标（click/move/drag/scroll）。' },
      y: { type: 'number', description: '物理屏幕 y 坐标。' },
      imageX: { type: 'number', description: '按上一张截图的像素 x 来定位。' },
      imageY: { type: 'number', description: '按上一张截图的像素 y 来定位。' },
      control: { type: 'string', description: '按 UIA 控件路径定位（screen_look / screen_uia 给的 path，如 0/2/1）。给了它 x/y 就忽略；动作时会重新量控件的位置，支持 Invoke 的按钮直接用 UIA 按下去，不点鼠标。' },
      how: { type: 'string', enum: ['click', 'invoke'], description: 'control 怎么驱动：invoke 用 UIA 直接触发（默认，控件支持的话），click 走鼠标点它的中心。' },
      toX: { type: 'number', description: 'drag 终点 x。' },
      toY: { type: 'number', description: 'drag 终点 y。' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标键，默认 left。' },
      count: { type: 'number', description: '点击次数，默认 1。' },
      deltaY: { type: 'number', description: '滚轮纵向滚动量（正数向下，120 为一格）。' },
      deltaX: { type: 'number', description: '滚轮横向滚动量。' },
      text: { type: 'string', description: 'type 要输入的文本（支持中文，走 Unicode 注入，不依赖输入法）。' },
      key: { type: 'string', description: 'key 要按的键名，如 enter、tab、esc、f5、ctrl 等。' },
      keys: { type: 'string', description: 'hotkey 组合键，如 "ctrl+s"、"alt+tab"。' },
      app: { type: 'string', description: 'open 要启动的程序路径或命令。' },
      confirmed: { type: 'boolean', description: '敏感动作：主人已经点头了，才传 true。' },
      observe: { type: 'boolean', description: '动作后是否自动截图，默认 true（move 默认不截）。' },
      settleMs: { type: 'number', description: '截图前等画面重绘的毫秒数，默认取配置 settleMs。' },
    },
    output: text,
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const refusal = gate(args.action, args, config)
      if (refusal) return `⛔ 安全闸拦下：${refusal}`

      const action = args.action
      // "Look before you touch": a stale or missing look means the agent is guessing.
      // A control path is exempt — it gets re-measured at action time, so it cannot drift.
      if (action !== 'move' && !args.control) {
        const age = state.lastLookAt ? Date.now() - state.lastLookAt : Infinity
        if (age > staleAfterMs(config)) {
          return `⛔ 先看一眼再动手：${state.lastLookAt ? `上一次观察已经是 ${Math.round(age / 1000)} 秒前的了` : '还没看过屏幕'}。`
            + '调用 screen_look（有 UIA 就回控件清单，没有才截图），然后再动手。'
        }
      }

      const point = pointOf(args)

      let target = null
      if (args.window) {
        target = resolveWindow(args.window)
        const focused = focusWindow(target.handle)
        if (!focused) {
          // Never click into whatever happens to be in front: that is how a stray click
          // lands in the wrong app. Refuse and say what the foreground actually is.
          const fg = foregroundWindow()
          return `⛔ 切不到前台，这一下没发出去：想让「${target.title || target.handle}」上前台，但前台还留在「${fg?.title || '(未知窗口)'}」`
            + `（handle=${fg?.handle ?? '无'}）。系统拒绝了这次前台切换，所以本鱼一个点击、一个按键都没发——`
            + '宁可不动，也不能点到别的窗口上去。可以手动把它点上前台，或者让主人再试一次。'
        }
      }

      // Light up the "I am driving" pill, and honour the brake before anything is sent.
      if (escPressed(config, state.ignoreEscUntil)) {
        return '⛔ 主人按了 Esc，这一下没发出去（Esc 取消是配置里开着的）。'
      }
      showDriving(config)

      const driven = await uiaStep(args, target)
      let notes
      if (driven?.handled) {
        notes = [...driven.notes]
      } else {
        notes = performAction(action, args, config, { point: driven?.point ?? point, target })
        if (driven?.notes?.length) notes.unshift(...driven.notes)
      }
      const fg = foregroundWindow()
      notes.push(`当前前台：${fg ? `${fg.title} handle=${fg.handle}` : '无'}`)
      // Our own Esc must not look like the user's brake on the next step.
      if (action === 'key' && String(args.key ?? '').toLowerCase() === 'esc') {
        state.ignoreEscUntil = Date.now() + 600
      }

      // A move changes nothing anyone can see, so it does not pay for a frame by default.
      const wantsObserve = args.observe ?? (action !== 'move')
      if (wantsObserve === false) return notes.join('\n')
      const observed = observe(config, { settleMs: args.settleMs })
      return `${notes.join('\n')}\n\n${observed.text}`
    },
  })

  const sequence = defineTool({
    name: 'screen_sequence',
    description: [
      '一次调用跑完一整串动作（切窗口 → 点输入框 → 打字 → 回车 → 看结果），只回一次、只截一张图。',
      '省的不是点击速度，是「你和电脑来回说多少次话」：五步任务从五次往返变成一次。',
      'steps 每一步的字段和 screen_act 一样（action 必填），但不用写 observe。',
      '每步也可以只给 control（UIA 控件路径）：本鱼会在动作那一刻重新量它的位置——',
      'type 直接给输入框赋值（不碰键盘）、按钮直接 Invoke（不动鼠标），位置漂了也不怕。',
      '整批会先过安全闸：任何一步含敏感动作（启动程序、关窗口、Alt+F4、Win 组合键），整批一步都不动，除非 confirmed: true。',
      '任何一步失败默认立刻停下（stopOnError: false 可继续），并报出是第几步、为什么。',
      'dryRun: true 只校验并列出计划，不碰桌面。',
    ].join(''),
    parameters: {
      steps: {
        type: 'array',
        required: true,
        description: '按顺序执行的动作，每步 {action, x, y, imageX, imageY, text, key, keys, toX, toY, button, count, deltaX, deltaY, app, window, confirmed}。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              required: true,
              enum: ['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key', 'hotkey', 'open', 'close'],
            },
            x: { type: 'number', description: '屏幕物理像素 x。' },
            y: { type: 'number', description: '屏幕物理像素 y。' },
            imageX: { type: 'number', description: '按当前截图里的像素 x 定位。' },
            imageY: { type: 'number', description: '按当前截图里的像素 y 定位。' },
            control: { type: 'string', description: '按 UIA 控件路径定位（如 0/2/1）：动作时重新量位置，type 直接赋值、按钮直接 Invoke。给了它就不用写 x/y。' },
            how: { type: 'string', enum: ['click', 'invoke'], description: 'control 怎么驱动：invoke 用 UIA 直接触发（默认），click 走鼠标点中心。' },
            toX: { type: 'number', description: 'drag 终点 x。' },
            toY: { type: 'number', description: 'drag 终点 y。' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: '鼠标键，默认 left。' },
            count: { type: 'number', description: '点击/按键次数。' },
            deltaX: { type: 'number', description: '滚轮横向滚动量。' },
            deltaY: { type: 'number', description: '滚轮纵向滚动量，正数向下，120 一格。' },
            text: { type: 'string', description: 'type 要输入的文本。' },
            key: { type: 'string', description: 'key 要按的键名，如 enter、tab、esc、f5。' },
            keys: { type: 'string', description: 'hotkey 组合键，如 ctrl+s。' },
            app: { type: 'string', description: 'open 要启动的程序。' },
            window: { type: 'string', description: '这一步之前先把这个窗口切到前台。' },
            confirmed: { type: 'boolean', description: '这一步的敏感动作已获同意。' },
          },
        },
      },
      window: { type: 'string', description: '整批开始前先切到这个窗口（标题片段或 handle），切不到就整批不动。' },
      capture: { type: 'string', enum: ['end', 'none'], description: '批次结束截一张（默认 end）还是完全不截（none）。失败时总是补一张。' },
      settleMs: { type: 'number', description: '收尾截图前等画面重绘的毫秒数。' },
      stopOnError: { type: 'boolean', description: '某步失败就停，默认 true。' },
      dryRun: { type: 'boolean', description: '只校验并列出计划，不碰桌面。' },
      confirmed: { type: 'boolean', description: '整批的敏感动作已获同意。' },
    },
    output: text,
    timeoutMs: 180000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const steps = Array.isArray(args.steps) ? args.steps : []
      if (!steps.length) throw new Error('screen_sequence 需要至少一步')
      const max = config.maxSequenceSteps ?? 24
      if (steps.length > max) {
        return `⛔ 一批最多 ${max} 步（收到 ${steps.length} 步）。拆成两批发，或者把插件配置 maxSequenceSteps 调大。`
      }

      // 整批先验安全闸：只要有一处该问人，就一步都不动
      const blocked = []
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i] ?? {}
        const refusal = gate(step.action, { ...step, confirmed: step.confirmed ?? args.confirmed }, config)
        if (refusal) blocked.push(`第 ${i + 1} 步（${step.action || '?'}）：${refusal}`)
      }
      if (blocked.length) {
        return `⛔ 这一批一步都没动，先看拦在哪儿：\n${blocked.join('\n')}\n`
          + '含敏感动作的批次要主人点头后带 confirmed: true 重发；想先看计划用 dryRun: true。'
      }

      if (args.dryRun) {
        return `计划（dryRun：只校验，什么都没动）\n${steps.map((s, i) => `${i + 1}. ${summarizeStep(s)}`).join('\n')}`
      }

      const age = state.lastLookAt ? Date.now() - state.lastLookAt : Infinity
      if (age > staleAfterMs(config)) {
        return `⛔ 先看一眼再动手：${state.lastLookAt ? `上一次观察已经是 ${Math.round(age / 1000)} 秒前的了` : '还没看过屏幕'}。`
          + '调用 screen_look 看一眼，再发这一批（每步都带 control 的话可以免这一步）。'
      }

      let target = null
      if (args.window) {
        target = resolveWindow(args.window)
        if (!focusWindow(target.handle)) {
          const fg = foregroundWindow()
          return `⛔ 切不到前台，整批一步都没发：想让「${target.title || target.handle}」上前台，`
            + `前台还留在「${fg?.title || '(未知窗口)'}」。`
        }
      }

      const rows = []
      let failed = null
      const startedAt = Date.now()
      for (let i = 0; i < steps.length; i++) {
        const step = { ...steps[i] }
        const t0 = Date.now()
        // The brake works between steps, which is where a batch can still be stopped cleanly.
        if (escPressed(config, state.ignoreEscUntil)) {
          failed = { index: i, message: '主人按了 Esc，取消了' }
          rows.push(`  ${i + 1}. ⛔         step — 主人按了 Esc，剩下 ${steps.length - i} 步一步没发`)
          break
        }
        showDriving(config, `第 ${i + 1}/${steps.length} 步`)
        try {
          let stepTarget = target
          if (step.window) {
            stepTarget = resolveWindow(step.window)
            if (!focusWindow(stepTarget.handle)) throw new Error(`切不到前台「${stepTarget.title || stepTarget.handle}」`)
          }
          const driven = await uiaStep(step, stepTarget)
          let notes
          if (driven?.handled) {
            notes = [...driven.notes]
          } else {
            notes = performAction(step.action, step, config, { point: driven?.point ?? pointOf(step), target: stepTarget })
            if (driven?.notes?.length) notes.unshift(...driven.notes)
          }
          rows.push(`  ${i + 1}. ✓ ${String(Date.now() - t0).padStart(4)}ms  ${step.action} — ${notes.join('；')}`)
        } catch (err) {
          failed = { index: i, message: err.message }
          rows.push(`  ${i + 1}. ✗ ${String(Date.now() - t0).padStart(4)}ms  ${step.action} — ${err.message}`)
          if (args.stopOnError !== false) break
        }
        if (step.action === 'key' && String(step.key ?? '').toLowerCase() === 'esc') {
          state.ignoreEscUntil = Date.now() + 600
        }
      }

      const okCount = rows.filter(row => row.includes('✓')).length
      const elapsed = Date.now() - startedAt
      const header = failed
        ? `批次停在第 ${failed.index + 1} 步：共 ${steps.length} 步，完成 ${okCount} 步，整批 ${elapsed}ms`
        : `批次完成：${steps.length} 步全过，整批 ${elapsed}ms（一次调用，一次截图）`

      if (args.capture === 'none') return `${header}\n${rows.join('\n')}`
      const observed = observe(config, {
        settleMs: args.settleMs,
        note: failed ? `停下的原因：${failed.message}` : undefined,
      })
      return `${header}\n${rows.join('\n')}\n\n${observed.text}`
    },
  })

  return [look, windows, focus, uiaTool, act, sequence]
}