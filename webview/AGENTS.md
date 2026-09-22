# Webview

适用于本目录。这里是 Svelte 5 / Vite 浏览器应用，Host 桥接在根目录的 `src/webview/` 等服务中。

- `vite.config.ts` 声明各界面入口与输出路径；Host provider 按这些路径加载 bundle。新增或重命名入口时同步两端。
- 保持相对资源 base 和 VS Code Webview 资源 URI 机制；不要写入开发服务器绝对地址。
- `$lib` 指向 `src/lib/`，`@shared` 指向根 `src/shared/`。浏览器代码不直接访问 Node、文件系统或 VS Code Host API。
- RPC 客户端入口为 `src/lib/rpc/client.ts`；消息类型来自根 `src/rpc/webview/`。契约改动按该目录指南生成，并同步 `test/harness/` 模拟后端。
- 本地化使用 `src/lib/localization.ts`，消息来自根 `src/webview/webviewLocalization.ts` 的 `vscode.l10n` payload；新增文案同步 `l10n/bundle.l10n.zh-cn.json`。
- Data Explorer / Data Grid 的静态文案 key、默认值和翻译由根 `npm run verify:data-explorer-localization` 检查。
- 沿用现有 `--vscode-*` 主题变量与 fallback；交互改动覆盖受影响的键盘、焦点和尺寸行为。
- Console 提交状态以 Host `consoleInstance` 为准。迁移 Positron UI 时对齐行为，通过本地 Svelte/RPC 实现，不直接引入 React Workbench 服务。

从仓库根目录运行：

| 场景 | 命令 |
| --- | --- |
| 类型 / Svelte 检查 | `npm run check:webview` |
| 定向交互测试示例 | `npm --prefix webview run test:integration -- test/specs/console.integration.spec.ts` |
| 完整 Webview 套件 | `npm --prefix webview run test:integration` |
| Console 浏览器开发入口 | `npm --prefix webview run dev:console` |

Playwright 配置在 `test/playwright.config.ts`，使用 `test/server.mjs` 的 4173 端口和模拟 RPC Host。
测试脚本会先 build；缺浏览器时在本目录运行 `npx playwright install chromium`（Linux 系统依赖见 CI）。
普通 `npm run watch:webview` 是 bundle watch；`dev:console` 才是浏览器开发服务器。
真实 VS Code 主题、布局和原生菜单仍需在 Extension Development Host 验证，不能由模拟 Host 测试结果代替。
