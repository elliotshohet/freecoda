# Freecoda CLI

A local coding agent with a full-screen terminal workspace, streamed replies, repository tools, visible approval prompts, and labeled sponsor placements. One Freecoda plan: free forever, supported by sponsors, with fair-use limits for hosted inference.

## Install

Install the Freecoda CLI with Node.js 22 or newer:

```sh
npm install --global freecoda@0.1.2
freecoda --help
freecoda login
cd /path/to/project
freecoda
```

`login` connects your hosted account using a short-lived device code approved in your browser. Hosted access still requires an invited account and an available approved model. Use `provider configure` instead to connect an OpenAI-compatible provider directly. Its pricing and data policies apply. Set `FREECODA_PROVIDER_KEY` to supply a direct provider key without storing it in configuration.

## Terminal workspace

An interactive terminal opens the full-screen interface automatically. `--theme auto|dark|light` and `/theme auto|dark|light` save your preferred palette locally. Auto uses the terminal's `COLORFGBG` background hint when available, otherwise the dark palette. Both palettes inherit the terminal's background; Freecoda does not force a black screen or change your terminal profile. `NO_COLOR` remains respected. It shows the project directory, model, current mode, streamed conversation, tool activity, and approval diffs. Its composer supports multiline messages and input history. Type `/` to open the command menu, use Up/Down to choose, Enter to run, or Tab to complete. `/new` starts a saved task; `/resume` lists tasks for this project and `/resume <number or id>` reopens one. A labeled sponsor or Freecoda announcement stays in the footer.

| Control                                        | Action                                       |
| ---------------------------------------------- | -------------------------------------------- |
| Enter                                          | Submit the composer or approval response     |
| Ctrl+J                                         | Insert a newline                             |
| Left / Right, Home / End                       | Move the composer cursor                     |
| Up / Down                                      | Recall submitted messages                    |
| Ctrl+A / Ctrl+E                                | Move to the beginning / end                  |
| Ctrl+U / Ctrl+K                                | Delete before / after the cursor             |
| Ctrl+W                                         | Delete the previous word                     |
| PageUp / PageDown                              | Scroll the visible transcript                |
| Tab                                            | Complete an unambiguous slash command        |
| Escape / Ctrl+C during a request               | Cancel the current request                   |
| Escape during approval                         | Decline the operation and cancel the request |
| Ctrl+C with composer text                      | Clear the composer                           |
| Ctrl+C twice with an empty composer, or Ctrl+D | Exit                                         |
| Ctrl+O                                         | Open the visible sponsor/announcement link   |

Bracketed paste is inserted as text, including embedded newlines and slash commands; it does not submit automatically. The terminal's normal screen and cursor are restored on exit. `--plain` selects a traditional scrolling transcript. Small terminals and noninteractive output use the plain interface automatically.

## Commands

- `/help`: show commands and keyboard controls.
- `/plan <task>`: make a read-only plan for one turn.
- `/review <task>`: review project code using read-only tools.
- `/mode chat|build|plan|review`: choose the default mode for following turns. Chat is the default and has no project access or tools.
- `/model`: list approved hosted models, or show the direct provider model.
- `/model <id>`: select a model for this session.
- `/theme auto|dark|light`: save the terminal palette; `/theme` shows the current preference.
- `/update`: show instructions to check and install an update after leaving the session.
- `/usage`: show hosted allowance and reset information.
- `/permissions`: choose Read only, Default, or Full access with Up/Down and Enter. Escape cancels. `/permissions read-only|default|full-access` and numeric arguments `1|2|3` also work.
- `/status`: show the current directory, provider, model, permissions/category grants, effective mode, and conversation size.
- `/new`: reset the model conversation without changing project files.
- `/clear`: clear the visible transcript while retaining model context.
- `/exit`: leave the application.

Start with `--resume` to reopen the latest conversation in the current directory and mode scope. General chat and coding histories are separate; crossing between them starts a new conversation. Use `/resume` to reopen an older conversation in the selected scope. `--mode build` starts coding directly. `--model <id>` chooses an approved hosted model or a model offered by your configured direct provider. Switching models retains the current conversation; use `/new` when you want fresh context.

For a single task and plain output:

```sh
freecoda --cwd /path/to/project -p "Explain how authentication works"
```

Chat does not require repository trust. Coding modes require trust before reading project context; trust must already be granted when input is noninteractive. Noninteractive writes and shell commands are declined; there is no implicit permission bypass.

## Session permissions

Every launch starts in **Default**: edits and shell commands ask for approval. Approve once with `y`, grant that category for this session with `s`, or decline with `n`. **Read only** permits reading project files but exposes no edit or shell tools. **Full access** explicitly allows edits and shell commands without approval prompts; commands run as your user, without an OS sandbox. Plan and Review always expose only read tools, including under Full access.

Changing the preset clears all previously granted categories. Presets and category grants last only for the current process; they are never saved to configuration or conversation history. `/new` and `/resume` change the task, not the current session permission preset. The composer and `/status` show the active policy. Noninteractive sessions keep the default deny-without-approval behavior.

## Updates

The full-screen interface checks npm for newer stable versions in the background. Exit your coding session before updating:

```sh
freecoda update
freecoda update --install
```

The first command checks availability. `--install` explicitly invokes npm to install the validated stable version globally from the public npm registry, with package lifecycle scripts disabled. It never uses sudo. For a permissions error, configure a user-owned npm prefix or use a Node version manager. `/update` only shows these instructions; it cannot replace the CLI while an agent is working.

## Approvals and local state

Freecoda starts in general chat with no repository context or tools. Switching to build, plan, or review asks you to trust the repository before reading context. Repository tools exclude common credential files and respect `.gitignore` and `.freecodaignore`. Writes show a diff; shell commands show the requested command. Approve with `y` once, `s` for that action category during this session, or `n` to decline. Plan and review modes expose only read tools. Shell execution is not an OS sandbox, so review commands before allowing them.

Conversation history and optional direct provider keys are stored under `~/.config/freecoda` with owner-only permissions. `FREECODA_CONFIG_DIR` overrides that directory. `history clear` removes saved general chat and coding conversations for the current directory; `logout` revokes the hosted terminal token. Model context can contain relevant repository excerpts and is sent to your selected provider.

## Sponsor placements

Ads are fetched from the public terminal-placement endpoint without sending your hosted token, prompt, repository name, or code. Sponsor copy is labeled, strips terminal control sequences, and uses validated same-origin redirect links. The full-screen footer supports Ctrl+O for longer signed links. Placements refresh between turns. With no paid campaign, the footer explicitly displays a Freecoda announcement, which does not count as a paid impression. Advertisement availability never blocks a coding request.

## Verification and supported terminals

The interface is intended for macOS, Linux, and WSL2 terminals supporting ANSI escape sequences. The plain interface remains available in other environments. CI also builds the Node bundle and checks `--help` on Windows, but this does not establish full native Windows interactive compatibility.

`tests/cli-terminal.test.ts` launches the actual bundled CLI in a real pseudo-terminal against a local fixture provider. It verifies paste does not execute embedded slash commands, a denied edit preserves the file, an approved edit changes it, a house announcement is displayed without paid impressions, and the terminal is restored on exit. It makes no real model calls and does not use account credentials.
