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

### Notebook controller ownership

`vscode-supervisor` owns notebook-mode runtime sessions and shared notebook
surfaces, but it does **not** create a generic VS Code `NotebookController`.
The language extension owns kernel selection and the complete cell execution
lifecycle: it creates/finalizes `NotebookCellExecution`, handles cancellation,
forwards code to `ILanguageRuntimeSession.execute`, projects
`onDidReceiveRuntimeMessage` events into cell outputs, and supplies a stable
`metadata.cellId` for every cell execution.

The language extension must register that ownership before starting or
restoring notebook sessions:

```ts
const ownership = supervisor.registerNotebookController(controller, ['r']);
context.subscriptions.push(ownership, controller);
```

Notebook session creation/restoration fails explicitly when no controller is
registered for the runtime language. Disposing the ownership registration only
unregisters the boundary; the language extension remains responsible for
disposing its controller.

### Language-owned working directory

Changing a working directory is language-specific. A runtime provider that
supports it should implement `setWorkingDirectory(session, workingDirectory)`
and use its language protocol or `session.execute()` to perform the change.
The common Kallichore layer does not issue R `setwd()` calls.

### Renderer bridge

Outputs that need notebook renderer or preload logic can be integrated without
private Positron workbench APIs:

```ts
const renderer = supervisor.registerRuntimeOutputRenderer({
  id: 'example.bokeh',
  mimeTypes: ['application/vnd.bokehjs_exec.v0+json'],
  outputKinds: ['webview_preload'],
  async render(output, context) {
    return { target: 'plot', html: renderBokeh(output.data) };
  },
});
context.subscriptions.push(renderer);
```

The renderer extension owns MIME interpretation and script/preload loading.
Supervisor owns routing the resulting HTML or URI into Viewer or Plots.

### Data Connections

New drivers should use the current flat `DataConnectionDriver` contract and
return object nodes with local `getChildren()` and `preview()` callbacks.
Legacy `IDataConnectionDriver` registrations using numeric node handles remain
supported through an adapter.

`webview/` is also source-owned here now, so the supervisor UI can be rebuilt
inside this repo without relying on parent-workspace artifacts.

## CI And Release

- `npm run install:binaries` installs the target-platform `kallichore` binary into `resources/kallichore/`.
- `.github/workflows/ci.yml` verifies build/tests, packages target VSIX artifacts for branch pushes, and republishes them into a single `CI Pre-release` GitHub prerelease.
- The CI prerelease is recreated from the fixed `ci-latest` tag on each `main`/`master` push so it stays at the top of the Releases page and always carries the newest CI VSIX files.
- `.github/workflows/release.yml` builds tagged target VSIX artifacts, creates a GitHub Release, and publishes to marketplaces when `VSCE_PAT` and `OVSX_PAT` secrets are configured.
- Release runs can also be started manually with `workflow_dispatch`, while tagged pushes matching `v*` remain the default publish trigger.
- The repository should define `VSCE_PAT` for Visual Studio Marketplace publishing and `OVSX_PAT` for Open VSX publishing.

## Packaging

- Create a VSIX with `npm run vsce:package`.
- Packaging uses `.vscodeignore` to exclude source and test inputs while keeping
  compiled output and release metadata.
