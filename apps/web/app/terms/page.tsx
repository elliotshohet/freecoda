import { publicPageMetadata } from "@/lib/seo";
export const metadata = publicPageMetadata({
  title: "Terms of Service",
  description: "Review Freecoda’s terms for the free coding agent, including beta access, usage limits, sponsor placements, content rights, and account controls.",
  path: "/terms",
});
export default function Terms() {
  return (
    <main className="page-shell" id="main">
      <article className="prose">
        <span className="section-kicker">A straightforward agreement</span>
        <h1>Build thoughtfully.</h1>
        <p className="legal-updated">Preview terms · October 17, 2026</p>
        <p>
          Freecoda is experimental software. Review generated code and commands
          before approving them, keep backups, and run your project’s checks.
          You remain responsible for changes and deployments.
        </p>
        <h2>One free plan</h2>
        <p>
          Freecoda is supported by direct sponsors. There are no user
          subscriptions, credit packs, or paid upgrades. Hosted access is
          invite-only during beta and subject to fair-use limits, capacity,
          model availability, and regional provider availability. Unused daily
          allowances do not roll over. We may pause hosted requests when funded
          capacity is exhausted.
        </p>
        <h2>Sponsor placements</h2>
        <p>
          Clearly labeled sponsor messages appear on the website and between
          terminal turns. Sponsors do not control model answers or generated
          code. Advertising links lead to external services governed by their
          own terms. A sponsor placement is not a guarantee or endorsement of a
          product.
        </p>
        <h2>Your content and conduct</h2>
        <p>
          You retain your rights to your inputs and are responsible for having
          permission to process them. Do not misuse the service, bypass usage
          controls, share device credentials, or submit content you are not
          authorized to use. Third-party software and generated dependencies
          retain their own licenses.
        </p>
        <h2>Availability and account controls</h2>
        <p>
          You may revoke devices and delete your account from your workspace. We
          may suspend access to address abuse or security issues. The preview is
          provided as available, without a guarantee of uninterrupted access or
          correct generated output. Direct provider mode, if configured, uses
          your own provider agreement and may incur provider charges; Freecoda
          does not collect those charges.
        </p>
      </article>
    </main>
  );
}
