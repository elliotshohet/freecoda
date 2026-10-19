"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { githubRepositoryUrl } from "@/lib/github-stars";
import styles from "./github-stars.module.css";

export function GitHubStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/github-stars", { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (typeof data?.stars === "number" && Number.isSafeInteger(data.stars) && data.stars >= 0) setStars(data.stars);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <a className={styles.link} href={githubRepositoryUrl} target="_blank" rel="noopener noreferrer" aria-label={stars === null ? "Freecoda on GitHub" : `Freecoda on GitHub · ${stars.toLocaleString("en-US")} ${stars === 1 ? "star" : "stars"}`} title="Freecoda on GitHub">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.104.769-.244.769-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.79-1.51-3.79-1.51-.512-1.3-1.25-1.647-1.25-1.647-1.022-.7.077-.686.077-.686 1.13.08 1.725 1.16 1.725 1.16 1.004 1.72 2.634 1.223 3.276.935.103-.727.393-1.223.715-1.504-2.5-.285-5.13-1.25-5.13-5.566 0-1.23.44-2.235 1.16-3.023-.117-.285-.503-1.43.11-2.98 0 0 .944-.303 3.094 1.154a10.8 10.8 0 0 1 5.634 0c2.148-1.457 3.09-1.154 3.09-1.154.615 1.55.228 2.695.112 2.98.722.788 1.158 1.793 1.158 3.023 0 4.328-2.634 5.278-5.143 5.557.404.35.764 1.042.764 2.1 0 1.516-.014 2.74-.014 3.11 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" /></svg>
      {stars !== null && <span className={styles.count}><Star size={12} aria-hidden="true" />{stars.toLocaleString("en-US")}</span>}
    </a>
  );
}
