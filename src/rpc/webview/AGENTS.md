# Host / Webview RPC

- 源契约为 `contracts/*.json`，结构见 `contracts/schema/webview-rpc-contract.schema.json`；流程见 `contracts/README.md`。
- 每个 JSON 生成同名 `.ts`，另生成 `protocol.ts` barrel；这些带 `AUTO-GENERATED` 标记的文件不得手改。
- `index.ts`、`transport.ts` 是手写文件，不在该生成器输出范围内。
- 从根目录运行 `npm run sync:webview-rpc-contracts` 后运行 `npm run verify:webview-rpc-contracts`。
- 同步 Host handler、Webview client、共享 payload 类型和 `webview/test/harness/`；生成器只验证契约结构及文件同步，不验证两端行为。
- 此处是 Host↔Webview JSON-RPC；内核 Jupyter comm 在 `src/runtime/comms/`，Kallichore HTTP client 在 `src/supervisor/kcclient/`，不能混用协议格式。
