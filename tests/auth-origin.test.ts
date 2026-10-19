import { expect, test } from "bun:test";
import { authBaseURL } from "../apps/web/lib/config";

test("local auth accepts only the configured host and private SSH tunnel host", () => {
  expect(authBaseURL("http://127.0.0.1:3010", "development")).toEqual({
    allowedHosts: ["127.0.0.1:3010", "127.0.0.1:13010"],
    fallback: "http://127.0.0.1:3010",
    protocol: "http",
  });
  expect(authBaseURL("http://localhost:3010", "test")).toEqual({
    allowedHosts: ["localhost:3010", "127.0.0.1:13010"],
    fallback: "http://localhost:3010",
    protocol: "http",
  });
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
