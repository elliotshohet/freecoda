"use client";
import { useState } from "react";
export function AdvertiserForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel">
      {done ? (
        <>
          <h2>Your inquiry is in.</h2>
          <p>
            Your details have been saved for review. No campaign is running and
            no payment has been taken.
          </p>
        </>
      ) : (
        <form
          className="advertiser-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/v1/sponsor/inquiry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(form)),
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error);
              setDone(true);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not save your inquiry.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>Tell us about your business.</h2>
          <label className="field">
            Business name
            <input name="business" required maxLength={100} />
          </label>
          <label className="field">
            Work email
            <input type="email" name="email" required maxLength={200} />
          </label>
          <label className="field">
            Website
            <input
              type="url"
              name="website"
              required
              placeholder="https://"
              maxLength={500}
            />
          </label>
          <label className="field">
            What would you like to sponsor?
            <textarea
              name="message"
              required
              minLength={10}
              maxLength={2000}
              rows={4}
            />
          </label>
          <label className="honeypot" aria-hidden="true">
            Leave this blank
            <input name="companyUrl" tabIndex={-1} autoComplete="off" />
          </label>
          <button className="button purple" disabled={busy}>
            {busy ? "Saving inquiry…" : "Send inquiry"}
          </button>
          <p className="form-caption">
            We use these details to review your inquiry. Sending this form does
            not start a campaign or charge you.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
