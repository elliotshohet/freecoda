import { describe, expect, it } from "bun:test";
import {
  parseInterfaceSize,
  parseThemePreference,
  resolveTheme,
  scaleForInterfaceSize,
} from "../apps/web/app/settings/appearance-preferences-core";

describe("settings appearance preferences", () => {
  it("accepts only the supported theme values and defaults unknown values to system", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("resolves system theme and preserves explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("bounds interface size to the three supported scale values", () => {
    expect(parseInterfaceSize("small")).toBe("small");
    expect(parseInterfaceSize("standard")).toBe("standard");
    expect(parseInterfaceSize("large")).toBe("large");
    expect(parseInterfaceSize("huge")).toBe("standard");
    expect(parseInterfaceSize(null)).toBe("standard");
    expect(scaleForInterfaceSize("small")).toBeGreaterThanOrEqual(0.9);
    expect(scaleForInterfaceSize("large")).toBeLessThanOrEqual(1.1);
  });
});
