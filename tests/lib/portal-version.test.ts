import { describe, it, expect } from "vitest";
import {
  effectivePortalVersion,
  isPortalRoot,
  parsePortalVersion,
  portalRootIn,
  versionOfPath,
  type PortalVersion,
} from "@/lib/portal-version";

/**
 * These functions decide redirects in middleware, so the property that matters
 * most is that they can never send a request to the URL it is already on — an
 * infinite redirect would take the whole app down for everyone at once.
 */

const ROOT_PAIRS: [string, string][] = [
  ["/admin", "/v2/admin"],
  ["/cleaner", "/v2/cleaner"],
  ["/client", "/v2/client"],
  ["/laundry", "/v2/laundry"],
  ["/qa", "/v2/qa"],
  ["/maintenance", "/v2/maintenance"],
];

describe("portalRootIn", () => {
  it("maps every v1 root to its v2 twin and back", () => {
    for (const [v1, v2] of ROOT_PAIRS) {
      expect(portalRootIn(v1, "v2")).toBe(v2);
      expect(portalRootIn(v2, "v1")).toBe(v1);
    }
  });

  it("NEVER returns the path it was given — the loop guard", () => {
    for (const [v1, v2] of ROOT_PAIRS) {
      // Already in the requested version → no redirect at all.
      expect(portalRootIn(v1, "v1")).toBeNull();
      expect(portalRootIn(v2, "v2")).toBeNull();
    }
    // And exhaustively: whatever comes back, it is never the input.
    for (const version of ["v1", "v2"] as PortalVersion[]) {
      for (const [v1, v2] of ROOT_PAIRS) {
        for (const path of [v1, v2]) {
          expect(portalRootIn(path, version)).not.toBe(path);
        }
      }
    }
  });

  it("leaves deep links alone so bookmarks never break", () => {
    for (const path of [
      "/admin/jobs",
      "/admin/settings/pricebook",
      "/v2/admin/jobs",
      "/v2/cleaner/jobs/abc123",
      "/cleaner/jobs/abc123",
      "/v2/qa/reviews",
    ]) {
      expect(portalRootIn(path, "v1"), path).toBeNull();
      expect(portalRootIn(path, "v2"), path).toBeNull();
    }
  });

  it("ignores unrelated and public paths", () => {
    for (const path of ["/", "/login", "/v2/login", "/quote", "/blog/post", "/adminish"]) {
      expect(portalRootIn(path, "v2"), path).toBeNull();
      expect(portalRootIn(path, "v1"), path).toBeNull();
    }
  });

  it("treats a trailing slash as the same root", () => {
    expect(portalRootIn("/cleaner/", "v2")).toBe("/v2/cleaner");
    expect(portalRootIn("/v2/cleaner/", "v1")).toBe("/cleaner");
  });

  it("does not match a prefix of a longer segment", () => {
    // "/adminish" must not be treated as the "/admin" root.
    expect(isPortalRoot("/adminish")).toBe(false);
    expect(isPortalRoot("/admin")).toBe(true);
  });
});

describe("versionOfPath", () => {
  it("classifies by the /v2 prefix only", () => {
    expect(versionOfPath("/v2")).toBe("v2");
    expect(versionOfPath("/v2/admin")).toBe("v2");
    expect(versionOfPath("/admin")).toBe("v1");
    expect(versionOfPath("/")).toBe("v1");
    // Not a /v2 segment.
    expect(versionOfPath("/v2beta")).toBe("v1");
  });
});

describe("effectivePortalVersion", () => {
  it("lets a personal choice beat the house default", () => {
    expect(effectivePortalVersion("v2", "v1")).toBe("v1");
    expect(effectivePortalVersion("v1", "v2")).toBe("v2");
  });

  it("falls back to the house default with no personal choice", () => {
    expect(effectivePortalVersion("v2", null)).toBe("v2");
    expect(effectivePortalVersion("v1", null)).toBe("v1");
  });

  it("falls back to the classic app when nothing is known", () => {
    // e.g. the settings lookup failed — routing must not start guessing.
    expect(effectivePortalVersion(undefined, null)).toBe("v1");
  });
});

describe("parsePortalVersion", () => {
  it("accepts only the two known values", () => {
    expect(parsePortalVersion("v1")).toBe("v1");
    expect(parsePortalVersion("v2")).toBe("v2");
    for (const bad of ["v3", "", null, undefined, 2, "V2", "estate", {}]) {
      expect(parsePortalVersion(bad), String(bad)).toBeNull();
    }
  });
});
