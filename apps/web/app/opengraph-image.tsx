import { ImageResponse } from "next/og";

export const alt = "Freecoda — Free, open-source AI coding agent for desktop, web, and terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "64px 72px", background: "#f7f6fb", color: "#24212d", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 34, fontWeight: 700 }}>
          <svg width="60" height="60" viewBox="0 0 512 512" aria-hidden="true">
            <rect width="512" height="512" rx="104" fill="#efedfb" />
            <g fill="#6853d8" transform="translate(164 146) skewX(-12)">
              <rect width="220" height="45" rx="5" /><rect y="79" width="156" height="45" rx="5" /><rect y="158" width="92" height="45" rx="5" />
            </g>
          </svg>
          Freecoda
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-3px" }}>Your next idea, free.</div>
          <div style={{ fontSize: 30, color: "#615a72" }}>An open-source AI coding agent.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#6853d8" }}>
          <span>Desktop · Web · Terminal</span><span>freecoda.com</span>
        </div>
      </div>
    ),
    size,
  );
}
