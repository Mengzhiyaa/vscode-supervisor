# Supervisor 兼容层

- `positron.ts` 提供本地兼容桥，`httpClient.ts` 提供生成客户端所需的 HTTP 适配；保持独立扩展运行能力。
- `contracts/README.md` 定义 watched Positron API / runtime / Data Explorer OpenRPC 的快照范围。
- 从根目录运行 `npm run verify:positron-contracts`；默认读兄弟目录 `../positron`，可用 `POSITRON_ROOT` 指定其他 checkout。
- 上游 drift 应先比较源契约、审查本地适配和输出路由，再运行 `npm run sync:positron-contracts`。禁止只刷新快照以让检查变绿。
- `contracts/positron-upstream-contract.json` 是生成快照，不是完整 Positron API 镜像，也不证明全功能对齐。
- Kallichore 同步前阅读根 `scripts/sync-kallichore-api.mjs`：它要求固定兄弟目录 `../kallichore` 与 `../positron/extensions/positron-supervisor`，不读取 `POSITRON_ROOT`。
- `npm run sync:kallichore-api` 同步根 `kallichore.json`、`kcclient/api.ts` 和来源记录 `kcclient/upstream.json`，将 Axios import 改写到本地 `httpClient`；完成后运行 `npm run verify:kallichore-api`。
- 同步要求 Kallichore 的 `crates/kcserver/Cargo.toml`、本仓库和 Positron supervisor manifest 中的 Kallichore 版本一致。
- 同步脚本写入前核对 spec 与客户端的操作、HTTP 路径/方法、模型字段、必填性、字段类型和枚举；生成器模板变化须更新校验逻辑，不能绕过失败。`upstream.json` 记录 spec/client 的来源提交、内容 SHA-256、生成器版本和本地适配后 client 的 SHA-256，不手改该文件。
- 升级二进制版本时同步根 manifest 中各平台发布压缩包的 SHA-256；摘要来源为 `posit-dev/kallichore-builds` 对应版本 release 的 asset digest。安装脚本校验的是压缩包，不是解压后的可执行文件。
- `kcclient/` 含生成代码及本地适配；不要把整个目录从上游覆盖。现有脚本不再生成其他 client 支撑文件；相关修改须保留本地 HTTP 适配并说明来源。
- 不手改已受同步脚本管理的 spec、client 或快照。缺少外部来源时说明验证缺口，不伪造更新。
