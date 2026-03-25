# Supervisor / Ark Positron Session Alignment Gaps

本文档记录当前 `vscode-supervisor` 与 `vscode-ark` 在 runtime startup / session management 链路上，相对 `positron` 仍未完全对齐的部分。状态已更新到当前实现。

## 已完成的主要对齐

- `vscode-supervisor` 公开 API 现在已经不只是“外壳对齐”:
  - `IUiClientInstance` 已提供最小稳定能力:
    - `onDidWorkingDirectory`
    - `didChangePlotsRenderSettings()`
    - `callMethod()`
  - `ISupervisorFrameworkApi` 已补齐:
    - `startRuntime()`
    - `createSession()`
    - `restoreSession()`
    - `validateSession()`
- `RuntimeSessionService` 已支持:
  - 外部 `registerSessionManager()` 优先于默认 local manager
  - persisted session restore 的进行中状态
  - `restorePersistedSessionsInBackground()`
  - `waitForPersistedSessionRestore()`
- `RuntimeStartupService` 已补齐:
  - architecture mismatch 告警 dismissal/reset 生命周期
  - persisted session restore 状态与 startup restore 链路联动
  - `registerNewFolderInitTask()` 真实 startup barrier
- `PositronConsoleService` / console webview 现在已补齐一条更接近 Positron 的 restored placeholder 链:
  - 会基于 `getRestoredSessions()` 预创建 provisional console instance
  - restored console state 会在 live reconnect 前先恢复到前端
  - restore failure 会回写到 provisional console，而不只是写日志
- `RuntimeManager.recommendWorkspaceRuntimes()` 已不再只依赖“已发现安装”，现在会回退到 `resolveInitialInstallation()`。
- `RuntimeManager` 现在也开始承担更接近 Positron 的共享 runtime registry 角色:
  - `registerExternalDiscoveryManager()`
  - `registerDiscoveredRuntime()`
- `vscode-ark` 已经:
  - 注册 `RRuntimeManager`
  - 注册 `RRuntimeStartupManager`
  - 接管 R 的 `create / validate / restore / validateMetadata`
  - 把 `startConsole` 改成显式 `startRuntime()` 语义
  - 开始实质性消费 `watchUiClient()`

## 仍未对齐的缺口

### 1. `vscode-supervisor` 的 persisted restore 语义仍未完全覆盖所有前端服务

- 现在已经有:
  - restore in-progress 状态
  - restore promise/wait 语义
  - startup restore 与 session manager 联动
- console 这条链现在已经具备:
  - provisional placeholder
  - restoreState 预恢复
  - restore failure UI 回写
- 但还没有 Positron 那种“所有相关前端服务都消费 restored sessions”的完整覆盖。

结果:

- 核心 restore 状态机和 console 前端恢复已经不再是空实现。
- 但 notebook / 其他服务对 restored session 的消费还没有完全补齐。

### 2. `vscode-supervisor` 的 active language / implicit startup 仍是启发式近似

- `updateActiveLanguages()` 现在除了文本编辑器，还会考虑:
  - 已有 runtime sessions
  - notebook documents 的 cell language
  - visible notebook editors 的 cell language
- 但它仍然不是 Positron 那种更完整的“被用户真正触达”的语言来源模型。

结果:

- implicit startup 的触发条件比之前强了。
- 但最终仍不是 Positron 的完整语义。

### 3. `vscode-supervisor` 的 `NewFolderTasks` 已不再是纯占位，但仍不是完整 Positron new-folder service

- 当前已经:
  - 暴露 `registerNewFolderInitTask()`
  - 在 `RuntimeStartupPhase.NewFolderTasks` 阶段等待已注册任务完成后再继续 startup
  - 允许任务在执行过程中继续注册后续任务，并把它们纳入同一轮 barrier
  - 可在任务完成后顺手写入 affiliated runtime metadata

结果:

- startup phase 不再只是命名对齐，已经具备最小可用的 barrier 语义。
- 但还没有 Positron `positronNewFolderService` 那种集中式 new-folder config / initTasks / postInitTasks 状态机。

### 4. `vscode-supervisor` 的 workspace recommendation 仍比 Positron 保守

- 当前 recommendation 已经会:
  - 聚合多个 runtime manager
  - 回退到 `resolveInitialInstallation()`
- 但仍主要基于 provider 当前暴露的本地启发式，而不是 Positron 那种更完整的 workspace/environment recommendation 语义。

结果:

- recommendation 比之前更实用。
- 但仍未完全对齐 Positron 的推荐质量与上下文信号。

### 5. Ark 已经开始实质消费 startup/discovery API，但还没有完全对齐 Positron 的 ext-host 语义

- Ark 现在已实质使用:
  - `registerSessionManager`
  - `watchUiClient`
  - `startRuntime`
  - `getRestoredSessions`
  - `registerRuntimeManager`
  - `registerExternalDiscoveryManager`
  - `registerDiscoveredRuntime`
- 但以下能力仍没有形成完整功能链:
  - 显式 `completeDiscovery`
  - 更强的 `updateActiveLanguages()` / startup orchestration 联动

结果:

- Ark 已不再只是“导入了 Positron 风格命名”，而是已经拥有一条语言侧 discovery manager -> supervisor shared cache 的实际链路。
- 但整体结构仍不是 Positron 那种更完整的 extension-host runtime manager 分层。

## 从整条链路看，当前最主要的剩余差异

### A. restore 的前端体验仍未完全对齐

现在 console 已经补上了最关键的一条 restored placeholder 链；剩下的主要是:

- 更多前端服务对 `getRestoredSessions()` 的消费
- console 之外的恢复中界面状态收口

### B. new-folder / recommendation / implicit startup 的决策质量仍未完全对齐

还差的主要是:

- 更强的 workspace/new-folder 初始化信号与集中式状态机
- 更完整的 recommendation 决策依据
- 更接近 Positron 的 encountered-language 语义

### C. Ark 侧对 startup/discovery API 的消费还可以继续扩展

后续如果继续收口，优先级建议是:

1. 让 Ark 基于 `getRestoredSessions()` 建立更完整的 restored-session 前端恢复链。
2. 在 supervisor 侧补出更接近 Positron 的 new-folder service，而不只是 barrier API。
3. 继续增强 runtime recommendation / implicit startup 的输入信号。
