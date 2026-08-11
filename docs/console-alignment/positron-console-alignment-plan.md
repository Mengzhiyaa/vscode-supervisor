# Supervisor Console 对齐 Positron 的实施计划

> 状态：非 Notebook Console 代码与自动化验收已完成；真实 Workbench 中的人工主题截图验收待执行
> 审计与实施日期：2026-08-11
> Supervisor 审计基线：`c315177cba953307b5c4d507ee96b667db4c3900`
> Positron 参考基线：`44d33ff63ad91a5dc6138296be3bc026169c2d24`
> 范围：普通 Console；明确排除 Notebook UI、Notebook Console、Notebook plot preview 和 Notebook session 专属行为

## 1. 目标与完成定义

本计划用于把 `vscode-supervisor` 的普通 Console UI、状态所有权、取消语义、键盘行为、
可访问性、配置声明、RPC contract 和测试覆盖对齐到相邻 `../positron` 仓库的参考实现。

本轮完成定义及结果如下：

1. P0 至 P6 的非 Notebook 实施项已完成；无法严格复制的 Webview 架构差异已记录。
2. Console Playwright 36 项在 CI 同等并发度（2 workers）下全部通过。
3. `check:webview` 为 0 error、0 warning。
4. TypeScript、Webview RPC contract 和公开 API 声明检查全部通过。
5. Console 配置的贡献点、类型、读取、动态更新和测试已闭环。
6. 窄宽度、快捷键、Windows 路径和主题语义已有自动化覆盖。
7. 未引入 Notebook 专属实现或行为。

真实 VS Code Workbench 中的 Dark、Light、High Contrast 人工截图矩阵无法在 headless 环境中完成，
不作为代码完成度的虚假勾选；发布前仍建议执行第 8 节的人工验收。

## 2. 审计方法与风险结论

实施期间同时检查了：

- Supervisor 原有 staged diff、Console UI、extension host provider、RPC、公开 API 和配置代码；
- 相邻 Positron 仓库的普通 Console 实现和测试；
- TypeScript、Svelte、RPC、API 声明、extension unit test 和 Playwright 集成测试；
- code-review-graph 的文件摘要、变更函数、影响半径和测试风险。

初始审计风险分数为 0.60，重点风险是 session 清理、输入命令路由和慢速 completeness
submission。最终实现通过 host-owned submission、类型化增量事件、per-session 输入模型及对应的
unit/Playwright 测试关闭这些风险。最终 code-review-graph 增量审计结果见第 7 节。

## 3. Positron 参考实现索引

