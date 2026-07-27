# Data Explorer：Supervisor、Positron 与 Ark 的 UI / 交互差异分析

## 1. 分析范围与结论

本文以当前工作区中的三个实现为准：

- Supervisor：`vscode-supervisor/webview/src/dataExplorer` 与
  `vscode-supervisor/src/services/dataExplorer`
- Positron：`positron/src/vs/workbench/browser/positronDataExplorer` 与
  `positron/src/vs/workbench/services/positronDataExplorer`
- Ark：`ark/crates/amalthea/src/comm/data_explorer_comm.rs` 与
  `ark/crates/ark/src/data_explorer/r_data_explorer.rs`

最明显的视觉差异并不是颜色微调造成的，而是 Supervisor 打开 Data Explorer
后多渲染了一层 28px 高的旧 `ActionBar`。Positron 仓库虽然仍保留
`components/actionBar/actionBar.tsx`，但当前实际入口
`positronDataExplorer.tsx` 并没有渲染它；相关操作由 Workbench 编辑器标题栏提供。

后端交互方面，Supervisor 的 Ark comm 方法名和参数名已经与当前生成协议基本一致。
主要问题在 comm 之上的状态协调：

1. 连续添加、更新或删除过滤器时，旧实现会在进入串行队列前读取
   `backendState.row_filters`，导致快速操作从同一个旧状态派生并互相覆盖。
2. `updateBackendState()` 虽然更新了 Host 模型，但 Webview Bridge 没有订阅模型的
   `onDidUpdateBackendState`，因此行数、过滤器有效性、排序键和状态栏可能继续显示旧值。
3. 数据失效通知在 Ark 完成 mutation 前发出，Webview 可能用新 generation 请求到旧视图。
4. 状态栏只反映显式前台操作，不反映普通 `get_data_values`、`get_schema` 和
   `get_column_profiles` Ark 请求。

本轮已经修正上述问题，并同步当前 Positron 的关键布局和网格参数。

## 2. 实际承载架构差异

| 层次 | Positron | Supervisor | 影响 |
| --- | --- | --- | --- |
| Workbench 集成 | 内置 `EditorPane`、React、原生服务注入 | VS Code Custom Editor / Webview、Svelte、JSON-RPC Bridge | 无法逐字复用 React 组件和内部 Workbench 服务 |
| 顶层操作 | `MenuId.EditorTitle`、`EditorActionsLeft` | `contributes.menus.editor/title` | Supervisor 只能对齐可见动作和上下文，不能使用 Positron 私有 ActionBar API |
| Grid | 原生 `PositronDataGrid` React 实例 | Svelte port | DOM、焦点和测量时序必须单独对齐 |
| Data Explorer client | UI 直接持有 `DataExplorerClientInstance` | Webview → Host Bridge → Host model → client | Supervisor 需要额外的 generation、可见性和跨进程状态同步 |
| Backend | `IDataExplorerBackendClient`，可来自 Runtime 或 DuckDB | Ark runtime comm 或扩展内 DuckDB backend | 文件导入能力不能全部归因于 Ark |

这类承载差异不会完全消失；对齐目标是可见布局、交互语义、请求顺序和最终状态一致。

## 3. UI 差异与对齐

### 3.1 顶层渲染树

Positron 当前入口的实际结构是：

```text
PositronDataExplorer
└── DataExplorerPanel
    ├── RowFilterBar
    ├── DataExplorer
    │   ├── SummaryRowActionBar
    │   ├── Summary DataGrid
    │   ├── VerticalSplitter
    │   └── Table DataGrid
    └── StatusBar
```

Supervisor 修改前是：

```text
PositronDataExplorer
├── ActionBar                  ← Positron 当前入口没有这一层
├── Progress / Error / Warning overlays
└── DataExplorerPanel
```

具体差异：

- 多余 `ActionBar` 占用 28px，导致过滤器栏、表头和摘要整体下移。
- 它重复提供 Summary 布局、清除排序、打开表格和移动窗口等动作。
- Positron 的错误通过 Workbench notification service 呈现，而不是覆盖在数据表上。
- Positron 没有“大列数警告”浮层；能力按钮直接依据
  `MAX_ADVANCED_LAYOUT_ENTRY_COUNT` 禁用。

对齐结果：

- 删除 Webview 内部顶层 `ActionBar` 及其未使用组件。
- 根元素恢复为占满编辑器的单层容器。
- 错误由 VS Code notification 呈现，同时保留不可见的 ARIA live region。
- 加载状态由底部 Activity Indicator 和 ARIA 状态表达，不再显示额外顶部进度条。
- “Move into New Window”不再作为额外 editor-title 按钮出现，命令仍保留在命令面板。

### 3.2 编辑器标题动作

