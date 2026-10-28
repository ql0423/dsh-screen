// The safety gate: what needs the partner's explicit go-ahead before the hands move.
const RISKY_ACTIONS = new Set(['close', 'open'])

/**
 * Hotkeys that can lock the screen, sign out, open Task Manager or kill the front window.
 * @param {string[]} keys
 * @returns {string|null} why it is risky
 */
export function hotkeyRisk(keys) {
  const norm = (Array.isArray(keys) ? keys : String(keys).split('+')).map(k => String(k).trim().toLowerCase()).filter(Boolean)
  const has = k => norm.includes(k)
  if (has('alt') && has('f4')) return '会关掉当前前台窗口'
  if (has('ctrl') && has('shift') && has('esc')) return '会打开任务管理器'
  if (has('win')) {
    if (has('l')) return '会锁屏'
    if (has('d')) return '会最小化全部窗口'
    if (has('r')) return '会打开运行对话框'
    if (has('x')) return '会打开系统快捷菜单'
  }
  if (has('ctrl') && has('alt') && has('delete')) return '是安全注意序列（系统会拦下）'
  return null
}

/**
 * Decide whether an action may run now.
 * @param {string} action
 * @param {object} args
 * @param {{readOnly?:boolean, allowRisky?:boolean}} config
 * @returns {string|null} refusal reason, or null when allowed
 */
export function gate(action, args, config = {}) {
  if (config.readOnly && action !== 'move') {
    return `插件现在处于只读模式（readOnly），只能看不能动：${action} 被拦下。让主人把 dsh-screen 配置里的 readOnly 关掉才能动手。`
  }
  if (args?.confirmed === true) return null

  let reason = null
  if (RISKY_ACTIONS.has(action)) {
    reason = action === 'close' ? '关闭窗口' : '启动新程序'
  }
  if (action === 'hotkey') {
    const why = hotkeyRisk(args?.keys ?? '')
    if (why) reason = `这个快捷键${why}`
  }
  if (config.allowRisky === true) return null
  if (!reason) return null

  return [
    `这一步属于敏感操作：${reason}。`,
    '按本鱼的规矩，得先跟主人说一声、等主人同意，再带 confirmed: true 重新调用。',
    '在问之前，先把当前屏幕截一张（screen_look）发给主人看，让他知道你要对哪个窗口下手。',
  ].join('')
}