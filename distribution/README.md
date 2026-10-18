# Freecoda distribution and repository consolidation

[`elliotshohet/freecoda`](https://github.com/elliotshohet/freecoda) is the canonical public repository for source, documentation, contributions, release preparation, and the website readiness monitor. Future CLI archive releases use its Releases tab. npm package installation is unchanged.

The eight original commits from [`elliotshohet/freecoda-releases`](https://github.com/elliotshohet/freecoda-releases), ending at `8814dbf06bd922ed1a54ecadeb4c6d000f78dccb`, are retained as a second parent history of the consolidation merge. Their original files are preserved in [`legacy-releases/`](legacy-releases/) as a historical snapshot. That snapshot's nested workflow does not execute; the maintained monitor is [the root workflow](../.github/workflows/public-monitor.yml). Supplemental notices are also available in [`legal/historical/`](../legal/historical/). Historical wording about private source describes the earlier distribution arrangement.

## Compatibility repository

GitHub Release objects, attached installers, download counts, issues and advisory conversations are not Git commits and do not move when histories merge. The existing five desktop releases (`v0.1.0`–`v0.1.4`) and their 80 assets remain in `freecoda-releases`. Published installer URLs, checksums, updater manifests, blockmaps, old tags, and assets must remain unchanged. Do not delete, archive, rename, or replace that repository or its release assets as part of this consolidation.

Installed desktop applications embed `elliotshohet/freecoda-releases` as their updater destination. The maintained desktop release workflow therefore continues publishing there through the existing restricted release credential. The website's current downloads and installed-app upgrade qualification keep those same URLs. Changing the feed would require a separately tested bridge release for every supported installed platform; no such native migration is claimed here. Avoid copying existing installers to a second release feed, which would add storage and split update discovery.

Future CLI archives have no desktop updater dependency and can be released in the canonical source repository using its scoped `GITHUB_TOKEN`. Their reviewed source/check/artifact validation and protected release environment remain mandatory. No release is created by this repository-consolidation change, and npm publication remains separate.

The original repository now points contributors here and retains only compatibility distribution responsibilities and a manual readiness check. Its scheduled check is moved here to avoid duplicate hourly monitoring. Standard public runners are used without artifact uploads; no additional paid service is introduced. Private vulnerability reporting stays at the established enabled [compatibility advisory channel](https://github.com/elliotshohet/freecoda-releases/security/advisories/new); ordinary bugs belong in this canonical repository.
