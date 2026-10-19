# Freecoda distribution and repository consolidation

[`elliotshohet/freecoda`](https://github.com/elliotshohet/freecoda) is the canonical public repository for source, documentation, contributions, release preparation, and the website readiness monitor. Future CLI archive releases use its Releases tab. npm package installation is unchanged.

The eight original commits from [`elliotshohet/freecoda-releases`](https://github.com/elliotshohet/freecoda-releases), ending at `8814dbf06bd922ed1a54ecadeb4c6d000f78dccb`, are retained as a second parent history of the consolidation merge. Their original files are preserved in [`legacy-releases/`](legacy-releases/) as a historical snapshot. That snapshot's nested workflow does not execute; the maintained monitor is [the root workflow](../.github/workflows/public-monitor.yml). Supplemental notices are also available in [`legal/historical/`](../legal/historical/). Historical wording about private source describes the earlier distribution arrangement.

## Release asset migration

GitHub Release objects, attached installers, download counts, issues, and advisory conversations are separate from Git history. Five historical desktop releases (`v0.1.0`–`v0.1.4`) contain 80 assets (4,335,321,599 bytes). Their source-history import does not transfer these binaries.

The maintained desktop and CLI release workflows now target `elliotshohet/freecoda` using their scoped `GITHUB_TOKEN` with `contents: write`. Desktop release preparation retains the `desktop-release` environment and native artifact validation. npm publication remains separate.

Run the migration utility from an authenticated GitHub CLI session with repository access:

```sh
python3 scripts/release/migrate-releases.py
```

This command performs the migration immediately; it is not a dry run. Review the script first and allow approximately 4.9 GB for its private `.data/release-migration` download cache. It preserves release metadata and verifies every copied asset using SHA-256. It never deletes the source repository. Verify all historical tags, assets, checksums, release visibility, and current download links in the canonical repository before separately removing the former repository. Advisory conversations and other repository settings need independent migration or replacement.

Existing installed desktop versions embed `elliotshohet/freecoda-releases` as their updater feed. They do not discover the new feed automatically. After the old repository is removed, users must manually reinstall from [the canonical releases](https://github.com/elliotshohet/freecoda/releases). New builds use the canonical repository. Preserve exact historical installers and updater manifests; copying them does not rewrite their embedded feed.

The maintained public readiness monitor runs from the root workflow in this repository. The nested historical workflow is archival and does not execute. Source consolidation alone establishes neither successful binary migration nor tested native upgrades.
