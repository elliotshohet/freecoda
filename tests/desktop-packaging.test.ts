import { test, expect } from "bun:test";
import { packagingArguments } from "../apps/desktop/src/package-options";
test("packaging always sends exactly one publish-never policy", () => {
  expect(packagingArguments(["--", "--mac", "dmg", "--x64", "--publish", "never"])).toEqual(["--mac", "dmg", "--x64", "--publish", "never"]);
  expect(packagingArguments(["--linux", "AppImage", "--publish=always", "-p", "onTag", "--publish", "always"])).toEqual(["--linux", "AppImage", "--publish", "never"]);
  expect(() => packagingArguments(["publish"])).toThrow("reviewed release workflow");
});
