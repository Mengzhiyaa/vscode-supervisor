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
| Kallichore spec 与 client API | `../kallichore/kallichore.json`、`../positron/extensions/positron-supervisor/src/kcclient/api.ts` | 版本一致后 `npm run sync:kallichore-api` / `npm run verify:kallichore-api` |
| Data Explorer / Grid 文案 | Webview 调用、Host localization payload 与中文 bundle | `npm run verify:data-explorer-localization` |

`verify:contracts` 依次包含 API、Webview RPC、Positron snapshot 和 Data Explorer 本地化检查，**不包含 Kallichore API 检查**。
Positron snapshot 默认取 `../positron`，允许 `POSITRON_ROOT` 覆盖；Kallichore 同步的兄弟目录布局固定。
`src/runtime/comms/` 中移植的内核协议不是 Webview RPC generator 的输出；本仓库没有覆盖全部内核 comm 类型的再生成脚本。
不要因为移植文件头写着 auto-generated 就猜测或运行上游全量生成流程。

## 状态与语言所有权

- API 的稳定入口是 `src/api.ts` 的 `ISupervisorFrameworkApi` 和 `src/application.ts#getApi()`。
- API v2 的语言注册通过 `languages.forExtension(...).begin(...)` 的 builder 提交 runtime、LSP、binary、session manager、Notebook controller 等能力；具体身份字段查阅接口。
- `api.services` 有意排除底层注册方法。内部 `RuntimeSessionService.registerNotebookController` 的存在不表示它是顶层公共 API。
- Console 序列化版本在 `src/shared/consoleState.ts`，持久化预算和刷新逻辑在 `consoleStateStore.ts`。
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
