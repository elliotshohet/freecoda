"use client";

import type { CSSProperties, ReactNode } from "react";
import SpotlightCard from "./react-bits/spotlight-card";

const surfaceStyle = {
  "--spotlight-card-surface": "var(--surface)",
  "--spotlight-card-border": "var(--line)",
  "--spotlight-card-shadow": "none",
} as CSSProperties;

export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  return <SpotlightCard className={className} spotlightColor="#9b83fa" intensity={0.16} borderGlow={0.3} ambient={false} flare={false} style={surfaceStyle}>{children}</SpotlightCard>;
}
