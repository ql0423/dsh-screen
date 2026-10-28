/**
 * dsh-screen — desktop eyes and hands for DSH.
 *
 * Gives the agent the four things a human has when sitting at this PC: see the
 * screen, list and raise windows, read the UI Automation tree of an app, and
 * inject real mouse/keyboard input. No floating ball, no separate window — the
 * commands stay in DSH.
 */
import { z, hasHostRuntime } from './runtime.js'
import { createTools } from './tools.js'
import { screenMetrics } from './win32.js'
import { shotDir } from './capture.js'
import { stopUiaWorker } from './uia.js'

export const name = 'dsh-screen'

/** The tools service is all this plugin needs. */
export const inject = ['tools']

const DEFAULTS = {
  readOnly: false,
  allowRisky: false,
  shotDir: '',
  observeMaxWidth: 1280,
  observeMaxHeight: 900,
  typeDelayMs: 0,
  requireFreshLookSeconds: 120,
  settleMs: 180,
  maxSequenceSteps: 24,
  uiaMinControls: 3,
}

export const Config = hasHostRuntime
  ? z.object({
    readOnly: z.boolean().default(false).description('只读模式：能看不能动手'),
    allowRisky: z.boolean().default(false).description('危险动作（开程序/关窗口/系统快捷键）免确认；默认关'),
    shotDir: z.string().description('截图存哪儿，默认系统临时目录下的 dsh-screen/shots'),
    observeMaxWidth: z.number().default(1280).description('动作后自动截图的最大宽度'),
    observeMaxHeight: z.number().default(900).description('动作后自动截图的最大高度'),
    typeDelayMs: z.number().default(0).description('逐字输入时每个字符之间的间隔毫秒数'),
    requireFreshLookSeconds: z.number().default(120).description('动手前多久内必须看过屏幕，0 = 不检查'),
    settleMs: z.number().default(180).description('动作后等画面重绘多久再截图，默认 180 毫秒'),
    maxSequenceSteps: z.number().default(24).description('screen_sequence 一批最多几步'),
    uiaMinControls: z.number().default(3).description('screen_look 的 auto 模式里，UIA 至少给出几个可操作控件才不截图'),
  })
  : undefined

function resolveConfig(config) {
  const merged = { ...DEFAULTS, ...(config ?? {}) }
  merged.shotDir = merged.shotDir ? shotDir(merged.shotDir) : shotDir()
  return merged
}

export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const disposers = []

  try {
    // Fail loudly at apply time rather than at the first click: if the FFI layer is
    // unavailable the plugin is useless, and a silent half-registration is worse.
    const metrics = screenMetrics()
    ctx.logger?.info?.(`[dsh-screen] ready: ${metrics.width}x${metrics.height}, ${metrics.monitors} monitor(s), shots in ${resolved.shotDir}`)
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-screen] Win32 unavailable, tools will report the failure: ${error?.message ?? error}`)
  }

  for (const tool of createTools(ctx, resolved)) {
    // One colliding name must cost that one tool, never the rest of the set.
    try {
      const dispose = ctx.tools.register(tool)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-screen] could not register ${tool.name}: ${error?.message ?? error}`)
    }
  }

  const cleanup = () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* already gone with the plugin scope */ }
    }
    disposers.length = 0
    // Leave no stray PowerShell behind when the plugin goes away.
    try { stopUiaWorker() } catch { /* nothing warm to stop */ }
  }
  try { ctx.on('dispose', cleanup) } catch { /* older host without a dispose event */ }
  return cleanup
}