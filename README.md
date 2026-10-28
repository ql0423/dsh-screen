# dsh-screen 🐋

让 DSH 里的智能体**看见你的屏幕、用你的鼠标键盘**——就像一个人坐在这台电脑前一样。

没有悬浮球，没有额外的窗口。命令还是在 DSH 里下，插件只在背后提供眼睛和手。

```
主人：帮我在 Navicat 里建个库
本鱼：screen_look 看一眼 → screen_uia 拿到控件树 → screen_sequence 一气跑完「点新建 → 填名字 → 确定」→ 一张截图给你验收
```

## 它给智能体装了什么

| 工具 | 能力 |
| --- | --- |
| `screen_look` | 看一眼。默认 `mode=auto`：**先读 UIA 控件清单，够用就不截图**；不够用才截图（整屏 / 某个窗口 / 一块区域），附带图片坐标→屏幕坐标的换算 |
| `screen_windows` | 列出所有可见窗口：标题、窗口类、handle、位置大小、是否最小化 |
| `screen_focus` | 把某个窗口切到前台（最小化的先还原） |
| `screen_uia` | 读窗口的 UI Automation 控件树，或按控件操作：`rect` 量单个控件位置、`invoke` 点按钮、`setvalue` 填输入框、`getvalue` 读值、`select` 选中、`focus` 聚焦 |
| `screen_act` | 动手：`click` / `double_click` / `right_click` / `move` / `drag` / `scroll` / `type` / `key` / `hotkey` / `open` / `close`。可以用 `control` 直接指名某个控件 |
| `screen_sequence` | **一串动作一次调用跑完**（最多 24 步）：整批先过安全闸、失败即停并报出第几步、收尾只截一张图 |

三件让它比"盲点坐标"好用的设计：

- **两套眼睛，自动选**。有 UIA 的程序读控件清单（名字、类型、中心坐标、该怎么操作），**一张图都不用拍**；没有 UIA 的程序老老实实截图。判据是可操作控件的数量，不够就退回截图，并把原因写在返回里。
- **按控件说话，不按像素说话**。`control: "0/2/1"` 指的是那个控件本身——动手那一刻才去量它的位置，所以列表滚动、窗口挪位都骗不到它；输入框有 Value 模式就直接赋值（不碰键盘），按钮有 Invoke 模式就直接触发（不动鼠标、也不管前台是谁）。
- **打完自动回看**。`screen_act` 执行完默认再截一张图（先等画面重绘），智能体能自己确认这一步有没有生效，不用你盯。
- **同样的画面不重复存**。截出来的像素和上一张逐像素一样时，直接说"没变"，不写新文件、不占你的注意力。

手工输入走的是 `KEYEVENTF_UNICODE`，中文直接进去，不依赖输入法；不是模拟键盘敲字那种会被输入法吃掉的方式。

## 快在哪

桌面自动化慢，从来不是鼠标点得不够快，而是**模型和电脑之间来回说了太多次话**，以及每一步背后藏着一个要启动几百毫秒的进程。这一版把两头都削了：

| 环节 | 之前 | 现在 | 怎么做到的 |
| --- | --- | --- | --- |
| 一次点击 | 0.4 ms | 0.4 ms | koffi 直接调 SendInput，进程内，不走脚本 |
| 读 UIA 控件树 | ~440 ms | **31–38 ms** | 常驻 worker：PowerShell 只启一次，UIA 程序集一直加载着 |
| 五步操作 | 5 次调用 + 5 张截图 | **1 次调用 + 1 张截图** | `screen_sequence` 批处理 |
| 画面没变时 | 每次重存一张 PNG | 直接复用上一张 | 帧指纹（sha1）比对 |
| 动作后立刻截图 | 可能拍到重绘前的旧画面 | 先等 180 ms 再拍 | `settleMs`（可配、可关） |

实测（本机 2560×1600，Windows PowerShell 5.1）：`screen_look` 129 ms、整屏截图降采样 100 ms、`screen_sequence` 10 步 1 ms。第一次读 UIA 仍要付一次 ~400 ms 的 worker 启动费，之后一直是几十毫秒；worker 闲置 5 分钟自动退出，不留后台进程。

## 两套眼睛怎么选

`screen_look` 默认 `mode=auto`，顺序是固定的：**先问 UIA，不够才截图**。

```text
没截图——「记事本」的 UIA 够用：6 个可操作控件，照这张清单直接干活
  (443,221)  0/2/1       Button       "新建"                        [invoke]
  (500,300)  0/2/3       Edit         ""                            [fill]  [value:"草稿"]
  (455,332)  0/2/4       CheckBox     "自动换行"                    [toggle]  [toggle:Off]
```

