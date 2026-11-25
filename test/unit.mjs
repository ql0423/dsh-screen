// Unit tests that never touch the desktop: the decisions, not the pixels.
//
// Run: node test/unit.mjs
import { gate, hotkeyRisk } from '../src/safety.js'
import { splitAppSpec } from '../src/win32.js'

let passed = 0
let failed = 0
function equal(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { passed++; console.log(`✓ ${name}`) } else {
    failed++
    console.log(`✗ ${name}\n    期望 ${JSON.stringify(expected)}\n    实际 ${JSON.stringify(actual)}`)
  }
}

// ---- hotkeyRisk: what counts as dangerous
equal('alt+f4 判为关窗口', Boolean(hotkeyRisk('alt+f4')), true)
equal('Win+L 判为锁屏', Boolean(hotkeyRisk('win+l')), true)
equal('Win+D 判为最小化全部', Boolean(hotkeyRisk('win+d')), true)
equal('Ctrl+Shift+Esc 判为任务管理器', Boolean(hotkeyRisk('ctrl+shift+esc')), true)
equal('Ctrl+C 不是危险键', hotkeyRisk('ctrl+c'), null)
equal('普通字母不是危险键', hotkeyRisk('a'), null)
equal('大写也能认出来', Boolean(hotkeyRisk('ALT+F4')), true)
equal('数组写法也能认出来', Boolean(hotkeyRisk(['Alt', 'F4'])), true)

// ---- gate: readOnly / allowRisky / confirmed
const blockedByReadOnly = gate('click', {}, { readOnly: true })
equal('只读模式拦下点击', /只读/.test(blockedByReadOnly ?? ''), true)
equal('只读模式放行 move（移动不算改动）', gate('move', {}, { readOnly: true }), null)
equal('readOnly 下确认也放行不了？不该放行', /只读/.test(gate('click', { confirmed: true }, { readOnly: true }) ?? ''), true)

const riskyOpen = gate('open', { app: 'notepad.exe' }, {})
equal('open 默认要确认', /敏感操作/.test(riskyOpen ?? ''), true)
equal('open 带 confirmed 放行', gate('open', { app: 'notepad.exe', confirmed: true }, {}), null)
equal('allowRisky 时 open 不用确认', gate('open', { app: 'notepad.exe' }, { allowRisky: true }), null)
equal('close 默认要确认', /敏感操作/.test(gate('close', { window: 'x' }, {}) ?? ''), true)
equal('危险热键要确认', /敏感操作/.test(gate('hotkey', { keys: 'alt+f4' }, {}) ?? ''), true)
equal('安全热键直接放行', gate('hotkey', { keys: 'ctrl+c' }, {}), null)

// ---- splitAppSpec: how an app string is split before ShellExecute
equal('裸 exe', splitAppSpec('notepad.exe'), { file: 'notepad.exe', params: null })
equal('URL 整体当文件', splitAppSpec('https://github.com/ql0423/dsh-screen'), { file: 'https://github.com/ql0423/dsh-screen', params: null })
equal('exe 加参数', splitAppSpec('notepad.exe C:\\tmp\\a.txt'), { file: 'notepad.exe', params: 'C:\\tmp\\a.txt' })
equal('带引号的路径', splitAppSpec('"C:\\Program Files\\App\\app.exe" --flag'), { file: 'C:\\Program Files\\App\\app.exe', params: '--flag' })
equal('空字符串', splitAppSpec(''), null)

console.log(`\n=== ${passed}/${passed + failed} 通过 ===`)
process.exit(failed ? 1 : 0)
