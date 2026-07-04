import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { photoGridBlock } from "@/lib/templates/blocks/defs/photo-grid";

const media = [
  { url: "https://cdn.test/a.jpg", type: "PHOTO" as const },
  {
    url: "https://cdn.test/b.jpg",
    type: "PHOTO" as const,
    caption: "Front door",
    stamp: "12 Mar 2026, 9:14am",
  },
  { url: "https://cdn.test/c.jpg", type: "PHOTO" as const },
  { url: "https://cdn.test/clip.mp4", type: "VIDEO" as const, caption: "Walkthrough" },
];

function makeCtx(channel: string, data: unknown) {
  return {
    channel,
    brand: DEFAULT_BRAND_TOKENS,
    theme: {},
    data,
    merge: (s: string) => s,
    mergeText: (s: string) => s,
    color: (_r: string | undefined, f: string) => f,
    style: {},
  } as any;
}

describe("photoGrid block", () => {
  it("renders a document grid with images, video, caption, stamp and badge", () => {
    const ctx = makeCtx("pdf", { media });
    const props = photoGridBlock.propsSchema.parse({
      bind: "media",
      columns: 3,
      showCaption: true,
      evidenceBadge: true,
    });
    const html = photoGridBlock.renderDocument!(props, ctx);

    expect(html).toContain('class="tpl-photo-grid"');
    expect(html).toContain('data-cols="3"');
    expect(html.match(/<img/g)?.length).toBe(3);
    expect(html).toContain("tpl-photo-video");
    expect(html).toContain("Front door");
    expect(html).toContain("12 Mar 2026, 9:14am");
    expect(html).toContain("tpl-photo-badge");
  });

  it("truncates to max and shows a +more note", () => {
    const five = [
      { url: "1.jpg", type: "PHOTO" as const },
      { url: "2.jpg", type: "PHOTO" as const },
      { url: "3.jpg", type: "PHOTO" as const },
      { url: "4.jpg", type: "PHOTO" as const },
      { url: "5.jpg", type: "PHOTO" as const },
    ];
    const ctx = makeCtx("web", { media: five });
    const props = photoGridBlock.propsSchema.parse({ bind: "media", max: 2 });
    const html = photoGridBlock.renderDocument!(props, ctx);

    expect(html.match(/<img/g)?.length).toBe(2);
    expect(html).toContain("+3 more");
  });

  it("renders an email table of thumbnails", () => {
    const ctx = makeCtx("email", { media });
    const props = photoGridBlock.propsSchema.parse({ bind: "media" });
    const html = photoGridBlock.renderEmail!(props, ctx);

    expect(html).toContain("<table");
    expect(html).toContain("<img");
  });

  it("renders emptyText when the bound array is empty", () => {
    const ctx = makeCtx("pdf", { media: [] });
    const props = photoGridBlock.propsSchema.parse({ bind: "media", emptyText: "Nothing here." });
    const html = photoGridBlock.renderDocument!(props, ctx);

    expect(html).toContain("tpl-empty");
    expect(html).toContain("Nothing here.");
  });
});
