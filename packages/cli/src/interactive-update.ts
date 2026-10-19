import { checkUpdate, installationPrefix, newerVersion } from "./update";

export async function prepareInteractiveUpdate(options: {
  entry?: string;
  queued?: number;
  interactive: boolean;
  check?: () => Promise<string>;
  confirm: (version: string) => Promise<boolean>;
}): Promise<{ version?: string; message: string }> {
  // Reject source and project installs before any network request or confirmation.
  try { await installationPrefix(options.entry); }
  catch { return { message: "This is a source checkout or unsupported local installation. Update your checkout explicitly, then rebuild; /update never overwrites source code." }; }
  if (options.queued) return { message: "Review or finish queued requests before updating. Nothing was installed." };
  const version = await (options.check || checkUpdate)();
  if (!newerVersion(version)) return { message: "Freecoda CLI is up to date." };
  if (!options.interactive) return { message: `Freecoda ${version} is available. Use an interactive /update or freecoda update --install.` };
  if (!await options.confirm(version)) return { message: "Update cancelled. Nothing was installed." };
  return { version, message: `Closing this saved session to install Freecoda ${version}. Start Freecoda again after installation.` };
}
