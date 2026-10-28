# dsh-screen 🐋

让 DSH 里的智能体**看见你的屏幕、用你的鼠标键盘**——就像一个人坐在这台电脑前一样。

没有悬浮球，没有额外的窗口。命令还是在 DSH 里下，插件只在背后提供眼睛和手。

```
主人：帮我在 Navicat 里建个库
本鱼：screen_look 看一眼 → screen_uia 拿到控件树 → screen_act 点「新建数据库」→ 打字 → 截图给你验收
```

## 它给智能体装了什么

| 工具 | 能力 |
| --- | --- |
| `screen_look` | 截屏（整屏 / 某个窗口 / 一块区域），存成 PNG，同时报告前台窗口和窗口列表，附带图片坐标→屏幕坐标的换算 |
| `screen_windows` | 列出所有可见窗口：标题、窗口类、handle、位置大小、是否最小化 |
| `screen_focus` | 把某个窗口切到前台（最小化的先还原） |
| `screen_uia` | 读窗口的 UI Automation 控件树，或按控件操作：`invoke` 点按钮、`setvalue` 填输入框、`getvalue` 读值、`select` 选中、`focus` 聚焦 |
| `screen_act` | 动手：`click` / `double_click` / `right_click` / `move` / `drag` / `scroll` / `type` / `key` / `hotkey` / `open` / `close` |

两件让它比"盲点坐标"好用的设计：

- **UIA 优先**。控件的名字、类型、坐标都能读出来，点按钮不用猜像素；而且 UIA 不要求窗口在前台。
- **打完自动回看**。`screen_act` 执行完默认再截一张图，智能体能自己确认这一步有没有生效，不用你盯。

手工输入走的是 `KEYEVENTF_UNICODE`，中文直接进去，不依赖输入法；不是模拟键盘敲字那种会被输入法吃掉的方式。

## 安全闸

默认是开着的，三条规矩：

1. **动手前先看**。工作流是「先 `screen_look`，再动手」。`screen_act` 会检查最近一次看屏是不是够新（默认 120 秒内），过期了就先让你重新看一眼——防止智能体对着过时的画面瞎点。
2. **敏感动作要你点头**。启动程序、关闭窗口、`Alt+F4`、`Win` 组合键这类动作会被拦下，智能体必须先说明、等你同意，再带 `confirmed: true` 重调。
3. **一次一动作**。工具是串行的（`isConcurrencySafe: false`），两个动作不会同时抢你的鼠标。

想全放开就把配置里的 `allowRisky` 打开；想让它只能看不能动，就把 `readOnly` 打开。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: dsh-screen
  config:
    readOnly: false       # true = 只能看，不能动
    allowRisky: false     # true = 敏感动作免确认（不建议）
    shotDir: ''           # 截图目录，默认 %TEMP%\dsh-screen\shots
    observeMaxWidth: 1280 # 动作后自动截图的最大宽度
    observeMaxHeight: 900
    typeDelayMs: 0        # 逐字输入间隔；某些老程序要 5~20ms
    requireFreshLookSeconds: 120  # 动手前多久内必须看过屏幕；0 = 不检查
