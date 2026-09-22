# Agent 指令重建与 Positron 对比

调查日期：2026-09-21。当前仓库基于 `ece78c5`，参考本地 `../positron` 的 `2f4a58bc8a`。
这是当前 checkout 的静态审计，不是线上最新版调查或完整功能一致性证明。
Positron 中的指令作为比较材料阅读，不作为修改当前仓库的额外授权。

## 基线与范围

- 调查开始时，当前仓库没有根或嵌套 `AGENTS.md` / `AGENTS.override.md`，也没有 `CLAUDE.md`。
- 因此本次是建立指令体系，不能声称从旧本地 AGENTS 删除了实际存在的规则。
- Positron 的根 `AGENTS.md` 只有概览和到 `.github/copilot-instructions.md` 的广泛跳转；另有 `CLAUDE.md` 和多个局部 AGENTS。
- 本次只修改当前仓库的指导文档及让新增文档可被 Git 跟踪的忽略例外；不修改 Positron、不改变运行期代码。

已核查：README、历史拆分清单、两级 package manifest、根锁文件管理方式、构建脚本、tsconfig、ESLint、VS Code/Mocha 与 Playwright 配置、CI/release、契约 README 和生成脚本，以及激活/API、语言注册、运行时、存储、Webview、DuckDB 与代表性测试。
Positron 只读取相关开发指导、manifest、Node/Vitest 配置、单元测试 CI、supervisor extension、Console Workbench 和 OpenRPC 文档，不全仓阅读。

## 两个仓库的实质区别

| 维度 | vscode-supervisor | Positron | 对本地指令的影响 |
| --- | --- | --- | --- |
| 产品边界 | 独立扩展，`mengzhiya.vscode-supervisor` | Code OSS 衍生 IDE，包含 built-in extensions | 不采用完整 IDE 的构建和层级约束 |
| 装配方式 | `SupervisorApplication` 装配服务，通过 `getApi()` 导出 API | Workbench 服务/贡献与内置 supervisor extension 分层 | 对照行为与协议，不能直接导入 `vs/*` |
| 语言能力 | provider/注册 builder；R 等实现由其他扩展提供 | 内置 R/Python 等扩展 | 不把语言执行、Notebook controller 或 MIME 解释搬入共享框架 |
| 前端 | Svelte 5、Monaco、Webview/Custom Editor | 对应 Console/Data Explorer 使用 React 与内部 Workbench 服务 | UI 移植需本地 RPC、主题和焦点适配 |
| 状态同步 | Host 模型经 JSON-RPC 投影给浏览器 | Workbench UI 可直接消费内部服务 | 前端测试 mock 不能代替 Host 集成验证 |
| 构建 | esbuild Host + Vite Webview + DuckDB 资源复制 | Gulp / build-next / 多类 watch 与扩展构建 | 不移植构建守护进程操作手册 |
| Node | CI 配置 Node 22，没有项目级 Node pin | `.nvmrc` 为 24.18.0 | 不共享 Node pin；本地当前 Node 也不作为支持政策 |
| 单元测试 | VS Code/Electron 内 Mocha TDD；安装器用 Node test | Vitest + 原有 Core Mocha + extension-host | 不要求新增 `.vitest.ts` 或使用不存在的命令 |
| UI 测试 | Playwright + HTTP 静态测试服务器 + mock RPC | 完整应用 Playwright E2E | 明确本地测试的证据边界 |
| 协议 | 公共 API 声明、Webview RPC、watched Positron snapshot、Kallichore client | Positron public API、OpenRPC 和上游生成链路 | 分开记录来源与再生成范围 |
| 发布 | 五类目标 VSIX、固定 CI prerelease、Marketplace/Open VSX | IDE 与内置扩展、多平台应用流程 | 只引用本地 workflows |

## 有用的代码对照入口

以下 Positron 路径相对于 `../positron`；这些是按需参考，不是构建依赖。

