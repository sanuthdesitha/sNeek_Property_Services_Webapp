// @vitest-environment node
/**
 * Social post generator (2026-11-17), pure and image parts: deterministic
 * scoring on fixture photos (blurry, dark, duplicate), the cleaned copy (no
 * stamp band, no top strip, no EXIF/GPS, original bytes unchanged), signed
 * public links (only the copy, expiring, tamper-proof), caption limits and
 * the address/name linter, results never "Posted" without a network id.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeFixturePhoto, colourShare, STAMP_COLOUR, TAG_COLOUR } from "../helpers/social-images";
import { measurePhoto, makeSocialCrop, makeBeforeAfterSplit, makeFramedCrop, assertNoMetadata, cleanRegionOf } from "@/lib/marketing/social/image-pipeline";
import { measuredScore, liveScore, ratioFits, BLURRY_BELOW } from "@/lib/marketing/social/scoring-rules";
import { perceptualHash, hammingDistance } from "@/lib/media/photo-integrity";
import { captionProblems, finalCaption, renderNetworkCaption, DEFAULT_SOCIAL_TEMPLATES, templateFor, defaultHashtags } from "@/lib/marketing/social/captions";
import { lintSocialText } from "@/lib/marketing/social/caption-linter";
import { signMediaToken, verifyMediaToken, publicMediaBase } from "@/lib/marketing/social/public-media";
import { networkResultView, SOCIAL_NETWORKS } from "@/lib/marketing/social/networks";
import { officeConsentProblem } from "@/lib/marketing/social/consent-rules";
import { crc32, zipFiles } from "@/lib/marketing/social/zip";

vi.mock("server-only", () => ({}));

let sharpPhoto: Buffer;
let blurryPhoto: Buffer;
let darkPhoto: Buffer;

beforeAll(async () => {
  sharpPhoto = await makeFixturePhoto({ seed: 3 });
  blurryPhoto = await makeFixturePhoto({ seed: 3, blur: 12 });
  darkPhoto = await makeFixturePhoto({ seed: 5, brightness: 0.15 });
}, 60_000);

describe("scoring (sharp, no AI)", () => {
  it("is deterministic: the same photo always scores the same", async () => {
    const first = measuredScore(await measurePhoto(sharpPhoto, "LISTING"));
    const second = measuredScore(await measurePhoto(Buffer.from(sharpPhoto), "LISTING"));
    expect(second).toEqual(first);
    expect(first.leftOut).toBeNull();
    expect(first.points).toBeGreaterThan(45);
    expect(first.reasons.join(" ")).toMatch(/Listing-angle/);
  });

  it("leaves out a blurry photo with the Laplacian in words, and a dark one with its brightness", async () => {
    const blurry = await measurePhoto(blurryPhoto, "FINAL");
    expect(blurry.laplacianVar).toBeLessThan(BLURRY_BELOW);
    expect(measuredScore(blurry).leftOut).toMatch(/^Blurry \(Laplacian \d+, needs 120\)$/);
    const dark = measuredScore(await measurePhoto(darkPhoto, "FINAL"));
    expect(dark.leftOut).toMatch(/^Too dark \(average brightness \d+%\)$/);
    expect(measuredScore(await measurePhoto(sharpPhoto, "FINAL")).points).toBeGreaterThan(measuredScore(blurry).points);
  });

  it("measures only the region a post can show (stamp band and top strip excluded)", async () => {
    const measured = await measurePhoto(sharpPhoto, "LISTING");
    const { region } = await cleanRegionOf(sharpPhoto);
    expect(measured.height).toBe(region.height);
    expect(measured.height).toBeLessThan(1600 - 300);
  });

  it("finds near-duplicates through the photo-integrity fingerprint even when re-stamped and re-encoded", async () => {
    const copy = await sharp(sharpPhoto).jpeg({ quality: 70 }).toBuffer();
    const other = await makeFixturePhoto({ seed: 99 });
    expect(hammingDistance(await perceptualHash(sharpPhoto), await perceptualHash(copy))).toBeLessThan(6);
    expect(hammingDistance(await perceptualHash(sharpPhoto), await perceptualHash(other))).toBeGreaterThanOrEqual(6);
  });

  it("fresh and recency are added when the list is read; a used photo loses its fresh points", () => {
    const measured = { points: 60, components: { source: 20, sharpness: 15, light: 12, contrast: 8, size: 5 }, width: 1000, height: 1200 };
    const fresh = liveScore({ measured, ratio: "4:5", usedBefore: false, nearDuplicate: false, ageDays: 0 });
    const used = liveScore({ measured, ratio: "4:5", usedBefore: true, nearDuplicate: false, ageDays: 0 });
    expect(fresh.score - used.score).toBe(15);
    expect(liveScore({ measured, ratio: "4:5", usedBefore: false, nearDuplicate: false, ageDays: 60 }).recency).toBe(0);
    expect(ratioFits(1000, 1200, "4:5")).toBe(true);
    expect(ratioFits(1600, 600, "4:5")).toBe(false);
  });
});

describe("the cleaned copy", () => {
  it("has no stamp band, no top tag strip and no EXIF or GPS, and leaves the original bytes unchanged", async () => {
    const before = createHash("sha256").update(sharpPhoto).digest("hex");
    expect((await sharp(sharpPhoto).metadata()).exif).toBeTruthy();
    expect(await colourShare(sharpPhoto, STAMP_COLOUR)).toBeGreaterThan(0.05);
    for (const ratio of ["4:5", "1:1", "1.91:1"] as const) {
      const copy = await makeSocialCrop(sharpPhoto, ratio);
      const meta = await sharp(copy.bytes).metadata();
      expect(meta.format).toBe("jpeg");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(copy.width).toBeLessThanOrEqual(1080);
      expect(await colourShare(copy.bytes, STAMP_COLOUR)).toBe(0);
      expect(await colourShare(copy.bytes, TAG_COLOUR)).toBe(0);
      await expect(assertNoMetadata(copy.bytes)).resolves.toBeUndefined();
    }
    expect(createHash("sha256").update(sharpPhoto).digest("hex")).toBe(before);
  }, 60_000);

  it("refuses a copy that still carries metadata", async () => {
    const withExif = await sharp(sharpPhoto).withMetadata().jpeg().toBuffer();
    await expect(assertNoMetadata(withExif)).rejects.toMatchObject({ code: "METADATA_LEFT" });
  });

  it("before/after split and the branded frame are cleaned the same way", async () => {
    const split = await makeBeforeAfterSplit(darkPhoto, sharpPhoto, "4:5", "SIDE");
    expect((await sharp(split.bytes).metadata()).exif).toBeUndefined();
    expect(await colourShare(split.bytes, STAMP_COLOUR)).toBe(0);
    const frame = await makeFramedCrop(sharpPhoto, "1:1", "sNeek", "Guest-ready by 3 pm");
    expect((await sharp(frame.bytes).metadata()).exif).toBeUndefined();
    expect(frame.width).toBe(frame.height);
  }, 60_000);
});

describe("signed public links", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-social-media-links";
  });

  it("names one copy of one post, expires and cannot be altered", () => {
    const now = new Date("2026-11-17T00:00:00Z");
    const token = signMediaToken({ assetId: "asset-1", groupId: "group-1", now });
    expect(verifyMediaToken(token, now)).toMatchObject({ assetId: "asset-1", groupId: "group-1" });
    expect(verifyMediaToken(token, new Date(now.getTime() + 3601_000))).toBeNull();
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ a: "original-evidence", g: "group-1", e: 9999999999 })).toString("base64url");
    expect(verifyMediaToken(`${forged}.${signature}`, now)).toBeNull();
    expect(verifyMediaToken(`${payload}.${signature}x`, now)).toBeNull();
    expect(verifyMediaToken("not-a-token", now)).toBeNull();
  });

  it("needs a public https address for networks to fetch from", () => {
    const saved = { app: process.env.APP_URL, auth: process.env.NEXTAUTH_URL };
    process.env.APP_URL = "http://localhost:3000";
    expect(publicMediaBase()).toHaveProperty("problem");
    process.env.APP_URL = "https://app.example.com.au";
    expect(publicMediaBase()).toEqual({ base: "https://app.example.com.au" });
    process.env.APP_URL = saved.app;
    process.env.NEXTAUTH_URL = saved.auth;
  });
});

describe("captions", () => {
  const facts = { suburb: "Bondi", bedrooms: 3, rooms: ["Living", "Bedroom", "Kitchen"], link: "https://example.com.au/quote" };

  it("renders a caption per network within its limits; Instagram gets link in bio, Facebook the link", () => {
    const template = templateFor(DEFAULT_SOCIAL_TEMPLATES, "CAROUSEL");
    for (const network of SOCIAL_NETWORKS) {
      const caption = renderNetworkCaption(template, 2, facts, network.key, DEFAULT_SOCIAL_TEMPLATES);
      expect(captionProblems(network.key, caption.caption, caption.hashtags)).toEqual([]);
    }
    expect(renderNetworkCaption(template, 0, facts, "INSTAGRAM", DEFAULT_SOCIAL_TEMPLATES).caption).toMatch(/link in bio/);
    expect(renderNetworkCaption(template, 0, facts, "FACEBOOK", DEFAULT_SOCIAL_TEMPLATES).caption).toMatch(/https:\/\/example\.com\.au\/quote/);
    expect(renderNetworkCaption(template, 0, facts, "GOOGLE_BUSINESS", DEFAULT_SOCIAL_TEMPLATES).hashtags).toEqual([]);
  });

  it("leaves the suburb out entirely when it may not be named", () => {
    const template = templateFor(DEFAULT_SOCIAL_TEMPLATES, "CAROUSEL");
    const caption = renderNetworkCaption(template, 0, { ...facts, suburb: null }, "INSTAGRAM", DEFAULT_SOCIAL_TEMPLATES);
    expect(caption.caption).not.toMatch(/Bondi/);
    expect(defaultHashtags(DEFAULT_SOCIAL_TEMPLATES, "INSTAGRAM", null)).not.toContain("#bondi");
    expect(defaultHashtags(DEFAULT_SOCIAL_TEMPLATES, "INSTAGRAM", "Bondi")).toContain("#bondi");
  });

  it("enforces each network's limits in words", () => {
    expect(captionProblems("INSTAGRAM", "x".repeat(2300), [])).toEqual(["Instagram: 2,300 of 2,200 characters."]);
    expect(captionProblems("INSTAGRAM", "ok", Array.from({ length: 31 }, (_, index) => `#tag${index}`))[0]).toMatch(/31 hashtags, at most 30/);
    expect(captionProblems("TIKTOK", `${"t".repeat(95)}\nbody`, [])).toContain("TikTok: the first line is the title, at most 90 characters.");
    expect(captionProblems("GOOGLE_BUSINESS", "y".repeat(1501), [])[0]).toMatch(/1,501 of 1,500/);
    expect(finalCaption("INSTAGRAM", "Hello", ["#a1", "#b2"])).toBe("Hello\n\n#a1 #b2");
    expect(finalCaption("FACEBOOK", "Hello", ["#a1"])).toBe("Hello");
  });
});

describe("the address and name linter", () => {
  const facts = { address: "4/18 Campbell Parade, Bondi Beach NSW 2026", postcode: "2026", clientName: "Sarah Chen", suburb: null, cleanerNames: ["Priya Nair"] };

  it("blocks street, unit, postcode, client and cleaner, whatever wrote the text", () => {
    expect(lintSocialText("Fresh linen on Campbell Parade today", facts)).toContainEqual(expect.stringMatching(/street/));
    expect(lintSocialText("Unit 4 is guest-ready", facts)).toContainEqual(expect.stringMatching(/unit or street number/));
    expect(lintSocialText("Ready at 4/18 by 3", facts).length).toBeGreaterThan(0);
    expect(lintSocialText("Turnover in 2026 postcode", facts)).toContainEqual(expect.stringMatching(/postcode/));
    expect(lintSocialText("Thanks Sarah Chen!", facts)).toContainEqual(expect.stringMatching(/client/));
    expect(lintSocialText("Great work by Priya Nair", facts)).toContainEqual(expect.stringMatching(/cleaner/));
    expect(lintSocialText("We clean 24/7 across Sydney. 2,200 happy guests.", facts)).toEqual([]);
  });

  it("blocks the suburb only when the permission does not allow it", () => {
    expect(lintSocialText("A Bondi three-bedder", { ...facts, suburb: "Bondi" })).toContainEqual(expect.stringMatching(/suburb/));
    expect(lintSocialText("A Bondi three-bedder", facts)).toEqual([]);
  });
});

describe("results and permission records", () => {
  it("never reads Posted without a network id for an API post", () => {
    expect(networkResultView({ status: "PUBLISHED", externalId: "1798_22", deliveryMode: "API", scheduledFor: null }).label).toBe("Posted");
    expect(networkResultView({ status: "PUBLISHED", externalId: null, deliveryMode: "MANUAL", scheduledFor: null }).label).toBe("Posted by you");
    expect(networkResultView({ status: "UNCONFIRMED", externalId: null, deliveryMode: "API", scheduledFor: null }).label).toBe("Not confirmed");
    expect(networkResultView({ status: "SCHEDULED", externalId: null, deliveryMode: null, scheduledFor: "2026-11-20T00:00:00Z" }).label).toBe("Waiting for your link");
    expect(networkResultView({ status: "SENT_TO_INBOX", externalId: "x", deliveryMode: "API", scheduledFor: null }).label).toBe("Waiting for you");
  });

  it("needs evidence for email and signed forms, a note for a phone call", () => {
    const base = { clientId: "c", propertyIds: ["p"], givenByName: "Owner", allowSuburb: false, allowBefore: false };
    expect(officeConsentProblem({ ...base, method: "EMAIL" })).toMatch(/Attach/);
    expect(officeConsentProblem({ ...base, method: "PHONE" })).toMatch(/note/);
    expect(officeConsentProblem({ ...base, method: "PHONE", evidenceNote: "Called 10:05" })).toBeNull();
  });

  it("zips the cleaned copies with correct CRCs", () => {
    const zip = zipFiles([{ name: "a.jpg", bytes: Buffer.from("hello") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from("hello")));
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
