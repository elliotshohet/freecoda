"use client";

import { useEffect, useState } from "react";
import BlurText from "./react-bits/blur-text";

export function LandingHeadline() {
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (reducedMotion) return <span>Big ideas. Open possibilities.</span>;
  return <BlurText text="Big ideas. Open possibilities." animateBy="words" delay={90} direction="bottom" distance={20} blur={8} stepDuration={0.28} trigger="load" className="landing-headline-motion" />;
}

