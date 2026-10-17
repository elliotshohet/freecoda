import { describe, expect, test } from "bun:test";
import { APP_URL, assetPath, externalURL, isAppDocument } from "../apps/desktop/src/security";
describe("desktop privilege boundary", () => {
  test("only the main local document receives privileged IPC", () => {
    expect(isAppDocument(APP_URL)).toBe(true);
    for (const value of ["https://freecoda.com/app", "freecoda://evil/index.html", "freecoda://desktop/index.html?remote=1", "file:///index.html", "freecoda://desktop/renderer.js"])
      expect(isAppDocument(value)).toBe(false);
  });
  test("custom protocol only serves bundled assets", () => {
    expect(assetPath(APP_URL)).toBe("index.html");
    for (const value of ["freecoda://desktop/../../.env", "freecoda://desktop/main.cjs", "freecoda://desktop/preload.cjs", "freecoda://desktop/%2e%2e/.env", "https://desktop/index.html"])
      expect(assetPath(value)).toBeNull();
  });
  test("OS URL opening cannot execute custom protocols or arbitrary origins", () => {
    expect(externalURL("https://freecoda.com/app")).toBe("https://freecoda.com/app");
    for (const value of ["javascript:alert(1)", "file:///etc/passwd", "https://freecoda.com.evil.test", "https://evil.test", "https://a:secret@freecoda.com", "http://freecoda.com"]) expect(() => externalURL(value)).toThrow();
  });
});