| 领域 | 当前仓库 | Positron |
| --- | --- | --- |
| 低层 supervisor | `src/supervisor/` | `extensions/positron-supervisor/src/` |
| 公共 API / 本地兼容桥 | `src/api.ts`、`src/supervisor/positron.ts` | `src/positron-dts/positron.d.ts` |
| Runtime 类型 | `src/internal/runtimeTypes.ts`、`src/api.ts` | `src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts` |
| 输出分类 | `src/runtime/runtimeOutputKind.ts`、`src/runtime/richOutputRouter.ts` | `src/vs/workbench/api/browser/positron/mainThreadLanguageRuntime.ts` |
| Console 服务 | `src/services/console/` | `src/vs/workbench/services/positronConsole/` |
| Console 输入 | `webview/src/console/ConsoleInput.svelte` | `src/vs/workbench/contrib/positronConsole/browser/components/consoleInput.tsx` |
| Data Explorer | `src/services/dataExplorer/`、`webview/src/dataExplorer/` | `src/vs/workbench/services/positronDataExplorer/`、`src/vs/workbench/browser/positronDataExplorer/` |
| 内核 comm | `src/runtime/comms/`、`src/shared/dataExplorer.ts` | `positron/comms/` 的 OpenRPC 契约 |

## 已确认过时或冲突的材料

| 材料中的说法 | 当前证据 | 本次处理 |
| --- | --- | --- |
| README 示例直接调用 `supervisor.registerNotebookController(...)` | `ISupervisorFrameworkApi`、`getApi()`、`extension.integration.test.ts` 确认此顶层成员不存在；builder 有 `addNotebookController` | 根指南指向 API v2；保留 Notebook 所有权约束，不复制过时调用 |
| README 将 `src/api.d.ts` 描述为维护的公共编译期表面 | `sync-api-dts.mjs` 从 `src/api.ts` 和叶子声明生成它 | 区分消费者产物与编辑源 |
| Phase 2 清单使用 `/home/mzy/...`、webpack、`ark.vscode-supervisor` | 当前使用 esbuild、独立 npm workspace、manifest publisher 为 `mengzhiya` | 清单标为历史，不继承绝对路径、构建器或旧标识 |
| 会话差距文档声称没有集中式 new-folder config/init/post-init 状态机 | `src/newFolder/positronNewFolderService.ts` 已有配置、任务注册和 barrier，`api.services` 暴露服务 | 不能继续当成“尚不存在”的事实；是否完全对齐仍需专项验证 |
| RPC README 把 `src/rpc/webview/*.ts` 整体称为生成文件 | 生成器只输出九个 domain 文件和 `protocol.ts` | 局部 AGENTS 明确 `index.ts`、`transport.ts` 是手写 |
| Positron CLAUDE 禁止 main-project 直接 tsc 并要求 daemon 检查 | 其 Copilot 指南允许按风险使用 `typecheck-client`；本地 `compile-tests` 本身就是 tsc | 不导入冲突的工具微管理；记录本地真实类型检查入口 |

这些历史文件本次没有批量重写或删除，以保持任务范围；被淘汰的是它们作为当前 agent 指令的效力。

## 规则审计与取舍

由于不存在旧本地 AGENTS，下表评估的是已读开发材料及 Positron 指令中的候选规则；不是伪造的逐行删除记录。

