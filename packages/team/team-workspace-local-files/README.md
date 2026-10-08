# clocky-team-workspace-local-files

English | [中文](README.zh.md)

Shared filesystem implementation for the local sandbox and shared-root Team workspace providers. It publishes changed regular files, applies validated portable changes to private stages, checks regular-directory ancestors, and performs staged directory integration with exact recovery markers. Provider configuration, allocation authority, version scanning, deterministic disk naming, and target selection stay with the consuming provider.

## Contract

File publication respects the provider's per-file byte bound and artifact-store routing. Without an artifact store, files receive provider-owned local URI references and SHA-256 hashes. Deleted, non-regular, and oversized paths do not create file artifacts.

Portable changes cannot delete or replace directories, write through symlinks, or escape their target root. Parent creation rejects existing symlink and non-directory ancestors. Prepared recovery markers use exclusive creation; integrated markers replace their prepared record only after validation. Helpers receive the provider's diagnostic label explicitly, preserving each provider's error contract. Directory integration stages a private copy, rechecks its target version before committing, and restores or retires its deterministic backup according to the prepared/integrated marker.

## Verification

Sandbox and shared-root provider suites exercise these helpers through their existing allocation, publication, integration, restore, and error paths. The package owns no independent runtime event stream.

## Model Experience

### Local workspace file operations

#### What the model sees

This library does not register prompt sections, tools, or model inputs. `materializeArtifacts()` returns file references to the consuming provider, which owns artifact publication and exact task-attempt provenance.

#### Token effect

Zero direct token effect. Consuming providers own artifact and change-set bounds.

#### KV Cache effect

No effect; this library creates no model request prefix.

## Known Limitations and Deferred Work

- These filesystem primitives do not acquire cross-process allocation locks. Providers own integration serialization, directory-version rechecks, exact allocation provenance, and lifecycle settlement. The library does not implement remote filesystems or Git worktree operations.
