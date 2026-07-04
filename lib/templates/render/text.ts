/**
 * renderText — TemplateDoc → plain text for SMS bodies and email text-parts
 * (rebrand doc 03 §1.1). SMS templates are single-textBlock docs; the segment
 * estimate powers the editor's live counter and publish lint (§4.3 budgets).
 * Sending still goes through lib/notifications/sms.ts unchanged.
 */

import type { BrandTokens } from "@/lib/brand/tokens";
import type { TemplateDoc } from "../model";
import { renderBlocks, type RenderOptions } from "./engine";

export interface RenderedText {
  text: string;
  /** Estimated SMS segments (GSM-7 vs UCS-2 aware). */
  segments: number;
  encoding: "gsm7" | "ucs2";
}

// GSM 03.38 basic character set (+ extension chars which cost 2).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function estimateSmsSegments(text: string): { segments: number; encoding: "gsm7" | "ucs2" } {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXT.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    if (septets === 0) return { segments: 0, encoding: "gsm7" };
    return { segments: septets <= 160 ? 1 : Math.ceil(septets / 153), encoding: "gsm7" };
  }
  const units = text.length;
  return { segments: units <= 70 ? 1 : Math.ceil(units / 67), encoding: "ucs2" };
}

export function renderText(
  doc: TemplateDoc,
  data: unknown,
  brand: BrandTokens,
  opts: RenderOptions = {},
): RenderedText {
  const text = renderBlocks(doc, "sms", "renderText", data, brand, opts).trim();
  const { segments, encoding } = estimateSmsSegments(text);
  return { text, segments, encoding };
}
