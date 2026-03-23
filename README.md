# vscode-supervisor

Standalone kernel-supervisor framework extension for VS Code. This child repo
owns the shared console, variables, plots, help, viewer, data explorer, and
runtime/session management surface.

## Development

- Install dependencies with `npm install`.
- Build the webview bundle with `npm run build:webview`.
- Build the extension bundle with `npm run build`.
- Compile the test bundle with `npm run compile-tests`.
- Run the extension unit suite with `npm run test:unit:ext`.
  Linux headless runs use `xvfb-run` automatically when needed.

This package intentionally excludes R-language ownership. Language-specific
extensions, such as `ark.vscode-ark`, depend on the public supervisor API
defined here. The public compile-time surface is maintained in `src/api.d.ts`,
which consumer repos copy into their own `src/types/` tree.

`webview/` is also source-owned here now, so the supervisor UI can be rebuilt
inside this repo without relying on parent-workspace artifacts.

## CI And Release

- `npm run install:binaries` installs the target-platform `kallichore` binary into `resources/kallichore/`.
- `.github/workflows/ci.yml` verifies build, tests, and a Linux VSIX smoke package.
- `.github/workflows/release.yml` builds tagged target VSIX artifacts, creates a GitHub Release, and publishes to marketplaces when `VSCE_PAT` and `OVSX_PAT` secrets are configured.
- Release runs can also be started manually with `workflow_dispatch`, while tagged pushes matching `v*` remain the default publish trigger.
- The repository should define `VSCE_PAT` for Visual Studio Marketplace publishing and `OVSX_PAT` for Open VSX publishing.

## Packaging

- Create a VSIX with `npm run vsce:package`.
- Packaging uses `.vscodeignore` to exclude source and test inputs while keeping
  compiled output and release metadata.
