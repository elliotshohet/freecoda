import { DesktopDownloads } from "@/components/desktop-downloads";
import { Install } from "@/components/install";
import { CLI_PUBLISHED } from "@/lib/releases";
import Link from "next/link";
export const metadata = { title: "Documentation" };
export default function Docs() {
  return (
    <main className="page-shell docs-layout" id="main">
      <nav className="docs-nav" aria-label="Documentation">
        <a href="#installation">Installation</a>
        <a href="#browser">Browser workspace</a>
        <a href="#desktop">Desktop downloads</a>
        <a href="#first-project">Your first project</a>
        <a href="#commands">Commands</a>
        <a href="#byok">Advanced settings</a>
        <a href="#permissions">Permissions</a>
      </nav>
      <article className="prose">
        <span className="section-kicker">A small guide to getting started</span>
        <h1>
          Make yourself
          <br />
          at home.
        </h1>
        <p>
          Freecoda runs in your terminal, alongside the editor and tools you
          already use. Start with an existing Git repository on macOS, Linux, or
          Windows. Node.js 22 or newer is required for the CLI.
        </p>
        <h2 id="installation">Installation</h2>
        {!CLI_PUBLISHED && (
          <div className="notice">
            The CLI release is being processed by npm and is not available yet.
            Use the <Link href="/app">browser workspace</Link> with your beta
            invitation while publication completes.
          </div>
        )}
        <p>
          {CLI_PUBLISHED
            ? "Install the CLI with Node.js 22+:"
            : "Once npm publication completes, install with:"}
        </p>
        <Install compact />
        <p>
          Hosted access is currently invite-only. Signing in creates an account;
          it does not grant an invitation or bypass capacity limits.
        </p>
        <h2>Hosted model and privacy</h2>
        <p>
          Hosted chat and coding use Reflection Beam Free through Vercel AI
          Gateway. The provider may retain submitted conversations, source
          excerpts, and tool output and use them for training. This route has no
          no-training or zero-data-retention guarantee. Do not submit secrets or
          private customer data. Read the <Link href="/privacy">privacy policy</Link>
          {" "}before sending content. If Beam is unavailable or no longer free,
          hosted requests stop rather than switch to another model.
        </p>
        <h2 id="browser">Build in your browser</h2>
        <p>
          Open the <Link href="/app">browser workspace</Link>, sign in with
          GitHub, and create a Next.js or Vite project. You can also connect the
          Freecoda GitHub app and import a repository you select. Choose the app
          directory when working in a monorepo.
        </p>
        <p>
          Review the cloud consent before creating or importing a project. Cloud
          source and conversation history are retained for seven days after the
          last activity. Projects run in isolated cloud machines and have
          separate compute limits, shown in the workspace. Suspend a project to
          stop its machine; delete it to remove saved cloud data.
        </p>
        <p>
          Edit and save files, ask the agent to build or plan, then inspect its
          diff and command output. Preview your app in the private preview
          panel. Publishing requires reviewing the current diff and explicitly
          confirming a draft pull request. Freecoda does not merge that pull
          request for you.
        </p>
        <h2 id="first-project">Your first project</h2>
        <p>
          Run the CLI inside the project you want to work on. Review the
          repository trust prompt before continuing.
        </p>
        <pre>{"freecoda login\ncd ~/your-project\nfreecoda"}</pre>
        <p>
          Hosted sign-in requires a beta invitation. The default hosted mode
          uses your free sponsored allowance; no API key is required.
        </p>
        <h2 id="commands">A few useful commands</h2>
        <pre>{"/plan add a settings page\n/review\n/usage\n/new\n/exit"}</pre>
        <p>
          Use <code>freecoda --resume</code> to reopen your latest local
          conversation. Use <code>freecoda history clear</code> to delete saved
          conversations for the current repository. Ctrl+C cancels the current
          request.
        </p>
        <h2>Keep your CLI up to date</h2>
        <p>
          The full-screen interface checks for updates in the background. Exit
          your session before installing an update. No update is installed
          automatically while an agent is working.
        </p>
        <pre>{"freecoda update\nfreecoda update --install"}</pre>
        <p>
          The first command checks npm; the second explicitly installs the
          latest stable version globally. Freecoda does not use sudo. If npm
          reports a permissions error, use a Node version manager or a
          user-owned npm prefix.
        </p>
        <h2 id="desktop">Download the desktop beta</h2>
        <DesktopDownloads />
        <details id="byok">
          <summary>Advanced settings: optional API key</summary>
          <p>
            You do not need an API key for the free sponsored plan. Configure a
            direct provider only if you want to use your own model and account.
            Your provider bills you directly; this does not add sponsored
            credits or increase your Freecoda allowance.
          </p>
          <p>
            Your CLI can connect directly to an OpenAI-compatible provider.
            Supply the provider’s HTTPS API base URL and exact model ID, and
            enter the key through the hidden prompt. You can also provide it
            through <code>FREECODA_PROVIDER_KEY</code>.
          </p>
          <pre>{"freecoda provider configure\nfreecoda"}</pre>
          <p>
            Keys are saved locally with owner-only permissions when you choose
            to save them. Freecoda receives neither the key nor the model
            requests in this mode. Your provider’s pricing and data policies
            apply. Plain HTTP is supported only for loopback addresses, for
            local model servers.
          </p>
          <p>
            To return to your free hosted allowance, run{" "}
            <code>freecoda hosted</code> and sign in with{" "}
            <code>freecoda login</code> if needed.
          </p>
        </details>
        <h2 id="permissions">Terminal permissions</h2>
        <p>
          In the terminal, Freecoda asks before writing files or running shell
          commands. You may approve the current action or allow that action
          category for the session. Shell commands run as your user and can
          affect your machine; inspect them carefully.
        </p>
        <p>
          Repository tools reject paths outside the workspace and respect
          ignored files. Shell approvals are a separate boundary: approved
          commands are not an operating-system sandbox. Terminal conversations
          are saved locally; approved context is sent to the selected AI
          provider.
        </p>
      </article>
    </main>
  );
}
