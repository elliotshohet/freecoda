import { AdvertiserForm } from "@/components/advertiser-form";
export const metadata = { title: "Sponsor Freecoda" };
export default function Advertise() {
  return (
    <main className="page-shell" id="main">
      <div className="page-intro">
        <span className="section-kicker">
          A little space. A lot of possibility.
        </span>
        <h1>
          Help good ideas
          <br />
          get built.
        </h1>
        <p>
          Sponsor Freecoda and reach developers in a quiet, clearly labeled
          placement. Your support keeps the coding agent free.
        </p>
      </div>
      <div className="sponsor-grid">
        <article className="prose">
          <h2>Built for people who build.</h2>
          <p>
            Direct sponsor messages appear on the website and between agent
            turns in the terminal. We review every campaign, and keep sponsor
            messages out of model answers and generated code.
          </p>
          <h2>Simple placements. Clear reporting.</h2>
          <p>
            Text placements include your name, a headline, a short description,
            and a link. Reporting covers aggregate deliveries and clicks. We
            don’t use private code or conversations for targeting, and we don’t
            install advertising cookies.
          </p>
          <h2>Let’s find a good fit.</h2>
          <p>
            Tell us what you do, who it helps, and where you’d like to appear.
            This is an inquiry, not a purchase. We’ll review availability before
            any campaign runs.
          </p>
        </article>
        <AdvertiserForm />
      </div>
    </main>
  );
}
