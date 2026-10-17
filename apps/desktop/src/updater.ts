/** Main-process update controller. No account tokens or provider credentials. */
export interface UpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  logger: unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
}
export interface UpdateHost {
  packaged: boolean;
  unavailableReason?: string;
  notify(message: string): void;
  showStatus(message: string, downloaded: boolean): Promise<void>;
}
export class DesktopUpdates {
  private message = "Updates have not been checked yet.";
  private downloaded = false;
  private checking?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private listeners: [string, (...args: any[]) => void][] = [];
  constructor(
    private readonly updater: UpdaterPort,
    private readonly host: UpdateHost,
  ) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    // SDK diagnostics can contain remote response bodies/URLs. Expose fixed
    // status messages only and do not persist provider diagnostics in logs.
    updater.logger = null;
    const on = (name: string, listener: (...args: any[]) => void) => {
      this.listeners.push([name, listener]);
      updater.on(name, listener);
    };
    on("checking-for-update", () => {
      this.message = "Checking for updates…";
    });
    on("update-available", () => {
      this.message =
        "An update is downloading in the background. You can keep working.";
    });
    on("update-not-available", () => {
      if (!this.downloaded) this.message = "Freecoda is up to date.";
    });
    on("update-downloaded", () => {
      this.downloaded = true;
      this.message =
        "An update is ready. Save your work and close Freecoda normally to install it. Active tasks will never be interrupted automatically.";
      this.host.notify(
        "A Freecoda update is ready. Save your work and close the app when convenient to install it.",
      );
    });
    on("error", () => {
      this.message =
        "Updates could not be checked or downloaded. Try again later. On macOS, automatic updates require a properly signed app.";
    });
  }
  start() {
    if (this.disposed || this.timer) return;
    if (this.host.unavailableReason) {
      this.message = this.host.unavailableReason;
      return;
    }
    if (!this.host.packaged) {
      this.message = "Automatic updates are available in installed builds.";
      return;
    }
    void this.check();
    this.timer = setInterval(
      () => {
        void this.check();
      },
      6 * 60 * 60 * 1000,
    );
    this.timer.unref?.();
  }
  async check(manual = false) {
    if (this.disposed) return;
    if (this.host.unavailableReason) {
      this.message = this.host.unavailableReason;
    } else if (!this.host.packaged) {
      this.message = "Automatic updates are available in installed builds.";
    } else if (!this.downloaded) {
      if (!this.checking) {
        this.checking = (async () => {
          try {
            await this.updater.checkForUpdates();
          } catch {
            this.message =
              "Updates could not be checked or downloaded. Try again later. On macOS, automatic updates require a properly signed app.";
          }
        })().finally(() => {
          this.checking = undefined;
        });
      }
      await this.checking;
    }
    if (manual && !this.disposed) await this.status();
  }
  async status() {
    if (!this.disposed)
      await this.host.showStatus(this.message, this.downloaded);
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    for (const [event, listener] of this.listeners)
      this.updater.removeListener(event, listener);
    this.listeners = [];
  }
}
