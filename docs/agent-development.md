# Agent 开发参考

本文件承载按需查阅的命令和工作流。项目级约束见根 `AGENTS.md`；脚本、配置与实现变化时，以实际文件为准。

## 安装与构建

依赖由根 npm workspace 管理，`webview` 是唯一 workspace，共用 `package-lock.json`。
CI 使用 Node 22 和 `npm ci`；README 的 `npm install` 适合本地安装/有意更新依赖。
没有项目级 Node `engines` 或 `.nvmrc`，不要从 Positron 的 Node 版本推导本仓库要求。

| 根目录命令 | 实际作用 |
| --- | --- |
| `npm run compile` | esbuild production 打包 `src/extension.ts` → `dist/extension.js`；不做类型检查 |
| `npm run watch` | 仅 Host esbuild watch |
| `npm run check:webview` | Svelte / 浏览器 TypeScript 检查 |
| `npm run build:webview` | Vite 构建所有 Webview 入口 → `webview/dist/` |
| `npm run watch:webview` | Vite build watch，不启动浏览器开发服务器 |
| `npm run copy:duckdb` | 将 DuckDB WASM、worker 等资源从依赖复制到 `dist/duckdb/` |
| `npm run build` | 依次检查 Webview、构建 Webview、复制 DuckDB 资源、打包 Host |
| `npm run compile-tests` | 删除并重建 `out/`，通过根 tsconfig 对 Host 与测试做 TypeScript 检查 |
| `npm run lint` | 对 `src` 运行 ESLint，再运行 Webview check；不等于全仓格式检查 |

`.vscode/launch.json` 的 Extension Development Host 配置只引用 `npm: watch`。
首次运行 UI 或修改资源后，仍需相应的 Webview build / DuckDB 资源准备。

各 Webview 的 Host HTML 依次加载共享图标、Toolbar 与 ContextMenu 样式 `webview/dist/common/index.css` 和页面自己的 `<入口>/index.css`；Console 与 Data Explorer 先加载 `setup/index.css` 中的 Monaco 样式。
公共样式入口是 `webview/src/shared/common.css`，图标字体通过 CSS 相对 URL 引用 `assets/` 中的共享文件。新增入口时同步 Host HTML、浏览器测试页和开发入口，不再把 `positron-codicons.css` 或 `actionBar.css` 导入页面或组件，以免重复打包。

Monaco 功能清单位于 `webview/src/lib/monaco/features.ts`，通过公开的 `features/<feature>/register` 入口注册，避免引入 `register.all`。
Monaco 0.56 的普通补全弹窗控制器依赖 `inlineCompletions` 入口，不能只保留 `suggest`；新增裁剪需验证实际补全、Snippet、Hover 和签名提示交互。
构建配置将 Monaco 模块放在 `setup` 共享块，保持 Host 使用的 CSS 路径稳定；公共 API 和 Worker 仍可能保留 Diff 核心代码，不能通过单个 chunk 大小判断裁剪收益。

## 测试选择

### 扩展 Host

`.vscode-test.mjs` 定义 Mocha TDD runner，并加载 `src/test/mocha-setup.ts` 的编译结果。
`unit` 包含 `out/test/unit/**/*.test.js`，`all` 包含 `out/test/**/*.test.js`。
两者都需要 VS Code/Electron；文件名带 unit 不代表可以直接通过 Node Mocha 运行。

```sh
# 自带 compile-tests + build，再运行匹配的单元测试。
npm run test:unit:ext -- --grep '<suite-or-test-pattern>'

# 包括扩展激活与公开 API 集成测试，可同样过滤。
npm test -- --grep '<suite-or-test-pattern>'

# 仅在编译和 build 已对应当前源码时跳过重复准备。
npm exec -- node scripts/run-vscode-tests.mjs --label unit --grep '<suite-or-test-pattern>'
```

