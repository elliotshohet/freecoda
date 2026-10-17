# Freecoda CLI

A local coding agent. Install the preview from the private monorepo, run `bun run build:cli`, then `node packages/cli/dist/index.js --help`.

Use `freecoda provider configure` to connect an OpenAI-compatible provider directly. API keys remain local; provider data policies and charges apply. Repository trust precedes context reading; writes and shell commands require approval. Shell execution is not an OS sandbox.

macOS, Linux, and WSL2 are the initial targets. The npm package is not yet published.
