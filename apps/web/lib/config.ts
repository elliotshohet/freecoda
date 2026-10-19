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
 * During local development, support the private SSH tunnel used by the Air
 * browser to reach the Mini. Better Auth derives OAuth callback URLs from the
 * request host, so this exact loopback host must be explicitly allowed. The
 * production configuration remains a fixed canonical URL.
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
    allowedHosts: [...new Set([configured.host, "127.0.0.1:13010"])],
    fallback: configuredURL,
    protocol: "http" as const,
  };
}