- 每个控件给三样东西：**中心坐标**（物理像素，能直接喂 `screen_act` 的 `x/y`）、**路径**（能当 `control:` 用）、**该怎么操作**（`invoke` 点按钮 / `fill` 填字 / `toggle` 开关 / `select` 选中 / `expand` 展开 / `scroll` 滚动）。
- 顺便带上会改变判断的状态：输入框里已有内容、复选框开没开、是不是密码框、只读没只读。
- 可操作控件少于 `uiaMinControls`（默认 3）就退回截图，并在返回里**说明为什么**——"UIA 只给出 0 个可操作控件"。

只读不动的路径也快：`screen_uia action=rect` 只量一个控件，不用整棵树。

**诚实的边界**（本机 2026-10-28 实测，2560×1600）：

| 场景 | UIA 读到的可操作控件 | 走哪条路 |
| --- | --- | --- |
| 开始菜单（打开时） | 21 个（List / ListItem / Button） | 文字清单，不截图 |
| 经典 Win32 对话框、WPF、UWP | 通常够用 | 文字清单 |
| Edge / Electron 页面 | 0–1 个（Chromium 的无障碍要单独开） | 截图 |
| 自绘界面、游戏 | 0 个 | 截图 |
| 被别的窗口完全挡住的窗口 | 节点在，全报 offscreen | 截图，并提示"先切前台" |

也就是说：**这不是"UIA 一定更快"，而是"有 UIA 就别浪费截图，没有就别硬等它"**。这台机器上大部分窗口其实属于后者，所以两条路都得留着。

## 它正在动手的时候，你看得见

插件动手时前台往往被切到别的窗口，DSH 里的进度就看不见了——人分不清是"它还在干"还是"它早干完了"。所以默认会有一条状态：

```text
                     ●  DSH 正在操作你的电脑　第 2/3 步
```

- 屏幕顶部居中的一小条，**不抢焦点、点击穿透**、不进 Alt+Tab，也不挡任何界面；
- 动作一发生就亮，最后一次动作后停 1.6 秒再消失（`overlayIdleMs` 可调）；一串动作只亮一条，不闪；
- 批量执行时带上进度（第几步 / 共几步），单步动作只有那句"正在操作"；
- 不想要就把 `overlay` 设成 `false`，插件连那个进程都不会起。

它住在一个独立的 PowerShell 进程里（宿主没有自己的窗口可画），所以插件启动时会先把它热好——否则第一次动作的状态条要晚一两秒才出现，等于没有。闲置 10 分钟自动退出。

### Esc 取消：选用

有人喜欢多一道保险，有人觉得多余。所以它是**单独一项配置，默认关**：

```yaml
cancelOnEsc: true     # 打开后，按 Esc 可以中断正在跑的动作/批次
```

打开后状态条上会多写一句"按 Esc 取消"。按下 Esc 时：

- 批次在**下一步开始前**停下，已经发出去的那一步不会回滚（鼠标已经点过了，撤销是另一回事），并报出还剩几步没发；
- 单个动作在发出之前被拦下；
- 插件自己按的 Esc（比如帮你去关一个对话框）不算，不会误触。

理由说清楚：敏感动作本来就要你点头（见下一节），所以这道 Esc 是**锦上添花，不是最后一道防线**。

## 安全闸

默认是开着的，四条规矩：

1. **动手前先看**。工作流是「先 `screen_look`，再动手」。`screen_act` 会检查最近一次看屏是不是够新（默认 120 秒内），过期了就先让你重新看一眼——防止智能体对着过时的画面瞎点。
2. **敏感动作要你点头**。启动程序、关闭窗口、`Alt+F4`、`Win` 组合键这类动作会被拦下，智能体必须先说明、等你同意，再带 `confirmed: true` 重调。
3. **一批里有一处要点头，整批都不动**。`screen_sequence` 会在碰桌面之前把每一步都先验一遍，被拦下的步全部列出来，一步都不会偷偷执行。
4. **一次一动作**。工具是串行的（`isConcurrencySafe: false`），两个动作不会同时抢你的鼠标。

切不到前台就不发那一手，也是这条线的一部分：`screen_act` 带 `window` 时会核实前台真的换过去了，没换过去就一个点击都不发，并告诉你前台还留在哪个窗口——这比点到别人窗口上强。

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
    settleMs: 180         # 动作后等画面重绘多久再截图；0 = 立刻拍
    maxSequenceSteps: 24  # screen_sequence 一批最多几步
    uiaMinControls: 3     # screen_look 的 auto 模式里，UIA 至少给出几个可操作控件才不截图
    overlay: true         # 动手时在屏幕顶部显示「DSH 正在操作你的电脑」
    overlayIdleMs: 1600   # 最后一次动作后状态条再停留多久
    cancelOnEsc: false    # true = 按 Esc 可中断动作/批次（选用）
```

不想用常驻 UIA worker（比如企业环境不允许长驻进程），设环境变量 `DSH_SCREEN_UIA_WORKER=0`，会退回"每次新起一个 PowerShell"的老路子——功能一样，慢约 400 毫秒。

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