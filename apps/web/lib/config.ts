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
