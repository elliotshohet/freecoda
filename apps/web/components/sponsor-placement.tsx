"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
type Ad = {
  id: string | null;
  sponsor: string;
  headline: string;
  description: string;
  href: string;
  token?: string;
};
const house: Ad = {
  id: null,
  sponsor: "Freecoda announcement",
  headline: "Good tools deserve a little room.",
  description:
    "Put your business in front of people who love to build. Help keep Freecoda free.",
  href: "/advertise",
};
export function SponsorPlacement({
  placement = "web",
}: {
  placement?: "web" | "terminal";
}) {
  const [ad, setAd] = useState<Ad>(house);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    void fetch(`/api/v1/ads?placement=${placement}`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : house))
      .then((d) => {
        if (active) setAd(d);
      })
      .catch(() => {});
    return () => {
      active = false;
      abort.abort();
    };
  }, [placement]);
  useEffect(() => {
    if (!ad.token || !box.current) return;
    let sent = false;
    const token = ad.token;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !sent &&
          entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)
        ) {
          sent = true;
          void fetch("/api/v1/ads/impression", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            keepalive: true,
          }).catch(() => {});
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [ad.token]);
  return (
    <aside
      className="sponsor"
      ref={box}
      aria-label={ad.id ? "Paid sponsor placement" : "Freecoda announcement"}
    >
      <span className="sponsor-label">{ad.id ? "Sponsored" : ad.sponsor}</span>
      <div className="sponsor-copy">
        <strong>{ad.headline}</strong>
        <p>{ad.description}</p>
        {ad.id && <span className="sponsor-subtle">By {ad.sponsor}</span>}
      </div>
      <a
        className="sponsor-link"
        href={ad.href}
        rel={ad.id ? "sponsored noopener noreferrer" : undefined}
        target={ad.id ? "_blank" : undefined}
      >
        {ad.id ? "Visit sponsor" : "Sponsor Freecoda"}
        <ArrowUpRight size={13} />
      </a>
    </aside>
  );
}