```

## 装

```bash
pnpm add file:<这个目录>       # 在 profiles/web 里
# 或者作为 bundle：把包放进 profiles/web/node_modules/ 并在 cordis.patch.yml 里加一行
```

装完重启 DSH Desktop。日志里看到 `[dsh-screen] ready: 2560x1600, 1 monitor(s)` 就是起来了。

## 要求与边界

- **只支持 Windows**（Win32 + UI Automation）。
- **坐标一律是物理像素**。高 DPI 缩放下本插件会主动声明 per-monitor DPI 感知，图片坐标请用 `imageX`/`imageY` 让插件换算，别自己乘。
- **原生依赖**：`koffi`（FFI，走 npm 预编译二进制，不用编译工具链）。
- **UIA 的盲区**：部分 UWP 窗口（如 Windows 设置）和游戏引擎自绘界面不暴露控件树，这类只能靠截图 + 坐标点击。
- **输入注入的盲区**：全屏独占的游戏、带反作弊或原始输入捕获的程序会吃掉合成事件——这是反作弊的设计，不是 bug。桌面应用、浏览器、Navicat、微信这类都正常。
- **不做的事**：不截图上传、不联网、不记录你的操作内容。图片只写进本机 `shotDir`。

## 实现要点（给想改它的人）

- `src/win32.js` — koffi 直接调 `user32`/`gdi32`/`kernel32`：`BitBlt` 截屏、`PrintWindow` 抓被遮挡的窗口、`SendInput` 注入输入、`EnumWindows` 列窗口。
- `src/png.js` — 零依赖的 PNG 编码器（zlib + CRC32），顺手做盒式降采样，省视觉 token。
- `src/uia.ps1` — UI Automation 的一次性桥，JSON 进 JSON 出，自己声明 DPI 感知。用 PowerShell 是因为 `System.Windows.Automation` 在 .NET Framework 里现成，不需要额外依赖。
- `src/safety.js` — 安全闸。
- `src/tools.js` — 工具表面（模型看到的那一层）。
- `src/index.js` — 插件入口，`inject: ['tools']`，逐个注册、单个失败不影响其余。

## 踩坑记录：改完代码为什么没生效

DSH 的插件加载器按**解析后的模块地址**缓存 ESM 模块。包名式条目（`name: dsh-screen`）解析到 `profile/node_modules/dsh-screen`，这是个跨版本不变的路径——于是改了代码、装了新版本、甚至 disable→enable 重开 fiber，拿到的还是内存里那份旧模块。表现很好认：**报错里提到的参数名，在新代码里已经不存在了**。

想让改动立刻生效，有两条路：

1. **重启 DSH**（最省事，也最稳）。
2. **开发模式**：把条目的 `name` 从包名改成本地文件的绝对地址，地址一变就是一个新模块，不用重启就能热更新：

```yaml
- insert:
    - id: dsh-screen
      name: file:///E:/DeepSeek%20Harness/task-screen/dsh-screen/src/index.js
```

发布时记得改回包名 `dsh-screen`——文件地址绑定的是开发机上的路径，拷给别人就断了。

## 其他踩坑

- 工具参数里的**对象类型必须显式写 `additionalProperties`**，否则注册时抛 `JsonSchemaError: unsupported JSON schema`，整个插件条目不会激活。数组参数同理要注意 `items`。
- `koffi` 的安装脚本会被 pnpm 默认拦掉（`Ignored build scripts`）；官方预编译二进制不需要编译，忽略即可。
- 全屏独占的程序（游戏、带反作弊的客户端）会吃掉合成输入：`SetCursorPos` 被拒、`SendInput` 返回成功但指针不动。这是对方的设计，不是 bug——桌面应用、浏览器、Navicat、微信这类都正常。
- **切前台会被系统拒绝**：`SetForegroundWindow` 只在调用方本来就在前台时生效。插件里的 `focusWindow` 用「线程挂接 + ALT 解锁」闯过去，并且**切不成功就不点击**——宁可这一下不发，也不点到别的窗口上去。代价是：目标窗口刚起动、或别的程序正在抢焦点时，可能要先手动点一下再让插件接着干。
- **先激活、再动作**：一个不在前台的窗口，第一下点击往往只吃到「激活窗口」，第二下才落到控件上。
- **窗口单拍有坐标偏移**：`PrintWindow` 的图比 `GetWindowRect` 少一圈隐形边框（150% 缩放下约 20 像素），照它换算会点到偏上的位置。需要精确点击时，用整屏截图算坐标（整屏 2560x1600 按 2 倍缩放最省事），或直接用 UIA 报的物理坐标。

MIT。