| 动作 | Positron | 修改前 Supervisor | 对齐后 |
| --- | --- | --- | --- |
| Summary on Left / Right | Editor title toggle | Editor title + Webview ActionBar | Editor title |
| Clear Column Sorting | Editor title，未排序时禁用 | Editor title + Webview ActionBar | Editor title |
| Convert to Code | Editor title | Editor title | 保持 |
| Open as Plain Text | CSV/TSV editor title | Editor title | 保持 |
| Open as Spreadsheet | 本地桌面 `.xlsx` editor title | 仅 Webview ActionBar | 新增 editor-title 命令和 XLSX context |
| File Options | 支持的文件数据源 | Editor title | 保持 |
| Move into New Window | Workbench 通用能力 | Supervisor 专用可见按钮 | 从 title 移除，命令面板保留 |

`Open as Spreadsheet` 只在桌面、本地、XLSX 数据源中显示，条件与 Positron 一致：

```text
dataExplorer active
AND is XLSX
AND NOT web
AND remoteName == ''
```

### 3.3 Summary 折叠生命周期

修改前 Supervisor 在 Summary 折叠时通过 Svelte `{#if}` 卸载 Summary Grid。
Positron 始终保留左右两个 Grid，只把 Summary 列宽设置为 0，并通过
`setVisible(false)` 暂停高成本请求。

卸载会带来以下差异：

- 展开时重新创建 DOM，焦点和滚动位置丢失。
- profile cell、hover 和键盘状态被重置。
- 折叠/展开期间更容易重复触发 schema/profile 请求。

对齐后 Summary Grid 始终挂载，折叠仅控制宽度与可见性。

### 3.4 DataGrid 几何参数

| 参数 | 修改前 Supervisor | 当前 Positron | 对齐后 |
| --- | ---: | ---: | ---: |
| `defaultColumnWidth` | 120 | 200 | 200 |
| `minimumColumnWidth` | 50 | 80 | 80 |
| `maximumColumnWidth` | 500 | 800 | 800 |
| `scrollbarOverscroll` | 50 | 14 | 14 |
| `horizontalCellPadding` | 8 | 7 | 7 |
| `cursorOffset` | 1 | 0.5 | 0.5 |
| Summary `internalCursor` | `true` | `false` | `false` |
| 大直方图 bin 数 | 100 | 200 | 200 |

这些参数会直接影响首次打开时的列密度、滚动尾部空白、选择框位置和展开 profile
的图形细节，属于肉眼可见差异。

### 3.5 行号与行标签

当 backend 的 `has_row_labels` 为 `false` 时：

- Positron `TableDataCache.getRowLabel(rowIndex)` 返回零基字符串 `${rowIndex}`。
- Supervisor 修改前回退到通用 Grid 的 `${rowIndex + 1}`。

现已按 Positron 改为零基行号。有真实 row labels 时，仍通过 Ark
`get_row_labels` 获取，缺页位置显示 `...`。

### 3.6 Grid 焦点与 ARIA

Supervisor 修改前同时给外层 `.data-grid` 和内层 `.data-grid-waffle`
设置 `role="grid"` 与 `tabindex`，形成嵌套 grid 和两个 Tab 停靠点。
Positron 外层只负责尺寸和 context，实际焦点落在 waffle。

对齐后：

- 外层只负责 ResizeObserver 和 Grid context。
- `role="grid"`、`tabindex="0"` 和键盘处理集中在 waffle。
- Copy 键盘处理移入 waffle，保留 `Ctrl/Cmd+C` 行为。
- 恢复焦点时直接定位 table waffle。

### 3.7 主题变量

Positron 的 `positronDataGrid.*` 和 `positronDataExplorer.*` 颜色在 Workbench
内部注册；标准 VS Code 不认识这些私有 color ID。此前多处 CSS 变量没有 fallback，
会造成边框透明、filter 背景缺失、排序序号颜色不正确。

Supervisor 现在在 Webview 根样式中补齐：

- Grid background / foreground / border / cursor / sort index
- Data Explorer background / foreground / border / invalid filter background
- light / dark / high-contrast 的 selection 和 contrast 派生值

其中依赖主题背景明暗运算的值使用 CSS `color-mix()`，避免写死某个 VS Code 默认主题。

## 4. Ark 协议逐项比对

### 4.1 请求名称和参数键

| 请求 | Supervisor comm 参数键 | Ark 生成协议 | 结论 |
| --- | --- | --- | --- |
| `get_state` | 无 | 无 | 一致 |
| `get_schema` | `column_indices` | `column_indices` | 一致 |
| `search_schema` | `filters`, `sort_order` | 同左 | 一致 |
| `get_data_values` | `columns`, `format_options` | 同左 | 一致 |
| `get_row_labels` | `selection`, `format_options` | 同左 | 一致 |
| `export_data_selection` | `selection`, `format` | 同左 | 一致 |
| `convert_to_code` | `column_filters`, `row_filters`, `sort_keys`, `code_syntax_name` | 同左 | 一致 |
| `suggest_code_syntax` | 无 | 无 | 一致 |
| `set_column_filters` | `filters` | `filters` | 协议一致；Ark R backend 当前声明 unsupported |
| `set_row_filters` | `filters` | `filters` | 一致 |
| `set_sort_columns` | `sort_keys` | `sort_keys` | 一致 |
| `get_column_profiles` | `callback_id`, `profiles`, `format_options` | 同左 | 一致 |
| `set_dataset_import_options` | `options` | `options` | 协议一致；主要由 DuckDB 文件 backend 实现 |
| `open_data_explorer` | 无 | 无 | 一致 |

