import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentService } from "../apps/desktop/src/local-agent";
const paid = {
  id: "campaign-fixture",
  sponsor: "Fixture sponsor",
  headline: "Build something useful",
  description: "A synthetic paid placement for tests only.",
  token: "signed-fixture",
  href: "/api/v1/ads/click?token=signed-fixture",
};
async function fixture(ad: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-sponsor-"));
  await writeFile(
    path.join(directory, "desktop.json"),
    JSON.stringify({
      server: "https://freecoda.com",
      token: "secret-device-token-abcdefghijklmnopqrstuvwxyz",
      trustedRoots: [],
      recentRoots: [],
    }),
    { mode: 0o600 },
  );
  const requests: { url: string; init: RequestInit | undefined }[] = [],
    opened: string[] = [];
  const service = new LocalAgentService({
    dataDirectory: directory,
    emit: () => {},
    openExternal: async (url) => {
      opened.push(url);
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(
        String(url).includes("/impression") ? { ok: true } : ad,
      );
    },
  });
  return {
    service,
    requests,
    opened,
    close: async () => {
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("sponsor fetch is guest-only and renderer receives public copy, not token/link; visibility counts once", async () => {
  const f = await fixture(paid);
  try {
    const ad = await f.service.getSponsor();
    expect(ad.paid).toBe(true);
    expect(ad.label).toBe("Sponsored by Fixture sponsor");
    expect(JSON.stringify(ad)).not.toContain("signed-fixture");
    expect(JSON.stringify(ad)).not.toContain("href");
    expect(f.requests).toHaveLength(1);
    await f.service.getSponsor();
    expect(f.requests).toHaveLength(1);
    await Promise.all([
      f.service.reportSponsorVisible(),
      f.service.reportSponsorVisible(),
    ]);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1]!.init?.body).toBe(
      JSON.stringify({ token: paid.token }),
    );
    for (const request of f.requests) {
      expect(new Headers(request.init?.headers).has("authorization")).toBe(
        false,
      );
      expect(request.init?.credentials).toBe("omit");
      expect(request.init?.redirect).toBe("error");
      expect(JSON.stringify(request.init)).not.toContain(
        "secret-device-token-abcdefghijklmnopqrstuvwxyz",
      );
    }
    await f.service.openSponsor();
    expect(f.opened).toEqual(["https://freecoda.com" + paid.href]);
  } finally {
    await f.close();
  }
});
test("house announcements never count impressions and link to actual advertising page", async () => {
  const f = await fixture({
    id: null,
    sponsor: "Freecoda",
    headline: "Sponsor Freecoda",
    description: "House announcement",
    href: "/advertise",
  });
  try {
    expect((await f.service.getSponsor()).paid).toBe(false);
    await f.service.reportSponsorVisible();
    expect(f.requests).toHaveLength(1);
    await f.service.openSponsor();
    expect(f.opened).toEqual(["https://freecoda.com/advertise"]);
  } finally {
    await f.close();
  }
});
test("rejects untrusted destinations, credentials, mismatched signed links, and invalid copy to safe house fallback", async () => {
  for (const patch of [
    { href: "https://evil.invalid/ad" },
    {
      href: "https://user:pass@freecoda.com/api/v1/ads/click?token=signed-fixture",
    },
    { href: "/api/v1/ads/click?token=wrong" },
    { href: "/app?token=signed-fixture" },
    { headline: "x".repeat(91) },
  ]) {
    const f = await fixture({ ...paid, ...patch });
    try {
      expect((await f.service.getSponsor()).paid).toBe(false);
      await f.service.reportSponsorVisible();
      await f.service.openSponsor();
      expect(f.requests).toHaveLength(1);
      expect(f.opened).toEqual(["https://freecoda.com/advertise"]);
    } finally {
      await f.close();
    }
  }
});
