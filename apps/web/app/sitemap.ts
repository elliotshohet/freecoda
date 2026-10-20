import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/download", "/pricing", "/docs", "/advertise", "/privacy", "/terms"].map(
    (path) => ({ url: new URL(path, "https://freecoda.com").href }),
  );
}
