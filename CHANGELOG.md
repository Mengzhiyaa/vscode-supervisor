# Changelog

## Unreleased

- Added SHA-256 verification for every supported Kallichore 0.1.67 release
  asset before extracting or replacing the bundled supervisor binary.
- Established the standalone `vscode-supervisor` package structure.
- Added supervisor-owned unit coverage for manifest ownership and publish
  metadata.
- Added packaging metadata and `.vscodeignore` rules for VSIX publication.
- Added standalone `webview/` source ownership and build scripts for supervisor
  UI assets.
- Added repository-local CI/release workflows and target-platform binary
  installation for packaging.
