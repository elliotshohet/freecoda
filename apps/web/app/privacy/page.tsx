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
        <p className="legal-updated">Preview policy · October 17, 2026</p>
        <p>
          Freecoda is built around local execution, clear permissions, and
          straightforward data use. We do not sell your source code or
          conversations, train models on your content, or share it with
          advertisers.
        </p>
        <h2>What stays on your machine</h2>
        <p>
          Your repository, tool execution, and conversation history stay on your
          machine. When you use your own API key, the key is stored locally with
          restrictive file permissions. Direct provider requests bypass
          Freecoda.
        </p>
        <h2>What leaves your machine</h2>
        <p>
          AI inference requires sending your prompt and the relevant source
          excerpts, repository instructions, and tool output to a model
          provider. Hosted requests pass through Freecoda and Vercel AI Gateway.
          This is not an offline product. Review your repository trust and tool
          approval prompts before sharing context.
        </p>
        <h2>No training on hosted prompts</h2>
        <p>
          Hosted requests require gateway routes that disallow prompt training.
          Requests fail when no compliant provider is available. This
          restriction is different from zero data retention: infrastructure and
          providers may retain operational or abuse-prevention data according to
          their policies.
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
          hosted beta does not collect payment cards or sell credits. We do not
          persist prompts, responses, source code, or tool output in our
          application database or application logs.
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
          The hosted service remains closed until provider routing and
          infrastructure logging are verified. The model and provider shown in
          the CLI are the ones configured for your session. Privacy changes will
          be reflected here before new data uses begin.
        </p>
      </article>
    </main>
  );
}
