# Phase 2 Restructure Checklist

Target: standalone `vscode-supervisor` repository.
Landing directory for all copy steps in this document: `/home/mzy/vscode/vscode-ark/submodule/vscode-supervisor`.

## 1. Bootstrap Repo Metadata

- [ ] Seed `package.json` from `/home/mzy/vscode/vscode-ark/packages/vscode-supervisor/package.json`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/tsconfig.json` and remove split-era exclusions that no longer apply.
- [ ] Derive a single-entry `webpack.config.js` from `/home/mzy/vscode/vscode-ark/webpack.config.js`.
- [ ] Keep `LICENSE.txt`, `ThirdPartyNotices.txt`, and a supervisor-specific `README.md`.

## 2. Copy Core Source Tree Into `submodule/vscode-supervisor`

- [ ] Copy `/home/mzy/vscode/vscode-ark/src/api.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/api.d.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/application.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/binaryManager.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/coreCommandIds.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/positronTypes.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/coreExtension.ts` as `src/extension.ts`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/editor/`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/rpc/`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/runtime/`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/services/`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/src/supervisor/`.
- [ ] Review `/home/mzy/vscode/vscode-ark/src/types/` and keep only supervisor-owned compatibility files still needed after extraction.

## 3. Copy Non-Source Assets Into `submodule/vscode-supervisor`

- [ ] Copy `/home/mzy/vscode/vscode-ark/webview/`.
- [ ] Copy `/home/mzy/vscode/vscode-ark/resources/`, excluding R-only startup assets.
- [ ] Copy `/home/mzy/vscode/vscode-ark/images/logo.png`.
- [ ] Keep any shared build/tooling files still required by supervisor packaging and tests.

## 4. Remove R-Owned Surface

- [ ] Do not copy `/home/mzy/vscode/vscode-ark/src/languages/`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/src/rExtension.ts`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/src/commandIds.ts`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/images/Rlogo.svg`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/syntaxes/`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/language-configuration.json`.
- [ ] Do not copy `/home/mzy/vscode/vscode-ark/resources/scripts/startup.R`.

## 5. Remove Split-Era Transitional Tooling

- [ ] Do not carry `/home/mzy/vscode/vscode-ark/packages/`.
- [ ] Do not carry `/home/mzy/vscode/vscode-ark/manifest-fragments/`.
- [ ] Remove `generate-split-extension-packages.ts`.
- [ ] Remove `verify-split-extension-packages.ts`.
- [ ] Remove `verify-split-extension-boundaries.ts` after the standalone repo gets its own simpler checks.
- [ ] Replace split package generation with direct `package.json` ownership.

## 6. Package.json Cleanup

- [ ] Keep only core contributes from the generated supervisor manifest.
- [ ] Remove all R commands, R activation events, R grammars, R language config, R debugger/breakpoints.
- [ ] Preserve console/data explorer/help/viewer/framework contributions.
- [ ] Keep extension ID `ark.vscode-supervisor`.

## 7. Tests And Verification

- [ ] Carry supervisor-owned unit tests from `/home/mzy/vscode/vscode-ark/src/test/`.
- [ ] Drop R-only tests such as `rExtension.unit.test.ts` from this repo.
- [ ] Add a supervisor build gate: `npm run compile`, `npm run compile-tests`, and relevant unit suites.

## 8. Final Parent-Repo Cleanup Trigger

- [ ] Only after this workspace builds independently, remove supervisor-owned code from the future `vscode-ark` repo source tree.
