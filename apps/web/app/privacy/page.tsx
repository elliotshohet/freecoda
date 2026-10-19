export const metadata = { title: "Privacy" };
export default function Privacy() {
  return (
    <main className="page-shell" id="main">
      <article className="prose">
        <span className="section-kicker">Our promise</span>
        <h1>
          Your ideas belong
          <br />
          to you.
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
          When you use the local CLI, your repository, tool execution, and
          conversation history stay on your machine. When you use your own API
          key, the key is stored locally with restrictive file permissions.
          Direct provider requests bypass Freecoda.
        </p>
        <h2>Browser conversations</h2>
        <p>
          Browser chat saves conversations in this browser's local storage. They
          do not sync between devices. Anyone with access to your browser profile
          may be able to read that history; avoid sensitive information on shared
          devices. Delete a conversation from the sidebar to remove its local
          copy. Sending a message shares that conversation's context with Freecoda,
          Vercel AI Gateway, and the selected model provider. We retain usage
          accounting, but do not save browser chat content in our application
          database. Deleting local history does not delete provider operational
          records described below. Advertisers do not receive your messages.
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
          provider. Hosted requests pass through Freecoda and Vercel AI Gateway
          to Reflection’s Beam Free model using server-side Gateway
          authentication. This is not an offline
          product. Review your repository trust and tool approval prompts before
          sharing context.
        </p>
        <h2>Hosted model training and retention</h2>
        <p>
          Hosted inference uses Reflection Beam Free through Vercel AI Gateway.
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
          hosted beta does not collect payment cards or sell credits. For local
          CLI inference, we do not persist prompts, responses, source code, or
          tool output in our application database or application logs. Optional
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
          You can revoke CLI devices in your workspace and clear local history
          with the CLI. Deleting your account removes active sessions and
          access; records required for fraud prevention or legal obligations may
          be retained. BYOK use is governed by your provider’s agreement and
          settings.
        </p>
        <h2>Preview status</h2>
        <p>
          Hosted access is limited to invited beta accounts and available daily
          capacity. The model and provider shown in the CLI are the ones
          configured for your session. Privacy changes will be reflected here
          before new data uses begin.
        </p>
      </article>
    </main>
  );
}
