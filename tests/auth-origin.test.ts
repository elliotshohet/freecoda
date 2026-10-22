import { expect, test } from "bun:test";
import { authBaseURL } from "../apps/web/lib/config";
import { resolveDynamicBaseURL } from "../apps/web/node_modules/better-auth/dist/utils/url.mjs";

const loopbackHosts = [
  "localhost",
  "localhost:*",
  "127.0.0.1",
  "127.0.0.1:*",
  "[::1]",
  "[::1]:*",
];

test("local auth accepts loopback hosts on any port", () => {
  expect(authBaseURL("http://127.0.0.1:3010", "development")).toEqual({
    allowedHosts: loopbackHosts,
    fallback: "http://127.0.0.1:3010",
    protocol: "http",
  });
  expect(authBaseURL("http://localhost:3010", "test")).toEqual({
    allowedHosts: loopbackHosts,
    fallback: "http://localhost:3010",
    protocol: "http",
  });
});

test("local callbacks retain arbitrary loopback ports without trusting other hosts", () => {
  const config = authBaseURL("http://127.0.0.1:3010", "development");
  if (typeof config === "string") throw new Error("Expected dynamic local auth");
  for (const host of ["localhost:3012", "127.0.0.1:13010", "[::1]:49152"]) {
    expect(
      resolveDynamicBaseURL(config, new Request(`http://${host}/api/auth`), "/api/auth"),
    ).toBe(`http://${host}/api/auth`);
  }
  for (const host of ["localhost.evil.test:3012", "127.0.0.1.evil.test:3012", "evil.test:3010"]) {
    expect(
      resolveDynamicBaseURL(config, new Request(`http://${host}/api/auth`), "/api/auth"),
    ).toBe("http://127.0.0.1:3010/api/auth");
  }
});

test("production auth remains pinned to the canonical configured origin", () => {
  expect(authBaseURL("https://freecoda.com", "production")).toBe(
    "https://freecoda.com",
  );
  expect(authBaseURL("https://preview.freecoda.com", "production")).toBe(
    "https://preview.freecoda.com",
  );
});

test("non-loopback and HTTPS development origins do not gain the tunnel host", () => {
  expect(authBaseURL("https://dev.freecoda.com", "development")).toBe(
    "https://dev.freecoda.com",
  );
});
