import type { Metadata } from "next";

export const SITE_URL = "https://freecoda.com";
export const SITE_DESCRIPTION =
  "Free, open-source AI coding agent for desktop, web, and terminal. Supported by ads. Build with explicit permissions. Hosted beta is invite-only.";

export function publicPageMetadata({ title, description, path }: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = new URL(path, SITE_URL).href;
  const socialTitle = `${title} · Freecoda`;
  const images = [{
    url: `${SITE_URL}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: "Freecoda — Free, open-source AI coding agent for desktop, web, and terminal",
  }];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Freecoda",
      locale: "en_US",
      url,
      title: socialTitle,
      description,
      images,
    },
    twitter: { card: "summary_large_image", title: socialTitle, description, images },
  };
}

export const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "Freecoda",
      description: SITE_DESCRIPTION,
      inLanguage: "en",
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${SITE_URL}/#source`,
      name: "Freecoda",
      description: SITE_DESCRIPTION,
      url: `${SITE_URL}/`,
      codeRepository: "https://github.com/elliotshohet/freecoda",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      programmingLanguage: "TypeScript",
      runtimePlatform: ["macOS", "Windows", "Linux", "Web browser"],
      image: `${SITE_URL}/images/freecoda-desktop-0.1.8-preview.webp`,
      isAccessibleForFree: true,
    },
  ],
};
