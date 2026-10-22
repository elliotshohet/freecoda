export type ThemePreference = "system" | "light" | "dark";
export type InterfaceSize = "small" | "standard" | "large";

export const themePreferenceStorageKey = "freecoda-theme";
export const themePreferenceEvent = "freecoda-theme";
export const interfaceSizeStorageKey = "freecoda-interface-size";
export const interfaceSizeEvent = "freecoda-interface-size";

const interfaceScale: Record<InterfaceSize, number> = {
  small: 0.92,
  standard: 1,
  large: 1.1,
};

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function parseInterfaceSize(value: unknown): InterfaceSize {
  return value === "small" || value === "large" ? value : "standard";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function scaleForInterfaceSize(size: InterfaceSize): number {
  return interfaceScale[size];
}
