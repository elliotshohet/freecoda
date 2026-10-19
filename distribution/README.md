# Freecoda distribution and repository consolidation

[`elliotshohet/freecoda`](https://github.com/elliotshohet/freecoda) is the canonical public repository for source, documentation, contributions, release preparation, and the website readiness monitor. Future CLI archive releases use its Releases tab. npm package installation is unchanged.

The eight original commits, ending at [`8814dbf06bd922ed1a54ecadeb4c6d000f78dccb`](https://github.com/elliotshohet/freecoda/commit/8814dbf06bd922ed1a54ecadeb4c6d000f78dccb), are retained as a second parent history of the consolidation merge. The final source-repository commit is preserved on the canonical repository's [`archive/freecoda-releases` branch](https://github.com/elliotshohet/freecoda/tree/archive/freecoda-releases). The former `freecoda-releases` repository has been removed after its historical releases were copied and verified here. Original files are preserved in [`legacy-releases/`](legacy-releases/) as a historical snapshot. That snapshot's nested workflow does not execute; the maintained monitor is [the root workflow](../.github/workflows/public-monitor.yml). Supplemental notices are also available in [`legal/historical/`](../legal/historical/). Historical wording about private source describes the earlier distribution arrangement.

## Release asset migration

GitHub Release objects and attached installers are separate from Git history. All five historical desktop releases (`v0.1.0`–`v0.1.4`) and their 80 assets (4,335,321,599 bytes) have been copied to the canonical repository. The release metadata, asset names and sizes, and SHA-256 digests were compared against the source; the releases and assets are public. Issues and advisory conversations were not part of this asset migration.

The maintained desktop and CLI release workflows now target `elliotshohet/freecoda` using their scoped `GITHUB_TOKEN` with `contents: write`. Desktop release preparation retains the `desktop-release` environment and native artifact validation. npm publication remains separate.

The one-time migration utility at [`scripts/release/migrate-releases.py`](../scripts/release/migrate-releases.py) is retained as migration history. Its source repository has been removed, so the script cannot be rerun. All five historical releases (`v0.1.0`–`v0.1.4`) and their 80 assets (4,335,321,599 bytes) are available from the canonical repository's Releases tab. GitHub release metadata, asset names and sizes, and SHA-256 digests matched before the former repository was removed.

Existing installed desktop versions embed `elliotshohet/freecoda-releases` as their updater feed. They do not discover the new feed automatically. Users must manually reinstall from [the canonical releases](https://github.com/elliotshohet/freecoda/releases). New builds use the canonical repository. Preserve exact historical installers and updater manifests; copying them does not rewrite their embedded feed.

The maintained public readiness monitor runs from the root workflow in this repository. The nested historical workflow is archival and does not execute. Historical binaries preserve their original updater feed; migration does not rewrite or re-sign those installers.
