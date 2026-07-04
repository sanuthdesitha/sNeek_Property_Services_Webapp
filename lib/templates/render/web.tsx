/**
 * renderWeb — TemplateDoc → React for portal viewing / editor live preview
 * (rebrand doc 03 §1.1).
 *
 * Phase-1 note: blocks render through the shared semantic document HTML
 * (render/document.ts) inside a scoped container. The editor phase (doc 03
 * §3) lifts blocks into individual React canvas components; this component's
 * contract (doc, data in → element out) stays the same.
 */

import * as React from "react";
import type { BrandTokens } from "@/lib/brand/tokens";
import type { TemplateDoc } from "../model";
import { renderDocumentHtml } from "./document";
import type { RenderOptions } from "./engine";

export function TemplateWebView({
  doc,
  data,
  brand,
  options,
}: {
  doc: TemplateDoc;
  data: unknown;
  brand: BrandTokens;
  options?: RenderOptions;
}): React.ReactElement {
  const html = renderDocumentHtml(doc, data, brand, "web", options ?? {});
  // The document renderer escapes all merged values; the only raw markup is
  // template-author-controlled block markup (same trust model as the legacy
  // string-built reports this replaces).
  return (
    <iframe
      title={`template-${doc.kind}`}
      sandbox=""
      srcDoc={html}
      style={{ width: "100%", minHeight: 480, border: 0, background: "#fff" }}
    />
  );
}
