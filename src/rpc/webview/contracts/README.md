Webview RPC contracts live here.

- Edit `*.json` files in this directory as the source of truth for each webview RPC domain.
- Do not hand-edit the generated TypeScript files in `src/rpc/webview/*.ts`.
- After contract edits, run `npm run sync:webview-rpc-contracts`.
- Run `npm run verify:webview-rpc-contracts` to validate every contract and verify generated files without changing them.
- Contract files reference the shared schema at `./schema/webview-rpc-contract.schema.json` for editor validation.
- Normal workflow:
  1. Edit one domain contract such as `console.json` or `plots.json`.
  2. Run `npm run sync:webview-rpc-contracts`.
  3. Build or test as usual; CI runs `npm run verify:contracts` before the test suite.
- VSIX packaging:
  - These JSON contracts, this README, and the generator scripts are development-only inputs.
  - The extension ships the compiled JavaScript from `dist/`, not the contract sources.
  - `.vscodeignore` excludes `src/rpc/webview/contracts/**` and `scripts/**`, so these files stay out of the packaged `.vsix`.