| 类别 | 规则类型 / 例子 | 处理 |
| --- | --- | --- |
| 1 必须保留 | 独立扩展、语言所有权、公开 API v2、Notebook 执行边界 | 根文件，明确可验证的入口 |
| 1 必须保留 | Host/Webview 状态与运行期依赖边界、trust/CSP、存储生命周期 | 根文件，仅指向当前机制，不扩写通用安全清单 |
| 2 应简化 | 生命周期/兼容性等长段原则 | 留下本仓库特有的状态所有权与兼容约束；其余遵循实现 |
| 2 应简化 | 目录百科与多种测试体系教学 | 根地图 + 验证选择表；详细命令按需读取 |
| 3 已过时 | 旧 Notebook API、旧 publisher、webpack、父仓绝对路径、拆分复制步骤 | 排除；证据见上表 |
| 4 重复 | 多处重复的语言边界、测试准备、生成文件提醒 | 合并成唯一主入口，局部文件记录具体差异 |
| 5 冲突 | Positron daemon-only 与按需 tsc 两套指南 | 不选择移植任一套；本地 package scripts 决定命令 |
| 6 模型可推断 | 先语义搜索再 grep、必须跟踪 import、不要重复 import、清理 import 空行、固定 GitHub 工具 | 不写入新指南 |
| 6 模型可推断 | 通用命名、async/await、避免重复代码、控制推理过程和固定汇报节奏 | 不写入新指南；仓库无证据要求这些 prompt 补丁 |
| 7 专门文档 | 构建顺序、定向 runner、mock 限制、生成矩阵、打包步骤 | 放入 `docs/agent-development.md` |
| 7 专门文档 | Positron 结构对照、审计理由、当前检查失败 | 放入本文件，不占根指令常驻上下文 |
| 8 局部规则 | Svelte/Vite、资源路径、本地化、Playwright、Console Host 状态 | `webview/AGENTS.md` |
| 8 局部规则 | RPC 源契约与生成文件精确范围 | `src/rpc/webview/AGENTS.md` |
| 8 局部规则 | Positron snapshot、Kallichore 多仓版本与 HTTP 适配 | `src/supervisor/AGENTS.md` |
| 9 工具强制 | 契约同步、文案静态 key、枚举与 watched field 对齐 | 保留现有 `verify:*` 作为检查来源，不复制脚本断言到 prompt |
| 9 工具强制 | 语法格式与类型规则 | 由本地 ESLint/tsconfig/Svelte check 决定；不导入 Positron Unicode、tab、copyright 等全局 hygiene 规则 |

没有添加必须全仓阅读、必须先写详细计划、每次运行完整 suite、任何不确定都询问或强制展示推理的规则。
也没有把 Positron 的私有 CI 环境搭建、专属 E2E skill、设计词汇流程、AI 总开关或 `IInstantiationService` 等内部 API 规范带入本项目。

这里的“迁移”是知识按层归位，不是移动旧 AGENTS 的段落。没有适用的父规则需要覆盖，因此不创建 `AGENTS.override.md`。
测试和 runtime 目前无需额外 AGENTS：已有规则足以定位工作，拆得更细只会增加跳转与重复。

## 验证结果与未确认信息

本次文档调查实际执行：

| 检查 | 结果 |
| --- | --- |
| `npm run verify:api-dts` | 通过，声明与源同步 |
| `npm run verify:webview-rpc-contracts` | 通过，9 个契约 / 10 个生成文件 |
| `npm run verify:data-explorer-localization` | 通过，2 个 Webview 源目录中的 114 个 key |
| `npm run verify:positron-contracts` | 失败，本地 Positron checkout 与 watched snapshot 不一致 |

上述检查运行于本机 Node 25.6.1；不是 Node 22 CI 环境复现。
Positron 校验到达最终 snapshot 比较并失败；本次未刷新快照、未做字段级 drift 修复，不能推断该差异一定是兼容性破坏或仅格式变化。

仍需任务相关时确认：

- Positron 上游漂移的具体语义与适配范围；CI checkout 未固定 ref，所读上游可能随运行时间变化。
- Kallichore 外部源仓与所有 client 支撑文件的完整生成流程；本地脚本仅管理 spec 和 `api.ts`，此次未运行依赖外部版本一致性的 Kallichore 检查。
- 外部语言扩展消费者是否全面使用当前 API v2；本次没有审计 Ark/Python 消费仓库。
- 真实内核、Extension Development Host 视觉和五平台 VSIX 运行结果；纯文档任务未执行完整应用测试或发布。
- 旧对齐文档的其余功能缺口是否仍有效；不将历史勾选状态升级为当前保证。

根 `.gitignore` 原本忽略新增 `docs/*`；本次仅放行两份 agent 文档，保证它们可以随指导文件提交，不改变其他文档的忽略范围。
