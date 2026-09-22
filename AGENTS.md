# vscode-supervisor

独立 VS Code 扩展：管理语言运行时、Kallichore 会话和共享数据科学界面。
Positron 是行为与协议参考；本仓库不构建完整 IDE，也不拥有 R/Python 语言实现。

## 代码地图与事实来源

| 改动范围 | 入口 / 权威来源 |
| --- | --- |
| 激活、服务装配、导出 API | `src/extension.ts`、`src/application.ts` 的 `getApi()` |
| 公共类型、语言能力注册 | `src/api.ts`、`src/languageRegistry/`；`src/api.d.ts` 是生成的消费者声明 |
| 启动、发现、会话、消息及输出路由 | `src/runtime/`；新目录初始化在 `src/newFolder/` |
| Console、Variables、Help、Viewer、Data Explorer 等服务 | `src/services/`；Plots 服务在 `src/runtime/positronPlotsService.ts` |
| Kallichore/Jupyter 与 Positron 兼容层 | `src/supervisor/`；遵循该目录的 `AGENTS.md` |
| Host 侧 Webview / Custom Editor 桥接 | `src/webview/`、`src/editor/`、`src/services/dataExplorer/` |
| 浏览器界面 | `webview/src/`，Svelte + Monaco；遵循 `webview/AGENTS.md` |
| Host / Webview 共享类型与 RPC | `src/shared/`、`src/rpc/webview/`；RPC 局部规则见该目录 `AGENTS.md` |
| 命令、设置、视图、扩展标识 | `package.json`、`src/coreCommandIds.ts`；以实现和测试确认行为 |
| 测试 | `src/test/unit/`、`src/test/extension*.test.ts`、`webview/test/`、`scripts/install-binaries.test.mjs` |
| 构建、依赖、发布 | 两级 `package.json`、根 `package-lock.json`、`esbuild.mjs`、`webview/vite.config.ts`、`.github/workflows/`、`.vscodeignore` |

仅在任务涉及相应领域时读取：
- 开发、定向测试、生成与打包细节：`docs/agent-development.md`。
- Console 对齐：`docs/console-alignment/positron-console-alignment-plan.md`。
- Data Explorer 对齐：`docs/data-explorer-positron-ui-ark-alignment.md`。
- 会话历史差距：`docs/positron-session-alignment-gaps.md`；其中的未完成项必须重新对照代码确认。
- 持久化：`src/runtime/runtimeStartup.ts`、`src/runtime/ephemeralState.ts`、`src/services/console/consoleStateStore.ts`、`src/shared/consoleState.ts`。
- 设置迁移：`src/runtime/plotsConfiguration.ts`；没有统一数据库 schema / migration 工具链。

README 提供产品概览，但旧 API 示例不能覆盖 `src/api.ts`、`getApi()` 和当前测试。
`PHASE2-RESTRUCTURE-CHECKLIST.md` 是历史拆分记录，不是当前构建或迁移流程。

## 项目边界

- 保持独立扩展边界：通过公开 `vscode` API、本地服务和兼容层实现功能，不依赖 Positron 私有 `vs/*` 服务或父工作区构建产物。
- 语言注册走 API v2 的 `languages.forExtension(...).begin(...)` / builder / `commit()`；运行期服务在 `api.services`。不要根据旧 README 恢复已删除的顶层注册入口。
- 公共契约以 `ISupervisorFrameworkApi` 和 `getApi()` 为准。保留现有兼容适配器，除非任务明确要求改变兼容性；公共 API 改动同时检查消费者声明与集成测试。
- Supervisor 拥有 Notebook 会话与共享表面；语言扩展拥有 `NotebookController`、cell execution/cancellation 和稳定的 `metadata.cellId`，通过语言注册 builder 声明 controller 所有权。
- 工作目录切换由 provider 的 `setWorkingDirectory` 实现；共享 Kallichore 层不发送语言专属代码。自定义输出的 MIME/preload 解释由 renderer 扩展负责。
- Host 服务拥有会话和执行状态，Webview 通过 RPC 投影与发起操作；共享浏览器代码不得引入 `vscode` 或 Node 运行期依赖。
- 修改启动或输出加载时，保留现有 workspace trust、Webview CSP、本地资源范围与 URL 路由限制。
- 修改恢复/存储时，区分 extension-host 生命周期内存与持久化 Memento；兼容已有序列化版本，不能把进程内存状态当成跨进程存储。
- 修改命令、菜单或设置时，同时核对 manifest、命令常量、处理器、相关测试与本地化资源。

## 生成内容

- 修改公共声明源 `src/api.ts` 或其导出的叶子类型后，运行 `npm run sync:api-dts` 和 `npm run verify:api-dts`；不要手改 `src/api.d.ts`。
- RPC JSON、Positron 快照、Kallichore 同步各有不同来源与脚本；遵循对应目录规则，不通过手改生成结果消除 drift。
- `dist/`、`out/`、`webview/dist/`、`*.vsix` 是构建产物，不作为实现入口。

## 验证

从仓库根目录运行。使用 npm workspaces 和根锁文件；CI 使用 Node 22、`npm ci`，VS Code 最低版本以 `package.json.engines.vscode` 为准。
选择覆盖改动行为的验证，不把完整套件作为每次任务的前置条件。

| 改动 | 验证 |
| --- | --- |
| Host TypeScript / 单元行为 | `npm run compile-tests` 做类型检查并生成测试；`npm run test:unit:ext -- --grep '<pattern>'` 跑相关测试 |
| 扩展激活、导出 API 或多服务集成 | `npm test -- --grep '<pattern>'`；广泛改动时运行完整 `npm test` |
| Svelte / 浏览器共享类型 | `npm run check:webview`；交互改动运行相关 Webview Playwright 测试，见局部指南 |
| lint | Host 改动运行 `npm run lint`，或 `npx eslint <changed-files>` 加受影响的 Webview 检查 |
| 二进制安装脚本 | `npm run test:binaries` |
| API / RPC / 上游契约 / Data Explorer 文案 | 对应 `verify:*`；跨契约改动运行 `npm run verify:contracts`，需要可用的 Positron checkout |
| 构建、依赖、资源、打包 | `npm run build`；包内容改动再按发布指南检查 VSIX |
| 仅文档 | 检查路径、命令、事实与 `git diff --check`，不必启动 Electron 或浏览器测试 |

`test:unit:ext` 和 `npm test` 已包含测试编译及完整 build，不必先重复执行。
`npm run compile` 仅打包 Host；`npm run build` 不做 Host TypeScript 类型检查，不能替代 `compile-tests`。
扩展单元测试也在 VS Code/Electron 内运行；Webview Playwright 使用模拟 Host，不证明真实内核集成通过。
本仓库没有统一 formatter 命令；遵循附近代码，不引入 Positron 的全仓格式清理。

## 完成标准与自主决策

- 完成请求行为，相关检查通过；新增/修复行为有适当回归覆盖，公共行为说明和所需生成文件同步。
- 交付说明实际执行的验证；已有失败、缺失 checkout、浏览器或内核环境应明确列出，不报告为通过。
- 可逆实现选择、局部重构、搜索与测试选择自行决定；只有关键需求无法从仓库推断、解释会显著改变产品/API 行为，或下一步有不可逆高风险影响时才询问。
- 不把历史对齐计划中的所有缺口自动纳入当前任务。
