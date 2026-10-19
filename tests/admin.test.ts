import { expect, test } from "bun:test";
import { configuredAdminIds, adminAccountAllowed, adminPeriod, requireAdmin } from "../apps/web/lib/admin";
test("administrator access requires an explicit immutable GitHub identity", () => {
  expect(adminAccountAllowed(["252225385"], configuredAdminIds(""))).toBe(false);
  expect(adminAccountAllowed(["252225385"], configuredAdminIds("252225385"))).toBe(true);
  expect(adminAccountAllowed(["other", "2522253850"], configuredAdminIds("252225385"))).toBe(false);
  expect([...configuredAdminIds("*, admin@example.com,252225385, invalid")]).toEqual(["252225385"]);
  expect(adminAccountAllowed([], configuredAdminIds("252225385"))).toBe(false);
});
test("administrator periods are bounded and device credentials are rejected before database access", async () => {
  expect(adminPeriod(undefined)).toBe(30);
  expect(adminPeriod("7")).toBe(7);
  expect(() => adminPeriod("36500")).toThrow();
  expect(() => adminPeriod("7; SELECT 1")).toThrow();
  await expect(requireAdmin(new Request("http://localhost/api/admin/metrics", { headers: { Authorization: "Bearer fixture" } }))).rejects.toMatchObject({ status: 403 });
});
