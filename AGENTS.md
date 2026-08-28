# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the TypeScript VS Code extension, including runtime/session, supervisor, logging, and public API modules.
- `src/test/` holds extension-host unit and integration tests. Webview source lives in `webview/src/` (Svelte components grouped by surface such as `console`, `plots`, and `variables`); its browser tests are in `webview/test/`.
- `scripts/` contains build, binary-install, contract-sync, and verification utilities. Runtime assets and platform binaries belong in `resources/`; localization is under `l10n/`.
- Treat `dist/`, `out/`, and other build outputs as generated artifacts; edit their source inputs instead.

## Build, Test, and Development Commands

Run `npm install` at the repository root. Common workflows:

- `npm run build` checks and bundles the webview, copies DuckDB assets, and compiles the extension.
- `npm run watch` watches the extension bundle; use `npm run watch:webview` for Vite webview development.
- `npm run lint` runs ESLint and Svelte checks.
- `npm test` prepares builds and runs the full VS Code test suite; `npm run test:unit:ext` runs extension unit tests only.
- `npm --prefix webview run test:integration` runs Playwright browser tests.
- Run `npm run verify:contracts` before submitting changes to synchronized API/RPC/Positron contracts.

## Coding Style & Naming Conventions

Use strict TypeScript (ES2022/Node16), four-space indentation, semicolons, and single quotes, matching existing files. Use `PascalCase` for classes and Svelte components, `camelCase` for functions, variables, and files, and descriptive domain-oriented names. Keep imports typed where practical and resolve ESLint/Svelte-check warnings before review.

## Testing Guidelines

Name extension tests `*.unit.test.ts` or `*.integration.test.ts`; name webview specs `*.unit.spec.ts` or `*.integration.spec.ts`. Add a focused regression test for behavior changes. No coverage threshold is configured, so run the narrowest relevant test while iterating and the full `npm test` (plus webview integration tests when applicable) before a PR.

## Commit & Pull Request Guidelines

Use Conventional Commit subjects seen in history, such as `feat(console): ...`, `fix: ...`, `refactor(runtime): ...`, or `chore: ...`; keep the summary short and imperative. PRs should explain the user-visible or API impact, link the relevant issue, list verification commands, and include screenshots or recordings for webview/UI changes. Call out generated contract, localization, or binary updates explicitly.

## Security & Configuration Tips

Never commit credentials or local VS Code test data. Install platform binaries with `npm run install:binaries` and preserve the manifest checksums; use the provided `verify:*` scripts to detect contract drift instead of hand-editing generated files.
