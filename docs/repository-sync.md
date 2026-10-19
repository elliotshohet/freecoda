# Work on the same repository across Freecoda clients

Connected repository settings belong to your Freecoda account. Sign into the same account in web, desktop, and CLI to see the same GitHub repository ID, owner/name, selected branch, and app directory. These settings select a repository; they do not copy a local folder or its uncommitted files into the cloud.

GitHub is the exchange point for code. Match both the repository and branch when moving between clients. Conversations sync separately from Git commits.

## Local CLI and desktop checkouts

Clone your repository and work in its checkout. In the CLI:

```sh
freecoda repos configured
freecoda repos status --root /path/to/checkout
freecoda repos pull --root /path/to/checkout
```

In desktop, open and trust that same local folder, select a coding mode, and send `/sync status` or `/sync pull`. Pull follows the selected permission preset; default permissions ask for command approval. Status shows the GitHub identity, branch, upstream, ahead/behind counts, local changes, and conflicts. Counts describe the last fetch until you pull.

Pull explicitly fetches `origin` and only fast-forwards the current tracking branch. It refuses local modifications, untracked files, conflicts, detached HEAD, and divergent history. It does not stage, stash, commit, push, reset, or choose a conflict resolution. Git merge hooks are disabled for this operation. Use a trusted checkout with your normal Git authentication already configured; interactive credential prompts are disabled.

Review and commit local changes yourself, then explicitly push the intended branch with Git. Another CLI or desktop checkout can then pull them. Desktop and CLI using the exact same folder already share files on disk; avoid concurrent editing of that folder by two clients.

## Web cloud workspaces

Select the same connected GitHub repository and branch, accept cloud storage consent, and explicitly import it into a cloud workspace. A cloud workspace is a separate copy. Opening a local folder in desktop or CLI does not upload it.

Review the web workspace diff before publishing its draft pull request. Merge that pull request in GitHub, then explicitly pull its target branch in your local checkout. Publishing a pull request alone does not update that branch.

Use **Check GitHub** (or `/sync status`) to see the repository identity, branch, base/upstream commits, unpublished changes, and divergence. Suspend the workspace to save its live files, then choose **Pull from GitHub** (or `/sync pull`) to load committed source from that branch. Pull refuses unpublished edits, a stale base, active tasks, and rewritten/divergent upstream history. It stays suspended and allocates no compute. Preserve or publish cloud edits first. Repository settings and conversation synchronization do not imply automatic live file synchronization. To move between clients: commit and push local work, pull the same branch in the web workspace, publish and merge reviewed web changes, then explicitly pull in desktop or CLI.
