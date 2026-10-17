import { z } from "zod";
import c from "picocolors";
import type { SponsorBanner } from "./ui";
import { validateBaseURL } from "@freecoda/core";
const adSchema = z.object({
  id: z.string().nullable(),
  sponsor: z.string().max(60),
  headline: z.string().max(90),
  description: z.string().max(180),
  href: z.string().max(1200),
  token: z.string().max(800).optional(),
});
const plain = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export async function showSponsor(
  server: string,
  render?: (ad: SponsorBanner) => boolean | void,
) {
  try {
    const base = validateBaseURL(server);
    const res = await fetch(`${base}/api/v1/ads?placement=terminal`, {
      signal: AbortSignal.timeout(4000),
      redirect: "error",
    });
    if (!res.ok) return;
    const ad = adSchema.parse(await res.json());
    const link = new URL(ad.href, base);
    if (link.origin !== new URL(base).origin) return;
    if (link.username || link.password) return;
    const banner: SponsorBanner = {
      label: ad.id
        ? "Sponsored by " + plain(ad.sponsor)
        : "Freecoda announcement",
      headline: plain(ad.headline),
      description: plain(ad.description),
      href: link.toString(),
    };
    if (render) {
      if (render(banner) === false) return;
    } else
      console.log(
        c.dim(
          `\n  ${banner.label}\n  ${banner.headline}\n  ${banner.description}\n  ${banner.href}\n`,
        ),
      );
    if (ad.id && ad.token)
      await fetch(`${base}/api/v1/ads/impression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: ad.token }),
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
  } catch {
    /* Sponsor availability never prevents a coding turn. */
  }
}
