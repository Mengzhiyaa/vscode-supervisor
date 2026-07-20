# Positron upstream contract snapshot

`positron-upstream-contract.json` is generated from the watched compatibility and rich-output surface in a Positron checkout. It intentionally tracks only the API members and runtime internals used by vscode-supervisor, rather than snapshotting the entire Positron API.

The verifier also checks that local runtime enums match Positron, that local message interfaces preserve every watched upstream field, and that the compatibility bridge exposes every watched namespace member.

Local workflow, with Positron checked out at `../positron`:

1. Run `npm run verify:positron-contracts`.
2. If it reports drift, review the upstream API or classifier change and update the implementation first.
3. Run `npm run sync:positron-contracts` only after that review.

Set `POSITRON_ROOT` when the checkout is elsewhere. CI sparse-checks out the current Positron sources and fails if a watched structure changes without a corresponding snapshot review.
