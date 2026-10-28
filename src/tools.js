// The tool surface: what the agent can call to see and drive the Windows desktop.
import { spawn } from 'node:child_process'
import { defineTool } from './runtime.js'
import {
  listWindows, foregroundWindow, focusWindow, windowHandleByTitle, closeWindow,
  click, drag, scroll, tryMoveCursor, cursorPosition, typeText, pressKey, hotkey,
  processNameOfPid, screenMetrics,
} from './win32.js'
import { grab, describeDesktop } from './capture.js'
import { uia } from './uia.js'
import { gate } from './safety.js'

const text = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

/** Only one screenshot is "current" at a time; actions may reference its pixel space. */
const state = { lastShot: null }

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

function observe(config, extra = {}) {
  const shot = grab({ dir: config.shotDir, maxWidth: config.observeMaxWidth ?? 1280, maxHeight: config.observeMaxHeight ?? 900, name: 'after' })
  state.lastShot = { ...shot, at: Date.now() }
  const desk = describeDesktop({ maxWindows: 6 })
  return { shot, text: `动作执行完，已经重新截了一张：${shot.path}（${shot.imageWidth}x${shot.imageHeight}）\n${windowLines(desk)}${extra.note ? `\n${extra.note}` : ''}` }
}

/** How stale the last look may be before the hands are refused, in ms. */
function staleAfterMs(config) {
  return (config.requireFreshLookSeconds ?? 120) * 1000
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
      '看主人的 Windows 桌面：截一张图存成 PNG，同时报出前台窗口和可见窗口列表。',
      '截图本身要用 read_image 打开返回的 path 才能看见内容；本工具负责把「哪块屏幕、什么窗口、坐标怎么换」讲清楚。',
      '参数 window 可以按标题片段或 handle 只截某个窗口；region 只截一块矩形；不给就是整屏。',
      '动手之前先 look 一眼，这是本插件的规矩。',
      '注意：window 单拍走 PrintWindow，图里比窗口矩形少一圈隐形边框，照它换算最多偏二十几像素——',
      '要精确点某个控件，用整屏截图算坐标，或者用 screen_uia 报的物理坐标。',
    ].join(''),
    parameters: {
      window: { type: 'string', description: '窗口标题片段或 handle；只截这个窗口。' },
      region: {
        type: 'object',
        additionalProperties: false,
        description: '只截一块区域，物理像素坐标。',
        properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
      },
      maxWidth: { type: 'number', description: '图片最大宽度（默认 1600，越小越省 token）。' },
      maxHeight: { type: 'number', description: '图片最大高度（默认 1200）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          imageWidth: { type: 'number', required: true },
          imageHeight: { type: 'number', required: true },
          sourceWidth: { type: 'number', required: true },
          sourceHeight: { type: 'number', required: true },
          originX: { type: 'number', required: true },
          originY: { type: 'number', required: true },
          scaleX: { type: 'number', required: true },
          scaleY: { type: 'number', required: true },
          foreground: { type: 'string' },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.summary}\n\n用 read_image 打开这张图：${value.path}` }],
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const target = resolveWindow(args.window)
      const shot = grab({
        dir: config.shotDir,
        window: target?.handle,
        region: args.region,
        maxWidth: args.maxWidth ?? 1600,
        maxHeight: args.maxHeight ?? 1200,
        name: 'look',
      })
      state.lastShot = { ...shot, at: Date.now() }
      const desk = describeDesktop({ maxWindows: args.window ? 3 : 12 })
      return {
        path: shot.path,
        imageWidth: shot.imageWidth,
        imageHeight: shot.imageHeight,
        sourceWidth: shot.sourceWidth,
        sourceHeight: shot.sourceHeight,
        originX: shot.origin.x,
        originY: shot.origin.y,
        scaleX: shot.scaleX,
        scaleY: shot.scaleY,
        foreground: desk.foreground?.title ?? '',
        summary: `${shot.label} 已截取（${Math.round(shot.bytes / 1024)} KB）\n${windowLines(desk)}\n${coordHint(shot)}`,
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
      'action=invoke 点按钮、setvalue 填输入框、getvalue 读输入框、select 选中列表项、focus 聚焦。',
      'path 用 tree 返回的路径字符串（如 0/2/1/1），只在这个窗口内有效。',
    ].join(''),
    parameters: {
      window: { type: 'string', description: '窗口标题片段或 handle；省略就是当前前台窗口。' },
      action: { type: 'string', enum: ['window', 'tree', 'find', 'invoke', 'setvalue', 'getvalue', 'select', 'focus'], required: true },
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
      const result = uia(request, { timeoutMs: 55000 })
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
      observe: { type: 'boolean', description: '动作后是否自动截图，默认 true。' },
    },
    output: text,
    timeoutMs: 120000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const refusal = gate(args.action, args, config)
      if (refusal) return `⛔ 安全闸拦下：${refusal}`

      const action = args.action
      // "Look before you touch": a stale or missing look means the agent is guessing.
      if (action !== 'move') {
        const last = state.lastShot
        const age = last ? Date.now() - last.at : Infinity
        if (age > staleAfterMs(config)) {
          return `⛔ 先看一眼再动手：${last ? `上一张截图已经是 ${Math.round(age / 1000)} 秒前的了` : '还没有截过屏'}。`
            + '调用 screen_look 重新截一张（看完再动手），然后重试这一步。'
        }
      }

      let point = null
      if (args.imageX !== undefined && args.imageY !== undefined) {
        const shot = state.lastShot
        if (!shot) return '⛔ 还没有截图可以参照：先调用 screen_look 截一张，再用 imageX/imageY。'
        point = { x: shot.origin.x + args.imageX * shot.scaleX, y: shot.origin.y + args.imageY * shot.scaleY }
      } else if (args.x !== undefined && args.y !== undefined) {
        point = { x: args.x, y: args.y }
      }

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
          const child = spawn(args.app, [], { detached: true, stdio: 'ignore', windowsHide: false, shell: true })
          child.unref()
          notes.push(`启动了 ${args.app}（pid ${child.pid}）`)
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

      const fg = foregroundWindow()
      notes.push(`当前前台：${fg ? `${fg.title} handle=${fg.handle}` : '无'}`)

      if (args.observe === false) return notes.join('\n')
      const observed = observe(config)
      return `${notes.join('\n')}\n\n${observed.text}`
    },
  })

  return [look, windows, focus, uiaTool, act]
}