/**
 * A plain description of a browser user-agent string for the signed-in
 * sessions list ("Chrome on macOS", "sNeek app on iPhone"). Only what the
 * string says: anything not recognised is "Browser" / "device not recorded",
 * never a guess. PURE.
 */

export type DeviceLabel = {
  /** "Chrome on macOS", or null when the device was not recorded. */
  label: string | null;
  kind: "desktop" | "phone" | "unknown";
};

const BROWSERS: Array<[RegExp, string]> = [
  [/sNeek|Expo/i, "sNeek app"],
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string, DeviceLabel["kind"]]> = [
  [/iPhone/, "iPhone", "phone"],
  [/iPad/, "iPad", "phone"],
  [/Android/, "Android", "phone"],
  [/Mac OS X|Macintosh/, "macOS", "desktop"],
  [/Windows/, "Windows", "desktop"],
  [/CrOS/, "ChromeOS", "desktop"],
  [/Linux/, "Linux", "desktop"],
];

export function describeUserAgent(userAgent: string | null | undefined): DeviceLabel {
  const text = (userAgent ?? "").trim();
  if (!text) return { label: null, kind: "unknown" };
  const browser = BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const system = SYSTEMS.find(([pattern]) => pattern.test(text)) ?? null;
  if (!browser && !system) return { label: null, kind: "unknown" };
  const name = browser ?? "Browser";
  return { label: system ? `${name} on ${system[1]}` : name, kind: system?.[2] ?? "unknown" };
}