| 领域 | Positron 参考 | Supervisor 对应位置 |
| --- | --- | --- |
| Console input 与 type-ahead | [`consoleInput.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/consoleInput.tsx)、[`consoleInputModel.ts`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/consoleInputModel.ts) | [`ConsoleInput.svelte`](../../webview/src/console/ConsoleInput.svelte)、[`sessionModelManager.ts`](../../webview/src/console/services/sessionModelManager.ts) |
| Submission 状态所有权 | [`positronConsoleService.ts`](../../../positron/src/vs/workbench/services/positronConsole/browser/positronConsoleService.ts) | [`consoleInstance.ts`](../../src/services/console/consoleInstance.ts)、[`consoleProvider.ts`](../../src/webview/consoleProvider.ts) |
| Pending/submitting transcript item | [`runtimeItemPendingInput.ts`](../../../positron/src/vs/workbench/services/positronConsole/browser/classes/runtimeItemPendingInput.ts)、[`runtimePendingInput.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/runtimePendingInput.tsx) | [`RuntimePendingInput.svelte`](../../webview/src/console/RuntimePendingInput.svelte)、[`ConsoleCore.svelte`](../../webview/src/console/ConsoleCore.svelte) |
| Startup UI | [`startupStatus.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/startupStatus.tsx) | [`StartupStatus.svelte`](../../webview/src/console/StartupStatus.svelte)、[`runtimeStartup.ts`](../../src/runtime/runtimeStartup.ts) |
| Session tabs | [`consoleTab.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/consoleTab.tsx) | [`ConsoleTab.svelte`](../../webview/src/console/ConsoleTab.svelte)、[`ConsoleTabList.svelte`](../../webview/src/console/ConsoleTabList.svelte) |
| Runtime icon | [`runtimeIcon.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/runtimeIcon.tsx) | [`RuntimeIcon.svelte`](../../webview/src/console/RuntimeIcon.svelte)、[`consoleThemeProvider.ts`](../../src/webview/consoleThemeProvider.ts) |
| Action Bar / Resource Monitor | [`actionBar.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/actionBar.tsx)、[`consoleResourceMonitor.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/consoleResourceMonitor.tsx) | [`ActionBar.svelte`](../../webview/src/console/ActionBar.svelte)、[`ConsoleResourceMonitor.svelte`](../../webview/src/console/ConsoleResourceMonitor.svelte) |
| Find | [`positronConsoleFind.ts`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/positronConsoleFind.ts) | [`ConsoleSearchWidget.svelte`](../../webview/src/console/ConsoleSearchWidget.svelte)、[`consoleSearch.ts`](../../webview/src/console/utils/consoleSearch.ts) |
| Activity Prompt | [`activityPrompt.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/activityPrompt.tsx) | [`ActivityPrompt.svelte`](../../webview/src/console/ActivityPrompt.svelte) |
| CWD / Console Info | [`currentWorkingDirectory.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/currentWorkingDirectory.tsx)、[`consoleInstanceInfoButton.tsx`](../../../positron/src/vs/workbench/contrib/positronConsole/browser/components/consoleInstanceInfoButton.tsx) | [`CurrentWorkingDirectory.svelte`](../../webview/src/console/CurrentWorkingDirectory.svelte)、[`ConsoleInfoButton.svelte`](../../webview/src/console/ConsoleInfoButton.svelte) |
| Splitter/sash | [`verticalSplitter.tsx`](../../../positron/src/vs/base/browser/ui/positronComponents/splitters/verticalSplitter.tsx) | [`VerticalSplitter.svelte`](../../webview/src/console/VerticalSplitter.svelte) |

## 4. 最终完成情况

| 模块 | 状态 | 实际完成内容 |
| --- | --- | --- |
| CSS 高度与实例 Resize | 已完成 | 高度级联、实例 `ResizeObserver`、pane resize、session 切换与滚动锁回归覆盖 |
| Sidebar / Splitter | 已完成 | 60px 最小值、整体宽度 1/5 最大值、`workbench.sashSize` 动态设置、pointer/keyboard resize、ARIA |
| Tab 名称与生命周期 | 已完成 | 实测宽度截断、聚合隐藏/恢复、rename 后重测量、创建时间排序、删除按钮可访问名和完整生命周期测试 |
| Restricted Mode Startup | 已完成 | 类型化 phase、determinate/indeterminate progress、Trust 请求、隐藏路径、有效历史数量保护 |
| Search / Find | 已完成 | 1000 匹配上限、零宽/非法正则、resizable sash、命令、context keys、可重绑定键位和本地化 |
| Theme fallback | 已完成 | 标准 VS Code CSS fallback、语义色验证、file icon theme ID 动态通知 |
| 慢速 submission | 已完成 | Console instance 权威状态、type-ahead、取消、1 秒反馈、transcript placeholder 原位原子替换、history exactly once |
| ActivityPrompt | 已完成 | 普通 prompt 使用单行 Monaco；selection copy、interrupt、paste normalization、undo、context menu；密码仍用安全 input |
| Resource Monitor | 已完成 | 自适应 graph/memory 降级、临界值纯函数测试、实时 ARIA/tooltip、monitor 作用域 context menu |
| Action Bar | 已完成 | restart/interrupt/delete 顺序与图标、紧凑状态、overflow、ARIA 和本地化 |
| CWD | 已完成 | Windows 展示 `/`、复制保留原始路径、ellipsis/min-width、键盘/context menu；保留双击复制扩展 |
| Runtime icon | 已完成（有架构差异） | base64 SVG 优先、language file-icon classes、Seti alignment、主题 ID 动态更新；限制见第 6 节 |
| Typography/settings | 已完成 | scrollback、font size/line height、ligatures、variations、weight、letter spacing、继承和动态更新闭环 |
| Console Info | 已完成 | `runtimeState`、`runtimeDisplayPath`、Positron 风格字段结构、异步 output channels 和本地化 |
| Localization | 已完成 | Action Bar、Find、Tab、Info、CWD、context menu、resource、plot、prompt/startup/restart 等 Console 文案 |

## 5. 分阶段实施记录

### P0：绿色基线与配置/API 闭环

- 历史只在 host 接受执行后添加一次，ArrowUp recall、重复输入与 session 隔离均有覆盖。
- tab delete 增加本地化的 tooltip/`aria-label`，完整 create → switch → destroy → fallback 测试通过。
- Startup phase 测试已按实际状态更新；Restricted Mode 的 progress/path/Trust 行为闭环。
- `supervisor.console.promptWhenIncomplete` 已进入配置贡献、常量、共享类型、provider、RPC 和公开 API。
- Console Svelte 检查为 0 error、0 warning。

主要文件：`package.json`、`src/api.ts`、`src/api.d.ts`、`src/runtime/runtimeStartup.ts`、
`src/webview/consoleProvider.ts`、`webview/src/console/ConsoleTab.svelte`、
`webview/src/console/StartupStatus.svelte`、`webview/test/specs/console.integration.spec.ts`。

### P1：Host-owned submission 与 transcript placeholder

- `ConsoleInstance` 成为 completeness submission 的权威所有者；结果明确区分 executed、incomplete、
  cancelled 和 failed。
- 新增类型化 submit/cancel RPC，并同步 TS contract、JSON contract 和 Playwright harness。
- 提交代码立即成为 transcript 中的 submitting placeholder；接受执行后通过
  `replaceRuntimeItem` 在原索引原子替换为 activity，不跳到 transcript 尾部。
- incomplete/cancel/failure 会按顺序恢复原代码和 type-ahead；同步 throw 也走相同失败恢复路径。
- Cancel 只发送一次 host RPC；本地 JSON-RPC token 使用 `skipHostRequest` 清理，避免重复取消。
- 覆盖二次 Enter、session 切换、慢速反馈、type-ahead、取消、history exactly once 和 placeholder 位置。

主要文件：`src/services/console/consoleInstance.ts`、`src/services/console/classes/runtimeItem.ts`、
`src/rpc/webview/console.ts`、`webview/src/console/ConsoleInput.svelte`、
`webview/src/console/RuntimePendingInput.svelte`、`webview/src/console/SubmittingOverlay.svelte`。

### P2：Startup、Tabs、Resize 与 Runtime icon

- runtime discovery 只用有效数量更新历史，startup snapshot 可在 reconnect 后完整恢复。
- session snapshot 增加 `sessionMode`、`createdTimestamp`、`runtimeState`、`runtimeDisplayPath` 并稳定排序。
- tab 名称在 rename、metadata、字体和宽度变化后重新测量。
- splitter 将可视 divider 与交互 sash 分开，响应 `workbench.sashSize`，支持键盘调整并清理 listener。
- runtime icon 响应 `workbench.iconTheme`，保留 runtime base64 SVG 的最高优先级。

主要文件：`src/webview/sessionSnapshotBuilder.ts`、`src/webview/consoleThemeProvider.ts`、
`webview/src/console/ConsoleTab.svelte`、`webview/src/console/RuntimeIcon.svelte`、
`webview/src/console/VerticalSplitter.svelte`。

### P3：Resource Monitor 与 Action Bar

- 响应式布局纯函数移动到 `src/shared/resourceMonitorLayout.ts`，供 extension unit test 直接覆盖。
- 严格遵循空间不足时先 graph、再 memory 的隐藏顺序；memory 隐藏后 graph 不会重新出现。
- 单独覆盖 91/92、147/148、149/247/248/400 等精确边界。
- graph chip、CPU/MEM tooltip、实时 `role="img"` label 和无数据文案已对齐。
- context menu 仅在 monitor 本体生效，不再覆盖整个 Action Bar。

主要文件：`src/shared/resourceMonitorLayout.ts`、`src/test/unit/resourceMonitorLayout.unit.test.ts`、
`webview/src/console/ConsoleResourceMonitor.svelte`、`webview/src/console/ResourceUsageGraph.svelte`、
`webview/src/console/ActionBar.svelte`。

### P4：Find 命令与搜索行为

- 注册 `supervisor.console.find`、`findNext`、`findPrevious`、`findClose` 四个可重绑定命令。
- 注册 `supervisor.consoleFocused`、`supervisor.consoleFindVisible`、
  `supervisor.consoleFindInputFocused` 三个 context key。
- 补齐 Ctrl/Cmd+F、F3、Shift+F3、Cmd+G、Cmd+Shift+G 和 Escape；输入框 Enter/Shift+Enter
  方向与 Positron 一致。
- 新增 `console/findCommand`、`console/contextKeysChanged` 通知，manifest unit test 校验命令和键位。
- widget sash、999/1000/1001、非法/零宽正则和 session 切换清理均纳入 Playwright。

主要文件：`package.json`、`src/coreCommandIds.ts`、`src/webview/consoleProvider.ts`、
`webview/src/console/ConsoleSearchWidget.svelte`、`webview/src/console/utils/consoleSearch.ts`。

### P5：ActivityPrompt、CWD、Console Info、Typography 与本地化

- 非密码 ActivityPrompt 改用单行 Monaco，并验证 selection copy、不选中时 interrupt、paste、undo；
  密码输入不回显、不写入 history/transcript。
- Windows CWD 显示使用 `/`，键盘复制仍保留原始反斜杠路径。
- Console Info 直接显示 runtime state，路径优先使用 display path，结构精简为 session name、ID、
  state、path、source 和 output channels。
- font/scrollback 设置已贯通 contribution、configuration key、API/RPC 类型、provider、动态监听和 Webview。
- 普通 Console 用户可见文案已迁移到 localization contract。

主要文件：`webview/src/console/ActivityPrompt.svelte`、
`webview/src/console/CurrentWorkingDirectory.svelte`、
`webview/src/console/utils/runtimeDisplayPath.ts`、`webview/src/console/ConsoleInfoButton.svelte`、
`src/webview/webviewLocalization.ts`、`src/webview/consoleSettings.ts`。

### P6：测试与收尾

- extension unit tests：243 passing。
- Console Playwright：36/36 passing（2 workers，与 CI 配置一致）。
- 编译、Svelte、RPC contract、公开 API、Webview build 和 whitespace 检查均已进入最终验证矩阵。
- 自动化覆盖 slow submission、startup、tabs、splitter、resource monitor、Find、ActivityPrompt、CWD、
  theme notification、multi-session、reconnect 和 full-state sync。

## 6. 接受的差异与已知工具告警

### 6.1 Runtime file icon theme

Supervisor Console 运行在隔离 Webview 中，不能直接访问 Workbench 的 file-icon-theme CSS 服务和
glyph resolver。当前实现已经同步 file icon theme ID、language file-icon classes、Seti alignment class
和动态主题变化，并保持 runtime base64 SVG 优先级，但不能保证复制每个 Workbench 主题的私有 glyph。
这是 Webview 架构限制，不是未完成的普通 Console 行为。

### 6.2 CWD 双击复制

Positron 的键盘/context-menu copy 已对齐；Supervisor 原有双击复制作为有意扩展保留。
它不改变展示值、键盘复制值和 context menu 行为。

### 6.3 CSS Custom Highlight build warning

Webview build 可能输出 LightningCSS 对 `::highlight(...)` 的 parser warning。目标 Chromium Webview
支持 CSS Custom Highlight，Playwright 已覆盖 Console Find highlight；该 warning 是 minifier/parser
兼容性提示，不是运行时功能失败。

### 6.4 高并发 Playwright 调度

本地使用默认 28 workers 时，两次全量运行分别出现不同的单项时序超时；对应测试单独运行均通过。
使用仓库 CI 配置的 2 workers 后 36/36 稳定通过。最终验收采用 CI 同等并发度，避免把机器资源争用
误判为产品回归。

## 7. 最终验证结果

| 命令/测试 | 结果 |
| --- | --- |
| `npm run compile` | 通过 |
| `npm run compile-tests` | 通过 |
| `npm run check:webview` | 通过，0 error / 0 warning |
| `npm run verify:webview-rpc-contracts` | 通过 |
| `npm run verify:api-dts` | 通过 |
| `npm run test:unit:ext` | 243 passing；有环境 ENOSPC watcher warning，exit code 0 |
| `npm --prefix webview run build` | 通过；仅有第 6.3 节已记录 warning |
| Console Playwright `--workers=2` | 36 passing |
| `git diff --check` | 通过 |
| code-review-graph 增量审计 | 完成：67 个直接变更文件、144 个变更函数/类，静态风险 0.60；未发现新的阻塞问题 |

图谱报告了 96 个函数级 test gaps，并将 `pruneRemovedSessions`、
`applyCommandToActiveSession`、`executeCodeEditorWidgetCodeIfPossible`、`doExecuteCode` 和 session
snapshot builder 列为优先检查项。`tests_for` 查询无法将 Svelte/Playwright 黑盒测试关联到这些内部函数；
人工对照后，它们分别由 lifecycle/session isolation、pending/history/submission、host execution unit test
和 snapshot builder unit test 覆盖。因此保留 0.60 作为变更面较大的静态风险提示，不将图谱的
函数级关联缺失误记为未执行测试。

最终复验命令：

```bash
export PATH=/home/xyh/miniforge3/envs/codex/bin:$PATH
npm run compile
npm run compile-tests
npm run check:webview
npm run verify:webview-rpc-contracts
npm run verify:api-dts
npm run test:unit:ext
npm --prefix webview run build
npm --prefix webview exec playwright test -- \
  -c test/playwright.config.ts test/specs/console.integration.spec.ts --workers=2
git diff --check
```

## 8. 发布前人工视觉验收矩阵

自动化完成不替代真实 Workbench 的主题和平台截图。发布前建议执行：

| 维度 | 场景 |
| --- | --- |
| 宽度 | 60px sidebar 边界、1/5 最大宽度、窄 Action Bar、宽窗口 |
| Session | 0、1、2、3+；active/inactive；rename；delete；reconnect |
| Runtime state | starting、ready、busy、interrupting、restarting、offline、exited |
| Submission | 快速、超过 1 秒、cancel、incomplete、invalid、RPC failure、type-ahead |
| Theme | Dark、Light、High Contrast、Seti、非 Seti、无 Positron 专属变量 |
| Platform | Windows path、macOS Ctrl+C、Linux/Windows selection Ctrl+C |
| Accessibility | keyboard only、focus ring、accessible name、live region、screen reader |

人工矩阵尚未在当前 headless 环境中执行，因此本文不将其标记为已完成。

## 9. 最终判定

普通 Console 的 P0–P6 代码实施、contract、公开 API 和自动化测试已经完成；Notebook 专属内容保持
排除。剩余事项仅为真实 Workbench 中的人工视觉/辅助技术验收，以及第 6 节已接受的 Webview
file-icon-theme 架构差异。
