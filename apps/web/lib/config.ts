import { getVercelOidcTokenSync } from "@vercel/oidc";

export function gatewayConfigured() {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  try {
    return Boolean(getVercelOidcTokenSync());
  } catch {
    return false;
  }
}

export const publicConfig = () => ({
  database: !!process.env.DATABASE_URL,
  auth: !!(
    process.env.DATABASE_URL &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET &&
    process.env.BETTER_AUTH_SECRET
  ),
  gateway: gatewayConfigured(),
  inference: gatewayConfigured(),
  hostedEnabled: process.env.HOSTED_INFERENCE_ENABLED === "true",
  ads: !!process.env.DATABASE_URL,
});
export const appUrl = () =>
  process.env.BETTER_AUTH_URL || "http://127.0.0.1:3010";

/**
 * Local development accepts loopback origins on any port, including the
 * private SSH tunnel to the Mini. Production stays on its configured origin.
 */
export function authBaseURL(
  configuredURL = appUrl(),
  environment = process.env.NODE_ENV,
) {
  if (environment === "production") return configuredURL;
  let configured: URL;
  try {
    configured = new URL(configuredURL);
  } catch {
    return configuredURL;
  }
  if (
    configured.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(configured.hostname)
  )
    return configuredURL;
  return {
    allowedHosts: [
      "localhost",
      "localhost:*",
      "127.0.0.1",
      "127.0.0.1:*",
      "[::1]",
      "[::1]:*",
    ],
    fallback: configuredURL,
    protocol: "http" as const,
  };
}
