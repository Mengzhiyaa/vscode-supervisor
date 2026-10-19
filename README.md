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

Closing a session sends the kernel shutdown request immediately while LSP and
DAP cleanup runs in parallel. The kernel must exit before its session is removed.
Session removal is published before waiting for editor resource disposal.
Failed session creation releases the startup reservation so the same console
or notebook runtime can be retried. Replacing a language registration settles
pending `whenCapabilityReady()` observers of the old generation as `disposed`.
Extension shutdown attempts every save and cleanup step even when one fails,
then reports the collected errors. Concurrent shutdown requests share that work.
Active Console selection is committed to recovery storage only after a successful
write, so failed writes can be retried.

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
Clearing output, deleting its session, or releasing the router invalidates queued
rendering work. Late renderer results are discarded and released through the
renderer's `disposeOutput()` hook.

Data Explorer's DuckDB text filters treat `%`, `_`, and backslashes as literal
characters for contains, excludes, starts-with, and ends-with searches.

### Data Connections

New drivers should use the current flat `DataConnectionDriver` contract and
return object nodes with local `getChildren()` and `preview()` callbacks.
Legacy `IDataConnectionDriver` registrations using numeric node handles remain
supported through an adapter.

Concurrent requests to connect the same saved profile share one operation.
Removing a profile cancels publication of any pending connection and disconnects
its active connection. Connections returned after cancellation are disconnected
without restoring the deleted profile. Releasing the service also disconnects
profile connections; legacy handles retain their additional `dispose()` cleanup.

`webview/` is also source-owned here now, so the supervisor UI can be rebuilt
inside this repo without relying on parent-workspace artifacts.

## Kernel Supervisor Manager

Run **Supervisor: Open Kernel Supervisor Manager** from the Command Palette,
or use the server icon in the Runtime Sessions view toolbar. The editor shows
running instances recorded by this extension on the extension host, including version,
PID, executable and log paths, uptime, sessions, and MCP workspaces and agents.
It schedules another refresh five seconds after each check while visible.
Like the upstream running-supervisors command, both the page and the command
prune records that fail the process/socket liveness checks before probing HTTP
status. A surviving process with an HTTP timeout or authentication failure stays
listed as unavailable. Unchanged registries are not rewritten on every refresh.
This list is not a system-wide process scan; remote windows inspect their remote
extension host.

The session section counts connected, disconnected, and locally managed
sessions. Expand a row for its owner, start time, working directory, notebook,
client state and resource samples. **Reconnect** re-establishes the connection
to a running session already managed by this window without restarting its
kernel; **Open Console** focuses its existing console. Sessions transferred to
another client or not registered in this window cannot be adopted through this
page. Open their owning workspace to use its normal session restoration flow.

Use the page to open logs or a recorded workspace, restart this window's
supervisor, or shut down a reachable instance. Restart and shutdown end all
sessions in that instance and require confirmation. A later interpreter session
request can start a new supervisor after shutdown.

Running configuration edits apply temporarily to the selected server and all
its sessions. Use **Saved Settings** for persistent `kernelSupervisor` options;
settings changes or server restarts can override temporary values. CPU and
memory figures describe kernel sessions, not the kcserver process. Management
operations require a trusted workspace; credentials and session environment
variables are not sent to the management Webview.

Kernel processes survive window reloads independently of the optional log
terminal. Closing that terminal only closes the display. With
`kernelSupervisor.shutdownTimeout: "immediately"`, closing the window releases
its process lease and allows 60 seconds for reconnection before the supervisor
and its kernels are stopped. VS Code's public extension API does not distinguish
reload from window close, so this grace period also applies to ordinary closes.
Other shutdown policies retain their configured idle behavior. `when idle`
allows ongoing work to finish but is not a reconnect target after an application
restart; fixed-hour policies and `indefinitely` are reconnect targets.

An unexpected kernel exit follows `supervisor.interpreters.restartOnCrash`.
Reconnection preserves a running kernel's variables; crash recovery starts a new
kernel and cannot recover its in-memory data. Supervisors started by older
extension versions retain their original terminal behavior until explicitly
restarted. A supervisor restart ends its sessions.

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
