# Freecoda CLI

A local coding agent with a full-screen terminal workspace, streamed replies, repository tools, visible approval prompts, and labeled sponsor placements. One Freecoda plan: free forever, supported by sponsors, with fair-use limits for hosted inference.

The package is prepared as `freecoda`; npm publication is currently held. The future release operator must authenticate as the npm account `freecoda` and verify that identity with `npm whoami` before a separately authorized publication. Building, packing, and installation checks do not authorize publishing. Run from the private monorepo:

```sh
bun install --frozen-lockfile
bun run build:cli
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js login
node packages/cli/dist/index.js --cwd /path/to/project
```

`login` connects your hosted account using a short-lived device code approved in your browser. Hosted access still requires an invited account and an available approved model. Use `provider configure` instead to connect an OpenAI-compatible provider directly. Its pricing and data policies apply. Set `FREECODA_PROVIDER_KEY` to supply a direct provider key without storing it in configuration.

## Terminal workspace

An interactive terminal opens the full-screen interface automatically. `--theme auto|dark|light` and `/theme auto|dark|light` save your preferred palette locally. Auto uses the terminal's `COLORFGBG` background hint when available, otherwise the dark palette. Both palettes inherit the terminal's background; Freecoda does not force a black screen or change your terminal profile. `NO_COLOR` remains respected. It shows the project directory, model, current mode, streamed conversation, tool activity, and approval diffs. Its composer supports multiline messages and input history. A labeled sponsor or Freecoda announcement stays in the footer.

| Control                                        | Action                                     |
| ---------------------------------------------- | ------------------------------------------ |
| Enter                                          | Submit the composer or approval response   |
| Ctrl+J                                         | Insert a newline                           |
| Left / Right, Home / End                       | Move the composer cursor                   |
| Up / Down                                      | Recall submitted messages                  |
| Ctrl+A / Ctrl+E                                | Move to the beginning / end                |
| Ctrl+U / Ctrl+K                                | Delete before / after the cursor           |
| Ctrl+W                                         | Delete the previous word                   |
| PageUp / PageDown                              | Scroll the visible transcript              |
| Tab                                            | Complete an unambiguous slash command      |
| Escape / Ctrl+C during a request               | Cancel the current request                 |
| Escape during approval                         | Decline that operation                     |
| Ctrl+C with composer text                      | Clear the composer                         |
| Ctrl+C twice with an empty composer, or Ctrl+D | Exit                                       |
| Ctrl+O                                         | Open the visible sponsor/announcement link |

Bracketed paste is inserted as text, including embedded newlines and slash commands; it does not submit automatically. The terminal's normal screen and cursor are restored on exit. `--plain` selects a traditional scrolling transcript. Small terminals and noninteractive output use the plain interface automatically.

## Commands

- `/help`: show commands and keyboard controls.
- `/plan <task>`: make a read-only plan for one turn.
- `/review <task>`: review project code using read-only tools.
- `/mode build|plan|review`: choose the default mode for following turns.
- `/model`: list approved hosted models, or show the direct provider model.
- `/model <id>`: select a model for this session.
- `/theme auto|dark|light`: save the terminal palette; `/theme` shows the current preference.
- `/usage`: show hosted allowance and reset information.
- `/status`: show the current directory, provider, model, and conversation size.
- `/new`: reset the model conversation without changing project files.
- `/clear`: clear the visible transcript while retaining model context.
- `/exit`: leave the application.

Start with `--resume` to reopen the conversation saved for the current repository. `--model <id>` chooses an approved hosted model or a model offered by your configured direct provider. Switching models retains the current conversation; use `/new` when you want fresh context.

For a single task and plain output:

```sh
node packages/cli/dist/index.js --cwd /path/to/project -p "Explain how authentication works"
```

Repository trust must already be granted when input is noninteractive. Noninteractive writes and shell commands are declined; there is no implicit permission bypass.

## Approvals and local state

Freecoda asks you to trust a repository before reading context. Repository tools exclude common credential files and respect `.gitignore` and `.freecodaignore`. Writes show a diff; shell commands show the requested command. Approve with `y` once, `s` for that action category during this session, or `n` to decline. Plan and review modes expose only read tools. Shell execution is not an OS sandbox, so review commands before allowing them.

Conversation history and optional direct provider keys are stored under `~/.config/freecoda` with owner-only permissions. `FREECODA_CONFIG_DIR` overrides that directory. `history clear` removes the saved conversation for the current repository; `logout` revokes the hosted terminal token. Model context can contain relevant repository excerpts and is sent to your selected provider.

## Sponsor placements

Ads are fetched from the public terminal-placement endpoint without sending your hosted token, prompt, repository name, or code. Sponsor copy is labeled, strips terminal control sequences, and uses validated same-origin redirect links. The full-screen footer supports Ctrl+O for longer signed links. Placements refresh between turns. With no paid campaign, the footer explicitly displays a Freecoda announcement, which does not count as a paid impression. Advertisement availability never blocks a coding request.

## Verification and supported terminals

The interface is intended for macOS, Linux, and WSL2 terminals supporting ANSI escape sequences. The plain interface remains available in other environments. CI also builds the Node bundle and checks `--help` on Windows, but this does not establish full native Windows interactive compatibility.

`tests/cli-terminal.test.ts` launches the actual bundled CLI in a real pseudo-terminal against a local fixture provider. It verifies paste does not execute embedded slash commands, a denied edit preserves the file, an approved edit changes it, a house announcement is displayed without paid impressions, and the terminal is restored on exit. It makes no real model calls and does not use account credentials.
