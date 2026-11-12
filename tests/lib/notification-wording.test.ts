// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { WORDING_DEFINITIONS, wordingDefinition } from "@/lib/notifications/wording/registry";
import { checkWording, fromEmailTemplateSyntax, renderHtml, renderPlain, smsLength, templateVariables, toEmailTemplateSyntax, wordingHash } from "@/lib/notifications/wording/template";
import { AUDIENCE_GROUPS, audienceGroup } from "@/lib/notifications/wording/audience-groups";
import { templateDefaults } from "@/lib/notifications/wording/template-sources";
import { partProblems } from "@/lib/notifications/wording/store";

describe("wording registry", () => {
  it("has exactly one definition for every catalog type, and no definition for unknown types", () => {
    const keys = WORDING_DEFINITIONS.map((definition) => definition.typeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(NOTIFICATION_CATALOG.map((entry) => entry.key)));
    expect(wordingDefinition("no.such.type")).toBeUndefined();
  });

  it("says why every type that is not fully editable is not, and links the existing editor where one exists", () => {
    for (const definition of WORDING_DEFINITIONS) {
      if (definition.status === "EDITABLE") expect(definition.parts.length, definition.typeKey).toBeGreaterThan(0);
      if (definition.status === "PARTS") expect(definition.parts.length && definition.reason, definition.typeKey).toBeTruthy();
      if (definition.status === "IN_CODE") expect([definition.parts.length, Boolean(definition.reason)], definition.typeKey).toEqual([0, true]);
      if (definition.status === "ELSEWHERE") expect(definition.href, definition.typeKey).toBeTruthy();
    }
  });

  it("every default is valid wording for its own part: known variables only, required ones present", () => {
    for (const definition of WORDING_DEFINITIONS) {
      for (const part of definition.parts) {
        const problems = partProblems(part, templateDefaults(part));
        expect(problems, `${definition.typeKey}/${part.id}/${part.transport}`).toEqual([]);
        for (const name of part.required) expect(part.variables, `${definition.typeKey}/${part.id}`).toContain(name);
      }
    }
  });

  it("groups every type under one of the board's audiences", () => {
    for (const entry of NOTIFICATION_CATALOG) expect(AUDIENCE_GROUPS).toContain(audienceGroup(entry));
    expect(audienceGroup(NOTIFICATION_CATALOG.find((entry) => entry.key === "guest.message")!)).toBe("Guests");
    expect(audienceGroup(NOTIFICATION_CATALOG.find((entry) => entry.key === "laundry.cleaner_nudge")!)).toBe("Cleaners");
  });
});

describe("template language", () => {
  it("substitutes {{variables}} only and never executes anything", () => {
    expect(renderPlain("Hi {{ userName }}, {{when}}.", { userName: "Jane", when: "10:00" })).toBe("Hi Jane, 10:00.");
    expect(renderPlain("${process.env.SECRET} {{constructor}} {{toString}} {{__proto__}} {{a.b}}", {})).toBe("${process.env.SECRET}   {{__proto__}} {{a.b}}");
    expect(renderPlain("{{missing}}!", {})).toBe("!");
    expect(templateVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("escapes values in an email body but keeps the admin's HTML; multiline and built fragments are handled explicitly", () => {
    const html = renderHtml("<p>{{name}}</p>{{row}}{{note}}", { name: "<img src=x onerror=alert(1)>", row: "<tr><td>ok</td></tr>", note: "a & b\nc" }, { row: "html", note: "multiline" });
    expect(html).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p><tr><td>ok</td></tr>a &amp; b<br>c");
  });

  it("refuses unknown variables, a missing required variable, broken placeholders and script in email", () => {
    const codes = (fields: Record<string, string>, transport: "SMS" | "EMAIL" = "SMS") => checkWording({ transport, fields, allowed: ["when", "propertyName"], required: ["when"] }).map((problem) => problem.code);
    expect(codes({ body: "At {{propertyName}} {{when}}" })).toEqual([]);
    expect(codes({ body: "At {{propertyName}}" })).toEqual(["missing_required"]);
    expect(codes({ body: "{{when}} {{secret}}" })).toEqual(["unknown_variable"]);
    expect(codes({ body: "{{when}} {{ broken" })).toEqual(["broken_placeholder"]);
    expect(codes({ subject: "{{when}}", body: "<p onclick=\"x()\">hi</p>" }, "EMAIL")).toEqual(["unsafe_html"]);
    expect(codes({ body: "" })).toEqual(["empty", "missing_required"]);
  });

  it("counts SMS characters and segments, switching to 70 for an emoji or curly quote", () => {
    expect(smsLength("a".repeat(160))).toMatchObject({ segments: 1, unicode: false });
    expect(smsLength("a".repeat(161))).toMatchObject({ segments: 2, perSegment: 153 });
    expect(smsLength("It’s ready")).toMatchObject({ unicode: true, perSegment: 70 });
    expect(smsLength("[x]").characters).toBe(5);
  });

  it("converts between the shared email template syntax and the editor's without loss", () => {
    const stored = "<p style=\"a:{ b }\">Hi {userName}</p> {code}";
    const shown = fromEmailTemplateSyntax(stored);
    expect(shown).toBe("<p style=\"a:{ b }\">Hi {{userName}}</p> {{code}}");
    expect(toEmailTemplateSyntax(shown)).toBe(stored);
    expect(wordingHash({ body: "a" })).not.toBe(wordingHash({ body: "b" }));
  });
});