`scripts/run-vscode-tests.mjs` 透传 VS Code test CLI 参数。
Linux 无 `DISPLAY` 且已安装 `xvfb-run` 时自动使用虚拟显示；脚本不会安装系统依赖。
首次运行可能需要下载 VS Code；离线或缺少图形依赖属于环境限制。
扩展集成测试使用模拟语言 provider，不能据此声称真实 R/Python 内核端到端通过。

### Webview

```sh
npm run check:webview
npm --prefix webview run test:integration -- test/specs/console.integration.spec.ts
```

将示例 spec 换成受影响的 `webview/test/specs/` 文件，可继续附加 `--grep '<pattern>'`。
该脚本先 build，再用 Playwright 访问 4173 端口测试服务器；后端来自 `test/harness/` 的 RPC mock。
跨 UI/Host 改动应同时覆盖对应 Host 行为。
完整浏览器套件是 `npm --prefix webview run test:integration`；并非 `npm test` 的子步骤。

### 安装脚本与静态检查

`npm run test:binaries` 使用 Node 内置 test runner，覆盖 `scripts/install-binaries.test.mjs`。
Host 定向 lint 可运行 `npx eslint <changed-files>`。没有单独 formatter，也没有 Vitest 配置。
不要引入 Positron 的 `build-start`、`build-check`、`test:positron`、`precommit` 等命令。

## 契约来源与生成边界

| 内容 | 可编辑源 | 更新 / 验证 |
| --- | --- | --- |
| 消费者 API 声明 | `src/api.ts` 及其导出叶子类型 | `npm run sync:api-dts` / `npm run verify:api-dts` |
| Host↔Webview RPC | `src/rpc/webview/contracts/*.json` | `npm run sync:webview-rpc-contracts` / `npm run verify:webview-rpc-contracts` |
| Positron watched snapshot | 对应 Positron checkout 中五个 watched 源文件；清单在同步脚本中 | 审查本地兼容改动后 `npm run sync:positron-contracts` / `npm run verify:positron-contracts` |
| Kallichore spec、client API 与来源记录 | `../kallichore/kallichore.json`、`../positron/extensions/positron-supervisor/src/kcclient/api.ts`、上游 `.openapi-generator/VERSION` | 三方版本一致且契约匹配后 `npm run sync:kallichore-api` / `npm run verify:kallichore-api` |
| Data Explorer / Grid 文案 | Webview 调用、Host localization payload 与中文 bundle | `npm run verify:data-explorer-localization` |

