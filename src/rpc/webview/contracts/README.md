Webview RPC contracts live here.

- Edit `*.json` files in this directory as the source of truth for each webview RPC domain.
- Do not hand-edit the generated TypeScript files in `src/rpc/webview/*.ts`.
- Run `npm run generate:webview-rpc` after contract edits, or rely on the existing `pre*` build hooks.
- Use `npm run extract:webview-rpc-contracts` only as a migration/bootstrap helper when re-extracting contracts from generated TypeScript.
- Contract files reference the shared schema at `./schema/webview-rpc-contract.schema.json` for editor validation.
- Normal workflow:
  1. Edit one domain contract such as `console.json` or `plots.json`.
  2. Run `npm run generate:webview-rpc`.
  3. Build or test as usual; the standard npm entrypoints already regenerate first.
- VSIX packaging:
  - These JSON contracts, this README, and the generator scripts are development-only inputs.
  - The extension ships the compiled JavaScript from `dist/`, not the contract sources.
  - `.vscodeignore` excludes `src/rpc/webview/contracts/**` and `scripts/**`, so these files stay out of the packaged `.vsix`.
