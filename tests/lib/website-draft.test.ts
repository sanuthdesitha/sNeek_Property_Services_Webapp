// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_WEBSITE_CONTENT, type WebsiteContent } from "@/lib/public-site/content";
import {
  altTextRefusal,
  changeCountsBySection,
  describeChanges,
  diffWebsiteContent,
  fieldLabel,
  missingImageAltText,
  previewBlocksFor,
  valueAtPath,
} from "@/lib/public-site/website-draft";

const clone = (value: WebsiteContent): WebsiteContent => JSON.parse(JSON.stringify(value));

describe("website draft changes", () => {
  it("counts unsaved changes per section and names them for people", () => {
    const published = clone(DEFAULT_WEBSITE_CONTENT);
    const draft = clone(published);
    draft.home.title = "Airbnb turnovers, done before check-in";
    draft.home.heroImageUrl = "https://example.invalid/bondi-living-room.jpg";
    draft.announcementBar.promoMessage = "Now booking December turnovers";
    const paths = diffWebsiteContent(published, draft);
    expect(paths).toEqual(expect.arrayContaining(["home.title", "home.heroImageUrl", "announcementBar.promoMessage"]));
    expect(changeCountsBySection(paths)).toEqual({ home: 2, layout: 1 });
    expect(describeChanges(paths)).toBe("Home › hero headline, hero image · Layout and visibility › announcement bar");
    expect(valueAtPath(published, "home.title")).toBe(DEFAULT_WEBSITE_CONTENT.home.title);
    expect(previewBlocksFor(paths)).toEqual(expect.arrayContaining(["hero", "announcement"]));
  });

  it("an unchanged draft has no changes, and list edits name their collection", () => {
    const published = clone(DEFAULT_WEBSITE_CONTENT);
    expect(diffWebsiteContent(published, clone(published))).toEqual([]);
    const draft = clone(published);
    draft.home.stats = [...draft.home.stats, { value: "14", label: "suburbs", note: "" }];
    const paths = diffWebsiteContent(published, draft);
    expect(paths.length).toBeGreaterThan(0);
    expect(fieldLabel(paths[0]!)).toBe("figures");
  });
});

describe("alt text is required before publishing", () => {
  it("lists every image with a picture but no alt text", () => {
    const content = clone(DEFAULT_WEBSITE_CONTENT);
    expect(missingImageAltText(content)).toEqual([]);
    content.home.heroImageAlt = " ";
    content.gallery.items = [{ id: "g1", imageUrl: "https://example.invalid/a.jpg", imageAlt: "", caption: "", serviceType: "" }];
    const issues = missingImageAltText(content);
    expect(issues.map((issue) => issue.path)).toEqual(["home.heroImageUrl", "gallery.items[0].imageUrl"]);
    expect(issues.map((issue) => issue.section)).toEqual(["home", "media"]);
    expect(altTextRefusal(issues)).toBe("Add alt text before publishing: Home hero image, Gallery image 1. Nothing was published.");
  });

  it("an empty image slot needs no alt text", () => {
    const content = clone(DEFAULT_WEBSITE_CONTENT);
    content.home.heroImageUrl = "";
    content.home.heroImageAlt = "";
    expect(missingImageAltText(content)).toEqual([]);
  });
});
