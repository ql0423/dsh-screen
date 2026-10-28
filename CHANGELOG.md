# 更新记录

## 0.2.2 — 2026-10-28

- `screen_look` 的说明里补上「窗口单拍有坐标偏移」的提醒：`PrintWindow` 的图比窗口矩形少一圈隐形边框，精确点击请用整屏截图或 UIA 报的物理坐标
- README 补三条实战坑：切前台被拒、先激活再动作、窗口单拍偏移
- 新增 `NOTES.md`（设计取舍与维护备忘）、`.gitignore`
- `cordis.patch.yml` 改回发布形态（包名），把 `file://` 开发模式写成注释

## 0.2.1 — 2026-10-28

- **切前台改为「先切、后验、再动手」**：`focusWindow` 用线程挂接 + ALT 解锁闯过前台锁，返回前复核前台窗口是不是目标
- `screen_act` 在切换失败时**直接返回、一个点击都不发**，并把当前前台窗口告诉智能体
- `screen_focus` 的回报里带上「已核实是它本人」

这一版修的是一个真实事故：切前台静默失败，可点击照样发了出去，落在别的窗口上。

## 0.2.0 — 2026-10-28

- 五个工具稳定：`screen_look` / `screen_windows` / `screen_focus` / `screen_uia` / `screen_act`
- 安全闸：`requireFreshLookSeconds` 强制「先看再动手」；`open` / `close` / `Alt+F4` / `Win` 组合键必须 `confirmed: true`
- `screen_act` 动作后自动补一张截图
- 零依赖 PNG 编码器 + 盒式降采样

## 0.1.x — 2026-10-28

起步版本。踩了两个坑，都记在 README 里了：

- 工具参数和输出里的每个 `type: 'object'` 都必须显式写 `additionalProperties`，否则注册时抛 `JsonSchemaError`，整个插件条目不激活；
- 加载器按解析后的模块地址缓存 ESM，包名恒等于同一路径——改完代码、装了新版本，拿到的还是内存里那份旧模块。表现为「报错里提到的参数名，在新代码里已经不存在了」。