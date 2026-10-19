import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { publicConfig, authBaseURL } from "./config";
function createAuth() {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: authBaseURL(),
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    plugins: [nextCookies()],
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  if (!publicConfig().auth) return null;
  return (instance ??= createAuth());
}
export async function sessionUser(request: Request) {
  return (
    (await getAuth()?.api.getSession({ headers: request.headers }))?.user ??
    null
  );
}
