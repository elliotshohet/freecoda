import publicStyles from "@/components/public-page.module.css";
import { publicPageMetadata } from "@/lib/seo";
export const metadata = publicPageMetadata({
  title: "Privacy Policy & Data Use",
  description: "Read how Freecoda handles conversations, source code, account sync, cloud workspaces, provider data use, and deletion.",
  path: "/privacy",
});
export default function Privacy() {
  return (
    <main className={`page-shell ${publicStyles.page}`} id="main">
      <article className="prose">
        <span className="section-kicker">Privacy policy</span>
        <h1>
          Your code. Your conversations. Your control.
        </h1>
        <p className="legal-updated">Preview policy · October 19, 2026</p>
        <p>
          Freecoda is built around local execution, clear permissions, and
          straightforward data use. We do not sell your source code or
          conversations or share them with advertisers. Our hosted model
          provider may retain submitted content and use it for training, as
          described below.
        </p>
        <h2>What stays on your machine</h2>
        <p>
          General chat in the CLI and desktop app has no repository tools and
          does not automatically read project files. Its saved history is separate
          from coding conversations. Sending a message still shares conversation
          context with the selected provider.
        </p>
        <p>
          When you use the local CLI, your repository and tool execution stay
          on your machine. Signed-in conversation history syncs to your account,
          including source excerpts or tool output already included in messages.
          Freecoda does not upload your entire repository merely to sync history. When you use your own API
          key, the key is stored locally with restrictive file permissions.
          Direct provider requests bypass Freecoda.
        </p>
        <h2>Account conversations and offline copies</h2>
        <p>
          Signed-in conversations sync across the web, CLI, and desktop under
          your Freecoda account. Titles, messages, responses, and structured tool
          results are stored encrypted in our application database until you
          delete them. Local workspace paths are not part of the cloud
          conversation record. Sync includes the context already submitted in
          a conversation; it does not automatically upload other source files.
        </p>
        <p>
          Each client keeps a local offline copy. Anyone with access to your
          browser profile or device account may be able to read that copy.
          Offline changes sync when connectivity returns. Concurrent edits are
          preserved as separate copies rather than silently overwriting another
          device. Coding conversations can be read in browser chat; continuing
          a local coding task still requires explicitly trusting its folder.
        </p>
        <p>
          Delete a conversation to remove its active cloud record and propagate
          deletion to your signed-in clients on their next sync. Offline devices
          can retain a cached copy until they reconnect; clearing only browser
          storage does not delete the cloud record. Encrypted recovery backups
          can retain a prior copy until their scheduled expiry, currently seven
          days. Provider records or training datasets are separate and are not
          erased by a Freecoda conversation deletion. Advertisers do not receive
          your messages.
        </p>
        <h2 id="cloud-workspaces">Cloud workspaces</h2>
        <p>
          Cloud workspaces are optional and require explicit consent before
          creating a project or starting an agent run. Project files, chat
          prompts and responses, diffs, and command output are stored in
          encrypted cloud records for up to seven days after last activity. Code
          executes in an isolated cloud sandbox. This content leaves your
          machine and is sent to the model provider when needed to complete your
          task.
        </p>
        <p>
          Do not put secrets or private customer data in a cloud project. Only
          GitHub repositories you select for the Freecoda GitHub App can be
          imported. GitHub credentials stay on the server and are not provided
          to the sandbox or agent. A private preview uses short-lived access.
          Publishing requires reviewing the diff and explicitly confirming a
          branch and draft pull request; the agent cannot merge or deploy it.
        </p>
        <p>
          Cloud workspaces share the free service’s capacity and may suspend
          when idle or when limits are reached. Suspending stops compute; it
          does not immediately delete saved project content. You can delete a
          cloud project to remove its content and stop its preview. Existing
          GitHub repositories and pull requests are unaffected.
        </p>
        <h2>What leaves your machine</h2>
        <p>
          AI inference requires sending your prompt and the relevant source
          excerpts, repository instructions, and tool output to a model
          provider. Hosted requests pass through Freecoda and our AI gateway
          to our hosted inference provider using server-side
          authentication. This is not an offline
          product. Review your repository trust and tool approval prompts before
          sharing context.
        </p>
        <h2>Hosted AI training and retention</h2>
        <p>
          Hosted inference uses our configured AI provider through an AI gateway.
          This route permits provider prompt training and does not provide a
          no-training or zero-data-retention guarantee. The provider may retain
          and use your submitted prompts, conversation context, source excerpts,
          tool output, and generated responses for training or operational
          purposes. Freecoda does not train its own models on this content.
        </p>
        <p>
          Do not send secrets, private customer data, or content requiring
          stronger provider privacy guarantees. Deleting local history or a
          Freecoda account does not establish deletion from provider records or
          training datasets. Direct-provider CLI use follows that provider’s
          agreement and settings instead.
        </p>
        <h2>Ads and sponsorship</h2>
        <p>
          Sponsor cards are separate from agent responses. When no sponsor
          campaign is active, we show a labeled Freecoda announcement without
          counting a paid impression. Advertisers do not receive source code,
          prompts, or conversations. Sponsor measurement is described below.
        </p>
        <h2>Website analytics</h2>
        <p>
          Vercel Web Analytics measures page views and traffic using cookie-free
          analytics. Vercel Speed Insights measures page loading,
          responsiveness, and visual stability. This is separate from sponsor
          measurement and does not include prompts, source code, or conversation
          content.
        </p>
        <h2>Accounts and usage</h2>
        <p>
          We retain your GitHub identity and email, authorized device records,
          invitation status, and usage metadata to operate the service. The free
          hosted beta does not collect payment cards or sell credits. Signed-in conversation history stores the message content described
          above in encrypted application records. Operational logs do not
          intentionally include conversation content. Optional
          cloud workspaces retain the project content described above for up to
          seven days after last activity.
        </p>
        <h2>Sponsor placements</h2>
        <p>
          Direct sponsors appear in labeled placements, separate from model
          output. Ads are selected by placement and active campaign, not your
          prompts, code, identity, or repository. We count aggregate deliveries
          and clicks using short-lived random ad tokens. These tokens identify
          an ad delivery, not a person. No advertising cookies or third-party
          tracking pixels are used. Freecoda announcements are not billed as
          sponsor impressions.
        </p>
        <h2>Your choices</h2>
        <p>
          You can revoke CLI devices in your settings and delete synced
          conversations from your clients. Local cache removal and account
          conversation deletion are different actions. Deleting your account removes active sessions and
          access; records required for fraud prevention or legal obligations may
          be retained. BYOK use is governed by your provider’s agreement and
          settings.
        </p>
        <h2>Preview status</h2>
        <p>
          Hosted access is limited to invited beta accounts and available daily
          capacity. Hosted requests use the approved free AI service.
          Privacy changes will be reflected here
          before new data uses begin.
        </p>
      </article>
    </main>
  );
}
