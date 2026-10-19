"use client";

import { useEffect, useState } from "react";
import { GitHubIcon } from "./github-icon";
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
    <a className={`${styles.link} github-stars-control`} href={githubRepositoryUrl} target="_blank" rel="noopener noreferrer" aria-label={stars === null ? "Freecoda on GitHub" : `Freecoda on GitHub · ${stars.toLocaleString("en-US")} ${stars === 1 ? "star" : "stars"}`} title="Freecoda on GitHub">
      <GitHubIcon size={17} />
      {stars !== null && <span className={styles.count}><Star size={12} aria-hidden="true" />{stars.toLocaleString("en-US")}</span>}
    </a>
  );
}