Ark 生成协议还包含 `open_dataset`，但 Ark R backend 当前明确返回
“Not yet supported”。Supervisor 文件打开路径由扩展内 DuckDB backend 处理，
不应为了表面方法数量一致而把文件打开错误地路由给 Ark。

### 4.2 事件

| 事件 | 用途 | Supervisor |
| --- | --- | --- |
| `schema_update` | R 对象列结构变化 | 刷新 `get_state`，清 schema/data/profile cache |
| `data_update` | 行或值变化但 schema 未变 | 刷新 `get_state`，清 data/profile cache |
| `return_column_profiles` | 异步 profile callback | 按 `callback_id` 完成 Promise，支持超时、取消和 `error_message` |

显式 `set_row_filters` 和 `set_sort_columns` 在当前 Ark 实现中只返回 RPC reply，
不会额外发送 `data_update`。因此 Supervisor 在 mutation 成功后主动失效缓存是必要逻辑，
不是对 Ark 事件的重复实现。

### 4.3 过滤 mutation 的正确顺序

修改前：

```text
读取 cached row_filters
→ 进入 mutation queue
→ 立即通知 Webview data invalidated
→ set_row_filters(由旧状态计算的新数组)
→ get_state
```

两个快速 Add 操作可能变成：

```text
Add A: [] + A → [A]
Add B: [] + B → [B]
最终 A 被覆盖
```

对齐后：

```text
进入 mutation queue
→ 在队列内部读取最新 cached row_filters
→ set_row_filters
→ get_state
→ 向 Webview 发布最新 BackendState
→ mutation 完成后发布 data invalidation
```

快速 Add A / Add B 现在依次产生 `[A]`、`[A, B]`。Update、Remove 和 Clear
使用同一个 `_mutateRowFilters` 路径。

### 4.4 BackendState 回传

Positron 的 Grid 和状态栏直接订阅 `DataExplorerClientInstance.onDidUpdateBackendState`。
Supervisor 多一层 Webview Bridge，因此必须显式转发。

对齐后 Bridge 在每次 `get_state` 完成时发送 `dataExplorer/backendState`，Webview 会同步：

- 过滤后的 `table_shape.num_rows`
- `table_unfiltered_shape`
- `row_filters[].is_valid` 与 `error_message`
- `sort_keys`
- `supported_features`
- `connected` / `error_message`
- DuckDB 文件选项和窗口状态扩展字段

这也保证编辑器标题命令的 context keys 与实际 Ark 状态同步。

### 4.5 请求状态与缓存失效

Positron 的 Activity Indicator 监听 client 的全部 pending task。
Supervisor 以前只监听 `runWithForegroundLoading`。

对齐后 Host model 合并两类状态：

```text
loading = foregroundLoadingCount > 0
          OR client.status == Computing
```

因此 schema、viewport data、row labels、profiles、export、filter 和 sort 请求都会反映在
底部状态指示器中。

mutation 的 data invalidation 改为在 Ark 请求和随后的 `get_state` 完成后发布。
旧 generation 的在途响应仍由 `requestId + generation + surfaceVisible` 三重条件丢弃。

## 5. Profile 与大数据量行为

- viewport data 只请求可见行列，Host 和 Webview 都带 generation。
- schema 在 Host 按绝对列索引缓存。
- profile 请求按 8 列分块，与当前 Positron 一致。
- large histogram 使用 200 bins；small histogram 仍为 80 bins。
- profile callback 有 60 秒超时和 cancellation token。
- Webview 折叠 Summary 后保留实例但停止 profile 请求，展开后恢复。
- 超大列数数据集不显示额外浮层，而是在能力判断处禁用高级排序、过滤和概要操作。

## 6. 仍然保留的合理差异

1. **React 与 Svelte**：组件状态和 DOM 细节不同，但布局与操作语义已对齐。
2. **Workbench 内部菜单与扩展菜单**：标准 VS Code 扩展无法贡献
   `MenuId.EditorActionsLeft`，只能使用 editor title 和 command palette。
3. **Host Bridge**：Supervisor 必须保留 JSON-RPC、generation 和可见性检查；
   Positron 内置实现不需要这层跨 Webview 协调。
4. **DuckDB 文件能力**：XLSX/CSV/Parquet 的打开和导入选项由 Supervisor
   的扩展内 backend 处理，当前 Ark R Data Explorer 不提供 `open_dataset`。
5. **错误通知实现**：Positron 使用内部 `INotificationService`，Supervisor 使用
   `vscode.window.showErrorMessage`，可见行为一致但调用层不同。

## 7. 回归验证点

新增或强化的测试覆盖：

- mutation 严格串行，generation 按实际执行完成顺序更新；
- 两个快速 Add Filter 不再互相覆盖；
- XLSX “Open as Spreadsheet” 命令已贡献；
- Webview TypeScript / Svelte 静态检查；
- 现有大表按页、profile 分块、generation 丢弃旧响应、断线状态和文件动作测试。
