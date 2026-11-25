// End-to-end smoke test against a real Notepad window.
//
// Covers the things that were just changed:
//   1. type → newline becomes a real Enter (two lines, not one)
//   2. requireFreshLookSeconds <= 0 really disables the freshness check
//   3. open → confirmed by a NEW window, not by ShellExecute's return code
//   4. close → confirmed the window is gone
//   5. capture:'none' still leaves a screenshot when a batch FAILS
//   6. UIA text action reads what is actually written
//   7. clipboard set/get round-trip
//
// Run: node test/smoke.mjs
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools } from '../src/tools.js'
import { stopUiaWorker } from '../src/uia.js'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  —  ${detail}` : ''}`)
}

const config = {
  readOnly: false,
  allowRisky: true, // open/close are the point of this test; no one is at the keyboard
  shotDir: join(tmpdir(), 'dsh-screen-smoke'),
  observeMaxWidth: 800,
  observeMaxHeight: 600,
  typeDelayMs: 0,
  requireFreshLookSeconds: 0, // ← bug #2: zero must mean "no check"
  settleMs: 150,
  maxSequenceSteps: 24,
  uiaMinControls: 3,
  overlay: false,
  overlayIdleMs: 800,
  cancelOnEsc: false,
}

const tools = Object.fromEntries(createTools({}, config).map(t => [t.name, t]))
const call = (name, args = {}) => tools[name].execute(args, {})

const MARK = `smoke${Date.now()}`

/** Close Notepads left behind by an earlier run (only ones that are clearly ours). */
async function sweepOldNotepads() {
  const listing = await call('screen_windows')
  const mine = listing.split('\n')
    .filter(line => /handle=\d+/.test(line) && /Notepad/i.test(line))
    .filter(line => /smoke|无标题|Untitled/i.test(line))
  for (const line of mine) {
    const handle = line.match(/handle=(\d+)/)?.[1]
    if (handle) {
      try { await call('screen_act', { action: 'close', window: handle, observe: false }) } catch { /* gone */ }
    }
  }
  return mine.length
}

try {
  const swept = await sweepOldNotepads()
  if (swept) console.log(`（顺手关掉 ${swept} 个上次测试留下的记事本）`)

  // ---- 7. clipboard round-trip
  const sample = `${MARK}-clip\n第二行`
  await call('screen_clipboard', { action: 'set', text: sample })
  const got = await call('screen_clipboard', { action: 'get' })
  check('剪贴板 set/get 往返', got.includes(sample), `读出 ${got.length} 字符`)

  // ---- 2. freshness check disabled by 0
  const typedWithoutLook = await call('screen_act', { action: 'key', key: 'shift', observe: false })
  check('requireFreshLookSeconds=0 真的不拦', !typedWithoutLook.includes('先看一眼再动手'), typedWithoutLook.split('\n')[0].slice(0, 50))

  // ---- 3. open is confirmed by a window existing
  const openText = await call('screen_act', { action: 'open', app: 'notepad.exe', observe: false })
  check('open 确认到新窗口', /确认到新窗口/.test(openText), openText.split('\n')[0].slice(0, 100))
  const opened = Number(openText.match(/handle=(\d+)/)?.[1] ?? 0)

  // ---- wait for the window (new tool), addressed by title only for discovery
  const waitText = await call('screen_wait', { kind: 'window', window: 'Notepad', timeoutMs: 6000 })
  check('screen_wait 等到窗口', waitText.startsWith('等到了'), waitText.slice(0, 70))

  // Everything below is addressed by handle, never by title: two Notepads may exist.
  const win = String(opened)
  const focusText = await call('screen_focus', { window: win })
  check('前台切到我们开的那个记事本', /已切到前台/.test(focusText), focusText.split('\n')[0].slice(0, 60))

  const body = `${MARK}\n第二行`
  const typeText = await call('screen_act', { action: 'type', text: body, observe: false })
  check('type 执行没报错', !/拦下|Error/.test(typeText), typeText.split('\n')[0].slice(0, 50))

  // ---- 6. read the text back through UIA, by handle
  let uiaRead = ''
  try {
    uiaRead = await call('screen_uia', { action: 'text', window: win })
  } catch (error) {
    uiaRead = `读取失败：${error.message}`
  }
  const uiaOk = uiaRead.includes(MARK) && uiaRead.includes('第二行')
  check('screen_uia text 读到正文', uiaOk, uiaOk ? '两个标记都在' : uiaRead.slice(0, 100))

  // ---- 1. the newline became a real line break
  await call('screen_act', { action: 'hotkey', keys: 'ctrl+a', observe: false })
  await call('screen_act', { action: 'hotkey', keys: 'ctrl+c', observe: false })
  const pasted = await call('screen_clipboard', { action: 'get' })
  const split = new RegExp(`${MARK}\\r?\\n第二行`)
  check('type 里的 \\n 变成了真的回车', split.test(pasted), JSON.stringify(pasted.split('\n').slice(-2).join('|')).slice(0, 90))

  // ---- 5. a failing batch with capture:'none' must still leave evidence
  const seqText = await call('screen_sequence', {
    capture: 'none',
    window: win,
    steps: [{ action: 'click', control: '9/9/9' }],
  })
  check("失败批次即使 capture:'none' 也补一张图", /已经重新截了|逐像素一样|图像|截图/.test(seqText), seqText.split('\n').slice(0, 2).join(' | ').slice(0, 90))

  // ---- 8. status tool
  const statusText = await call('screen_status')
  check('screen_status 报出时效与权限', /观察时效/.test(statusText) && /权限/.test(statusText), (statusText.split('\n')[2] ?? '').slice(0, 60))

  // ---- 4. close is confirmed
  const closeText = await call('screen_act', { action: 'close', window: win, observe: false })
  check('close 确认窗口消失', /确认窗口消失/.test(closeText), closeText.split('\n')[0].slice(0, 100))
} catch (error) {
  check('测试本身跑完', false, error?.stack ?? String(error))
} finally {
  await sweepOldNotepads()
}

console.log('\n=== 汇总 ===')
const failed = results.filter(r => !r.ok)
console.log(`${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`)
}

// The warm UIA worker keeps the event loop alive on purpose inside the host; a test run
// has to let go of it explicitly or node never exits.
stopUiaWorker()
process.exit(failed.length ? 1 : 0)
