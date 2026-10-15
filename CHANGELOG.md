# Changelog

## Unreleased

- Aligned the Kallichore server pin and generated REST client with Positron's
  0.1.71 baseline, including execution-history and MCP protocol declarations.
  Console history continues to use the existing persistence service.
- Added opt-in MCP workspace registration, native VS Code discovery, authenticated
  frontend channels, terminal discovery and reconnect-safe workspace credentials.
- Displayed agent attribution for external Console executions and retained it
  across input echoes and transcript restores.
- Forwarded local execution sources in Jupyter envelope metadata for Kallichore
  history and retained kernel build versions and commit hashes in runtime info.
- Handled rejected comm close notifications during disconnection.
- Improved stale supervisor detection and reported live executable version mismatches.
- Added source hashes and generator provenance, with contract validation before
  synchronizing Kallichore artifacts.
- Added SHA-256 verification for every supported Kallichore release
  asset before extracting or replacing the bundled supervisor binary.
- Established the standalone `vscode-supervisor` package structure.
- Added supervisor-owned unit coverage for manifest ownership and publish
  metadata.
- Added packaging metadata and `.vscodeignore` rules for VSIX publication.
- Added standalone `webview/` source ownership and build scripts for supervisor
  UI assets.
- Added repository-local CI/release workflows and target-platform binary
  installation for packaging.
