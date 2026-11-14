// @vitest-environment node
/**
 * Every wording-layer email part is a block design whose version 1 keeps the
 * same words and values as the HTML body it replaced, passes its checks,
 * and is what the send path renders (the wording render keeps returning the
 * same body, with the spec attached).
 */
import { describe, expect, it } from "vitest";
import { WORDING_DEFINITIONS } from "@/lib/notifications/wording/registry";
import { defaultNotificationWording } from "@/lib/notifications/wording/render";
import { sampleValues } from "@/lib/notifications/wording/variables";
import { templateVariables } from "@/lib/notifications/wording/template";
import { isWordingEmailPart, wordingDesignKey, wordingEmailDesigns } from "@/lib/email-design/wording-designs";
import { findEmailDesign } from "@/lib/email-design/all-designs";
import { blockingChecks, checkDocument, documentValues } from "@/lib/email-design/checks";
import { businessFromSettings, composeDesign } from "@/lib/email-design/compose";
import { DEFAULT_EMAIL_THEME } from "@/lib/email-design/theme";
import { extractSpec } from "@/lib/email-design/spec";
import { htmlWords } from "@/lib/email-design/convert-html";

const settings = { companyName: "sNeek Property Services" };
const parts = WORDING_DEFINITIONS.flatMap((definition) => definition.parts.filter(isWordingEmailPart).map((part) => [`${definition.typeKey} · ${part.id}`, definition.typeKey, part] as const));

describe("wording-layer email parts as block designs", () => {
  it("every whole-email wording part has a design (line parts stay sentences)", () => {
    expect(parts.length).toBeGreaterThan(90);
    expect(wordingEmailDesigns()).toHaveLength(parts.length);
  });

  it.each(parts)("%s: same values, same words, passes its checks", (_label, typeKey, part) => {
    const definition = findEmailDesign(wordingDesignKey(typeKey, part.id));
    expect(definition).not.toBeNull();
    const used = documentValues(definition!.defaults);
    const before = templateVariables(`${part.defaults.subject ?? ""} ${part.defaults.body ?? ""}`);
    expect(before.filter((name) => !used.includes(name))).toEqual([]);
    expect(blockingChecks(checkDocument(definition!, definition!.defaults, DEFAULT_EMAIL_THEME))).toEqual([]);

    const values = sampleValues(part.variables);
    const old = defaultNotificationWording(typeKey).render(part.id, "EMAIL", values);
    const { spec, html: oldBody } = extractSpec(old.html);
    expect(spec).toMatchObject({ kind: "design", key: definition!.key, subject: old.subject });
    const rendered = composeDesign(definition!, definition!.defaults, spec!.values, { theme: DEFAULT_EMAIL_THEME, business: businessFromSettings(settings), appUrl: "https://app.example.invalid", mode: "send", settings });
    expect(rendered.subject).toBe(old.subject);
    const after = new Set(htmlWords(rendered.html).map((word) => word.toLowerCase()));
    const lost = htmlWords(oldBody).map((word) => word.toLowerCase()).filter((word) => !after.has(word));
    expect(lost).toEqual([]);
    expect(rendered.missing).toEqual([]);
  });

  it("an empty value stays empty (no 'Not known' added to old sentences)", () => {
    for (const definition of wordingEmailDesigns()) for (const variable of definition.variables.filter((item) => item.name !== "companyName" && !["appUrl", "loginUrl", "supportEmail", "currentDate"].includes(item.name))) expect(variable.fallback, `${definition.key}.${variable.name}`).toBe("");
  });

  it("a wording edit from before blocks is marked custom, so it keeps going out until a block version is published", () => {
    const [, typeKey, part] = parts[0];
    const rendered = defaultNotificationWording(typeKey).render(part.id, "EMAIL", sampleValues(part.variables));
    expect(extractSpec(rendered.html).spec?.custom).toBeUndefined();
  });
});
