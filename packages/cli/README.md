# Freecoda CLI

A local coding agent with a full-screen terminal workspace, streamed replies, repository tools, visible approval prompts, and labeled sponsor placements. One Freecoda plan: free forever, supported by sponsors, with fair-use limits for hosted inference.

## Install

Install the Freecoda CLI with Node.js 22 or newer:

```sh
npm install --global https://github.com/elliotshohet/freecoda/releases/download/cli-v0.1.8/freecoda-0.1.8.tgz --ignore-scripts
freecoda --help
freecoda login
cd /path/to/project
freecoda
```

`login` connects your hosted account using a short-lived device code approved in your browser. Hosted access still requires an invited account and an available approved model. Use `provider configure` instead to connect an OpenAI-compatible provider directly. Its pricing and data policies apply. Set `FREECODA_PROVIDER_KEY` to supply a direct provider key without storing it in configuration.

## Build from source

Fork [elliotshohet/freecoda](https://github.com/elliotshohet/freecoda) on GitHub, then clone your fork (or clone that repository directly). From the monorepo root with Bun 1.3.5+ and Node.js 24:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/freecoda.git
cd freecoda
bun install --frozen-lockfile
bun run build:cli
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js login
node packages/cli/dist/index.js --cwd /path/to/project
```

The bundled Node entry point is `packages/cli/dist/index.js`; `bun run cli` runs the TypeScript source during development. Source builds use the production hosted service by default. To use your own local web service, configure it as described in the [root README](../../README.md), then run `node packages/cli/dist/index.js login --server http://127.0.0.1:3010`. Login saves the server connection for subsequent commands. A local build does not bypass hosted invitations, model approval, or account limits.

## Terminal workspace

An interactive terminal opens the full-screen interface automatically. `--theme auto|dark|light` and `/theme auto|dark|light` save your preferred palette locally. Auto uses the terminal's `COLORFGBG` background hint when available, otherwise the dark palette. Both palettes inherit the terminal's background; Freecoda does not force a black screen or change your terminal profile. `NO_COLOR` remains respected. It shows the project directory, connection, current mode, streamed conversation, tool activity, and approval diffs. Its composer supports multiline messages and input history. Type `/` to open the command menu, use Up/Down to choose, Enter to run, or Tab to complete. `/new` starts a saved task; `/resume` lists tasks for this project and `/resume <number or id>` reopens one. A labeled sponsor or Freecoda announcement stays separate above the composer.

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
| Escape during approval                         | Decline the operation |
| Ctrl+C with composer text                      | Clear the composer                           |
| Ctrl+C twice with an empty composer, or Ctrl+D | Exit                                         |
| Ctrl+O                                         | Open the visible sponsor/announcement link   |

Bracketed paste is inserted as text, including embedded newlines and slash commands; it does not submit automatically. The terminal's normal screen and cursor are restored on exit. `--plain` selects a traditional scrolling transcript. Small terminals and noninteractive output use the plain interface automatically.

## Terminal workspace

The full-screen interface keeps a compact Freecoda session header, the actual workspace and access mode, a scrolling conversation with tool activity, and a bordered message field. Sponsor placements remain labeled above the composer. Type `/` to discover supported commands; keyboard history, queued turns, and approval prompts keep their existing behavior. Provider names and model selectors are absent from the normal interface.

## Commands

- `/help`: show commands and keyboard controls.
- `/plan <task>`: make a read-only plan for one turn.
- `/review <task>`: review project code using read-only tools.
- `/mode chat|build|plan|review`: choose the default mode for following turns. Chat is the default and has no project access or tools.
- `/mcp`: list installed connections. `/mcp enable|disable <server-id>` changes the next turn’s connections; `/mcp discover <server-id>` explicitly connects to one enabled server, lists its actual tools, then closes without executing tools.
- `/tools`: show session tool selections. `/tools enable|disable <name>` selects native or discovered MCP tools for following turns. Mode and permission restrictions still apply; selecting a tool never grants approval.
- `/extensions`: list installed MCP connections and skills.
- `/queue`: inspect queued turns. While a response streams, Enter queues a message with its current model, mode, and tool restrictions. `/queue remove <id>` removes a queued turn; `/queue resume` retries after cancellation or failure. The queue pauses with the failed turn retained and never silently sends following turns. Up to 20 turns queue in the full-screen interface; plain mode remains sequential.
- `/theme auto|dark|light`: save the terminal palette; `/theme` shows the current preference.
- `/update`: show instructions to check and install an update after leaving the session.
- `/usage`: show hosted allowance and reset information.
- `/permissions`: choose Read only, Default, or Full access with Up/Down and Enter. Escape cancels. `/permissions read-only|default|full-access` and numeric arguments `1|2|3` also work.
- `/status`: show the current directory, connection policy, permissions/category grants, effective mode, and conversation size.
- `/new`: start a new conversation without changing project files.
- `/clear`: start a fresh chat while preserving saved history.
- `/exit`: leave the application.

Start with `--resume` to reopen the latest conversation in the current directory and mode scope. General chat and coding histories are separate; crossing between them starts a new conversation. Signed-in history syncs across web, Desktop and CLI, and `/resume` lists account conversations in the selected mode. Offline turns remain in a local outbox and retry after reconnection; concurrent updates keep a separate local copy. Existing local histories migrate once to the first verified signed-in account, and account changes use separate caches. A resumed coding conversation operates only in the current trusted folder. Use `/resume` to reopen an older conversation in the selected scope. `--mode build` starts coding directly. Use `/new` when you want fresh context.

For a single task and plain output:

```sh
freecoda --cwd /path/to/project -p "Explain how authentication works"
```

Chat does not require repository trust. Coding modes require trust before reading project context; trust must already be granted when input is noninteractive. Noninteractive writes and shell commands are declined; there is no implicit permission bypass.

## Session permissions

Every launch starts in **Default**: edits and shell commands ask for approval. Use Up/Down or `1–3` and Enter to choose Allow once, Allow this category for the session, or Decline; Escape declines. Approve once with `y`, grant that category for this session with `s` (commands includes external MCP tools), or decline with `n`. **Read only** permits reading project files but exposes no edit or shell tools. **Full access** explicitly allows edits and shell commands without approval prompts; commands run as your user, without an OS sandbox. Plan and Review always expose only read tools, including under Full access.

Changing the preset clears all previously granted categories. Presets and category grants last only for the current process; they are never saved to configuration or conversation history. `/new` and `/resume` change the task, not the current session permission preset. The composer and `/status` show the active policy. Noninteractive sessions keep the default deny-without-approval behavior.

## Tools, skills and connected repositories

Install a local skill directory/SKILL.md, a raw HTTPS SKILL.md (GitHub file URLs also work), or an HTTP MCP server:

```sh
freecoda extensions add-skill /absolute/path/to/skill/SKILL.md
freecoda extensions add-skill https://raw.githubusercontent.com/OWNER/REPO/main/skill/SKILL.md
freecoda extensions add-mcp DeepWiki https://mcp.deepwiki.com/mcp
freecoda extensions list
freecoda extensions show EXTENSION_ID
freecoda extensions disable EXTENSION_ID
freecoda extensions enable EXTENSION_ID
freecoda extensions remove EXTENSION_ID
freecoda --mode build
```

`/extensions [search]` and `/skills [search]` browse installed items in an active session. `/skills show <id>` reads the full installed instructions. `/skills install <source>`, `/install skill <source>`, or the exact chat request `install this skill <source>` opens a local installation review; type `install` to confirm. `/install mcp <name> <url>` uses the same confirmation. These chat requests never install automatically, and noninteractive prompts cannot approve an installation. Explicit installs start enabled. Local skill directories include supported text references/scripts, which can be read as supporting data; no installation scripts execute. URL installs download only the skill instructions, not referenced files. Skills apply to coding modes. MCP servers connect only in Agent/build mode; Chat stays tool-free, and Plan/Review do not connect to external servers. External MCP calls require commands-category approval; a session grant or Full access includes all commands and external tools. HTTP MCP endpoints use HTTPS, with loopback HTTP allowed for local development. Stdio transport and interactive MCP OAuth are not implemented.

The registry is saved privately in `~/.config/freecoda/extensions.json` (or `FREECODA_CONFIG_DIR`), independently of Desktop and cloud project extensions. Third-party servers receive tool arguments and may perform outside actions. Installing a skill adds guidance, not permission to bypass approvals.

Account GitHub repository settings are shared with web and Desktop:

```sh
freecoda repos list
freecoda repos configured
freecoda repos configure OWNER/REPO --branch main --directory apps/web
freecoda repos configure OWNER/REPO --installation ID --disable
freecoda repos remove OWNER/REPO
```

Sign in first and install the Freecoda GitHub App on the intended repositories using the link returned by `repos list`. Configuration saves branch/app-directory preferences after access validation; it does not clone repositories, grant local trust or push changes.

## Updates

The terminal checks the main GitHub repository for stable CLI releases. When an interactive session closes normally, a writable global npm installation automatically installs a newer release for the next session. Your running conversation is never restarted. Set `FREECODA_AUTO_UPDATE=0` to disable automatic installation. Source checkouts and project-local installations are never modified. You can also update explicitly:

```sh
freecoda update
freecoda update --install
```

The first command checks availability. `--install` downloads the canonical `cli-vVERSION` GitHub release archive, verifies its SHA256SUMS.txt checksum, and invokes npm with lifecycle scripts disabled into the existing global installation prefix. No credentials, sudo, or shell commands are used. Offline and read-only installations remain usable. For a permissions error, configure a user-owned npm prefix or use a Node version manager. `/update` shows instructions; updates wait until the interactive session finishes. HTTPS and the repository release controls establish publisher trust; the checksum detects download corruption.

## Approvals and local state

Freecoda starts in general chat with no repository context or tools. Switching to build, plan, or review asks you to trust the repository before reading context. Repository tools exclude common credential files and respect `.gitignore` and `.freecodaignore`. Writes show a diff; shell commands show the requested command. Approve with `y` once, `s` for that action category during this session, or `n` to decline. Plan and review modes expose only read tools. Shell execution is not an OS sandbox, so review commands before allowing them.

Conversation history has owner-only offline copies under `~/.config/freecoda` and synchronizes to your signed-in account. Optional direct provider keys remain local. `FREECODA_CONFIG_DIR` overrides that directory. `history clear` removes cached general chat and coding conversations for the current directory and queues their account deletion; `logout` revokes the hosted terminal token. Model context can contain relevant repository excerpts and is sent to your selected provider.

## Sponsor placements

Ads are fetched from the public terminal-placement endpoint without sending your hosted token, prompt, repository name, or code. Sponsor copy is labeled, strips terminal control sequences, and uses validated same-origin redirect links. The full-screen footer supports Ctrl+O for longer signed links. Placements refresh between turns. With no paid campaign, the footer explicitly displays a Freecoda announcement, which does not count as a paid impression. Advertisement availability never blocks a coding request.

## Verification and supported terminals

The interface is intended for macOS, Linux, and WSL2 terminals supporting ANSI escape sequences. The plain interface remains available in other environments. CI also builds the Node bundle and checks `--help` on Windows, but this does not establish full native Windows interactive compatibility.

`tests/cli-terminal.test.ts` launches the actual bundled CLI in a real pseudo-terminal against a local fixture provider. It verifies paste does not execute embedded slash commands, a denied edit preserves the file, an approved edit changes it, a house announcement is displayed without paid impressions, and the terminal is restored on exit. It makes no real model calls and does not use account credentials.

## Local execution and cloud boundaries

The CLI runs repository reads, edits, Git inspection and shell commands on this computer in the explicitly trusted checkout. Agent/build mode can use installed HTTP MCP tools after approval; Plan/Review stay read-only, and Chat has no repository tools. Hosted inference and account conversation sync still contact the configured Freecoda server. The CLI does not provision a local equivalent of hosted sandbox lifecycle or a preview proxy. Run your project's own development command locally through an approved shell command when needed. Connected GitHub repository preferences do not clone a checkout or grant local trust.

In an interactive session, `/update` checks the installed CLI and asks for confirmation. A confirmed update saves the conversation, closes the terminal interface, then installs verified release bytes for the next launch. Queued requests must be reviewed or completed first. Source checkouts report their limitation before checking the network; update and rebuild source explicitly. `/chat` and `/build` switch the existing conversation access mode with the same repository trust checks as `/mode`.

## Plugin bundles

A plugin is a reviewed JSON manifest containing skill sources and HTTP MCP connections. Browse installed bundles with `/plugins` or `freecoda plugins list`. `/plugins install <manifest URL>` or `freecoda plugins add <manifest URL>` downloads and displays the manifest, then requires you to type `install`. A failed bundle does not save partial installation. Remove a bundle and its members with `freecoda plugins remove <id>`. Independently installed extensions cannot be overwritten by a plugin.

```json
{
  "version": 1,
  "name": "Example project helpers",
  "skills": [{ "source": "https://example.com/SKILL.md" }],
  "servers": [{ "name": "Example tools", "url": "https://example.com/mcp" }]
}
```

Manifests are limited to 32KB, twenty skill sources and eight MCP servers. Use HTTPS URLs; local clients also accept loopback HTTP for development. The manifest cannot include installation scripts, executable hooks or credentials. Installation adds guidance and connections, without connecting to MCP or granting execution permissions. Remote skill URLs download instructions only; supporting files are not bundled automatically.