`verify:contracts` 依次包含 API、Webview RPC、Positron snapshot 和 Data Explorer 本地化检查，**不包含 Kallichore API 检查**。
Positron snapshot 默认取 `../positron`，允许 `POSITRON_ROOT` 覆盖；Kallichore 同步的兄弟目录布局固定。
Kallichore 同步要求源码 `crates/kcserver/Cargo.toml`、本仓库 manifest 与 Positron supervisor manifest 的二进制版本完全一致，并在写入前核对操作、HTTP 路径/方法、模型字段及类型、必填性和枚举。`src/supervisor/kcclient/upstream.json` 由同步脚本生成，记录输入内容哈希、来源文件的最后提交、生成器版本与适配后 client 哈希；校验模式同时检查该记录，不能只复制 `api.ts` 消除 drift。
升级 Kallichore 时先更新匹配的源码 checkout、manifest 版本和 `positron.binaryChecksums.kallichore` 的各平台发布压缩包摘要。当前协议基线为 `0.1.71`，压缩包摘要来自 [kallichore-builds 0.1.71 release](https://github.com/posit-dev/kallichore-builds/releases/tag/0.1.71)。生成 API 继续使用本地 `httpClient`；不要覆盖 `base.ts`、`common.ts`、`configuration.ts` 等适配文件。需要重生成上游 TypeScript 客户端时参考 Positron supervisor 的 `scripts/regen-api.sh`（`typescript-axios`）；Kallichore 仓库同名脚本生成的是 Rust 服务端。
Console 持久化历史仍由现有服务负责，不改用 Kallichore 的执行历史端点。`executionRequested` 通知用于将外部执行与后续 Jupyter 回显、输出关联，并把来源保留到 Console 快照中。

MCP 工作区生命周期由 `src/supervisor/McpFrontend.ts` 管理，默认关闭；在受信任工作区设置 `kernelSupervisor.mcp.enabled: true` 启用，需要实际运行的 Kallichore 支持 MCP（基线 `0.1.71`）。VS Code 通过原生 MCP server definition provider 发现 `Supervisor Sessions`。集成终端使用兼容 Kallichore 的 `POSITRON_MCP_URL` / `POSITRON_MCP_TOKEN` 环境变量；已有终端按 VS Code 的环境更新提示重新创建。连接描述符位于扩展全局存储下的 `mcp/workspaces/`，索引为 `mcp/connections.json`；本地 stdio 客户端可用 `kcserver mcp-stdio --connections <扩展全局存储>/mcp` 按目录发现工作区。文件包含凭据，以所有者权限原子写入；远程扩展 Host 的文件与监听端口也在远程主机，客户端需在相同主机运行或自行配置通道。

MCP 工作区 ID 和期望端口保存在 `workspaceState`，token 保存在 VS Code `SecretStorage`。窗口重载或服务器重启会重新注册并复用身份；窗口关闭只断开 frontend channel，让分离会话继续可用；关闭设置会注销、清理发现文件和终端环境并删除保存的 token。frontend channel 同步窗口持有的会话、前台会话、焦点和已连接 Agent 数量。内核侧 MCP 会话工具由 Kallichore 提供；本扩展发送空的编辑器命令目录，不移植依赖 Positron 私有 AI 服务的命令代理、Agent 配置写入或 UI 自动化。

启动和重连日志记录实际 Kallichore 版本、预期版本及可执行文件来源；相邻 `../kallichore/target/{debug,release}/kcserver` 的开发构建优先级沿用现有逻辑，更新源码或 manifest 不会自动重编译或替换这些二进制。
`src/runtime/comms/` 中移植的内核协议不是 Webview RPC generator 的输出；本仓库没有覆盖全部内核 comm 类型的再生成脚本。
不要因为移植文件头写着 auto-generated 就猜测或运行上游全量生成流程。

## 状态与语言所有权

- API 的稳定入口是 `src/api.ts` 的 `ISupervisorFrameworkApi` 和 `src/application.ts#getApi()`。
- API v2 的语言注册通过 `languages.forExtension(...).begin(...)` 的 builder 提交 runtime、LSP、binary、session manager、Notebook controller 等能力；具体身份字段查阅接口。
- `api.services` 有意排除底层注册方法。内部 `RuntimeSessionService.registerNotebookController` 的存在不表示它是顶层公共 API。
- Console 序列化版本在 `src/shared/consoleState.ts`，持久化预算和刷新逻辑在 `consoleStateStore.ts`。
- 强制退出最多等待 250 毫秒清理 LSP/DAP；清理失败不会阻止内核终止。Console 在提交检查期间的停止操作只取消本次提交，保留排队输入；真正丢弃队列或中断已提交执行时，按 execution ID 发送可选的 `onDidCancelExecution` 通知，Python 据此清理未命名脚本的快照。
- 已保存的 Data Connection 可通过展开或“连接”操作重新连接；修改连接参数、驱动、机制或重新填写密钥会关闭旧连接，是否立即重新连接由 `addUpdateProfile` 的 `connect` 参数决定。仅重命名保留现有连接。
- Console LSP 的启动由语言 session manager 管理：同一语言先停用其他 Console 的 LSP，再启动目标 Console；切到其他语言时保留各语言最近的 Console LSP，Notebook 的 LSP 独立管理。`src/lspTunnel/lspTunnelService.ts` 只连接已经运行的 Host LSP，不负责启动；Webview 在 LSP 不可用时暂停重连，收到 `lspTunnel/availabilityChanged` 的可用通知后恢复。
- R/Python 恢复 Console LSP 时优先使用当前同语言的前台 Console，其次使用持久化的最后前台 Console；保存的 Console 已不存在或已退出时才回退到最新存活 Console。尚未就绪的已保存会话保留选择，等 Ready 后激活。Python 在等待初始化完成后，通过 `Stopped` 事件等待 LSP 停止，停止阶段最多等待两秒。
- 发现完成后，打开文档或切换活动编辑器会按该文档语言重新检查 implicit startup；仍受启动设置、workspace trust、恢复状态和新目录初始化屏障约束。Python 整文件执行使用 APK 的 `%run`，跟随已有 Python Console 并保留脚本定义；untitled 文档使用每次执行独立的临时脚本，文件保留到执行完成、会话结束或扩展服务释放后清理。
- Python 文件执行依赖 APK 的 `%run -G -- <path>`。`../apk/crates/apk/src/modules/apk/_magics.py` 是嵌入内核的源码；修改 magic 的参数解析或脚本导入路径处理后，需要重新构建 APK 并更新语言扩展使用的内核二进制。
- Console `executeCode` 返回提交后的 session ID，可选 observer 按 execution ID 通知实际完成或失败。Ark 的 RData/RDS 加载和未命名 R 脚本 Source 使用该通知等待结果；未命名脚本使用独立快照并在完成、失败或服务释放后清理。
- Python 解释器通知区分后台记录刷新与用户切换意图；只有后者选择或启动 Console。解释器删除、同路径重建时更新发现元数据并关闭旧 Console 会话；uv 环境使用 uv 包管理器，根据项目配置选择 `uv add/remove/sync` 或 `uv pip`。
- Console 的输出展示过滤不影响执行历史：Viewer 和 IPyWidget 输出中的 `text/plain` 也会记录，并按 output ID 更新。
- `runtimeStartup.ts` 管理恢复来源，`ephemeralState.ts` 只存活于当前 extension-host 进程；`newFolder` 使用自己的配置与任务状态。
- 文件 Data Explorer 的 DuckDB backend 在 `src/services/duckdb/`，不能把所有 Data Explorer 行为归为语言内核能力。
- 此仓库未提供统一业务数据库、schema migration CLI 或服务部署系统；相关变更应沿现有 Memento、配置迁移和文件导入实现处理。

## 打包与发布

权威来源为 `.github/workflows/ci.yml`、`.github/workflows/release.yml`、`.vscodeignore`、`scripts/install-binaries.mjs` 和 manifest 的 `positron.binaryDependencies`。

1. 包含资源的改动运行 `npm run build`，核对 `dist/extension.js`、`dist/duckdb/`、`webview/dist/` 的使用路径。
2. 目标二进制通过 `npm run install:binaries` 准备；CI 通过 `TARGET_OS` / `TARGET_ARCH` 选择平台。
3. 本地打包入口是 `npm run vsce:package`，prepublish 会触发 build；它不会自动运行二进制安装脚本。
4. CI 使用 `npx vsce package --no-dependencies --target <target> --out <file>`；发布构件必须按该流程包含目标平台的 Kallichore 与运行期资源。

现有矩阵是 Linux x64/arm64、macOS x64/arm64、Windows x64；不要假设存在 Windows arm64 包。
常规 CI 运行安装脚本测试、`verify:contracts`、完整 Host 测试和 Webview 测试，然后打包。
Release workflow 的验证较窄：安装脚本测试与 Host 单元测试，未包含全部 CI 检查，也未显式运行 lint。

主分支构件发布到固定 `ci-latest` 预发布；`v*` tag 或 workflow dispatch 触发 Release workflow。
Marketplace/Open VSX 发布依赖对应 secrets。发布具体步骤以 workflow 为准；本地打包不等于授权推送 tag 或发布。
