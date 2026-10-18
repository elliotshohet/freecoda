import type { Approval } from "@freecoda/core";
export type PermissionPreset = "read-only" | "default" | "full-access";
export const PERMISSION_PRESETS = [
  {
    id: "read-only",
    label: "Read only",
    description: "Read files; no edits or shell commands",
  },
  {
    id: "default",
    label: "Default",
    description: "Ask before edits and shell commands",
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Allow edits and shell commands without asking",
  },
] as const;
export function permissionPreset(value: string): PermissionPreset | undefined {
  return (
    {
      "1": "read-only",
      "2": "default",
      "3": "full-access",
      "read-only": "read-only",
      "read only": "read-only",
      default: "default",
      "full-access": "full-access",
      "full access": "full-access",
    } as Record<string, PermissionPreset>
  )[value.trim().toLowerCase()];
}
export class SessionPermissions {
  private selected: PermissionPreset = "default";
  private grants = new Set<Parameters<Approval>[0]>();
  private revision = 0;
  constructor(
    private confirm: (
      kind: Parameters<Approval>[0],
      description: string,
    ) => Promise<string>,
    private changed: (description: string) => void = () => {},
  ) {}
  get preset() {
    return this.selected;
  }
  setPreset(preset: PermissionPreset) {
    this.selected = preset;
    this.grants.clear();
    this.revision++;
    this.changed(this.describe());
  }
  describe() {
    if (this.selected === "read-only")
      return "Read only · no edits or commands";
    if (this.selected === "full-access")
      return "Full access · edits and commands allowed";
    if (this.grants.has("write") && this.grants.has("shell"))
      return "Default · edits and commands allowed this session";
    if (this.grants.has("write"))
      return "Default · edits allowed this session; ask before commands";
    if (this.grants.has("shell"))
      return "Default · commands allowed this session; ask before edits";
    return "Default · ask before edits and commands";
  }
  effectiveMode(mode: "chat" | "build" | "plan" | "review") {
    return this.selected === "read-only" && mode === "build" ? "plan" : mode;
  }
  approve: Approval = async (kind, description) => {
    if (this.selected === "read-only") return false;
    if (this.selected === "full-access" || this.grants.has(kind)) return true;
    const revision = this.revision;
    const answer = (await this.confirm(kind, description)).trim().toLowerCase();
    // A pending answer cannot grant a category after the policy was changed.
    if (revision !== this.revision) return false;
    if (answer === "s") {
      this.grants.add(kind);
      this.changed(this.describe());
      return true;
    }
    return answer === "y";
  };
}
