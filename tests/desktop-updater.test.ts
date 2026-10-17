import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { DesktopUpdates } from "../apps/desktop/src/updater";
class FixtureUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  logger: unknown = console;
  checks = 0;
  async checkForUpdates() {
    this.checks++;
    this.emit("update-not-available");
  }
}
test("desktop updater downloads in background and waits for normal app quit", async () => {
  const updater = new FixtureUpdater();
  const notices: string[] = [],
    statuses: [string, boolean][] = [];
  const updates = new DesktopUpdates(updater, {
    packaged: true,
    notify: (message) => notices.push(message),
    showStatus: async (message, downloaded) => {
      statuses.push([message, downloaded]);
    },
  });
  try {
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.logger).toBe(null);
    await Promise.all([updates.check(), updates.check()]);
    expect(updater.checks).toBe(1);
    updater.emit("update-downloaded", {
      releaseName: "untrusted remote content",
    });
    expect(notices.length).toBe(1);
    expect(statuses.length).toBe(0); // No interruption or restart prompt during work.
    await updates.status();
    expect(statuses[0][1]).toBe(true);
    expect(statuses[0][0]).not.toContain("untrusted");
    await updates.check();
    expect(updater.checks).toBe(1);
  } finally {
    updates.dispose();
  }
  expect(updater.listenerCount("update-downloaded")).toBe(0);
});
test("desktop updater never exposes remote diagnostics or checks development builds", async () => {
  const updater = new FixtureUpdater();
  const statuses: string[] = [];
  const updates = new DesktopUpdates(updater, {
    packaged: false,
    notify: () => {},
    showStatus: async (message) => {
      statuses.push(message);
    },
  });
  try {
    updates.start();
    await updates.check(true);
    expect(updater.checks).toBe(0);
    updater.emit(
      "error",
      new Error("Authorization: Bearer secret-token https://private.invalid"),
    );
    await updates.status();
    expect(statuses.at(-1)).not.toContain("secret-token");
    expect(statuses.at(-1)).not.toContain("private.invalid");
  } finally {
    updates.dispose();
  }
});

test("unsigned macOS builds clearly report manual installation and never auto-download", async () => {
  const updater = new FixtureUpdater();
  let status = "";
  const reason = "Automatic updates require a Developer ID-signed macOS build.";
  const updates = new DesktopUpdates(updater, {
    packaged: true,
    unavailableReason: reason,
    notify: () => {},
    showStatus: async (message) => {
      status = message;
    },
  });
  try {
    updates.start();
    await updates.check(true);
    expect(updater.checks).toBe(0);
    expect(status).toBe(reason);
  } finally {
    updates.dispose();
  }
});
