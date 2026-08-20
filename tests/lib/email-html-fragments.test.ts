import { describe, it, expect } from "vitest";
import { getDefaultEmailTemplates, renderEmailTemplate } from "@/lib/email-templates";

/**
 * The regression: escaping EVERY substituted value was right for names, notes
 * and reasons, and wrong for the two variables that carry an assembled list.
 * The laundry team's "tomorrow's prep" email arrived as a wall of visible tags.
 *
 * The fix has to hold both ends at once — the fragment renders as markup, and
 * the free text inside it (a property name someone typed) stays inert.
 */

const SETTINGS = {
  companyName: "sNeek",
  logoUrl: "",
  emailTemplates: getDefaultEmailTemplates(),
};

const FRAGMENT_TEMPLATES = [
  "tomorrowJobsSummary",
  "tomorrowLaundrySummary",
  "criticalInventoryTomorrow",
] as const;

describe("HTML fragment variables", () => {
  it("renders the laundry summary as markup, not as visible tags", () => {
    const rendered = renderEmailTemplate(SETTINGS, "tomorrowLaundrySummary", {
      recipientName: "Laundry team",
      dateLabel: "21 Aug",
      taskCount: "2",
      summaryHtml: "<ol><li>Pickup · Bondi Loft</li></ol>",
      summaryText: "Pickup Bondi Loft",
    });

    expect(rendered.html).toContain("<ol><li>Pickup · Bondi Loft</li></ol>");
    // The exact symptom that was reported.
    expect(rendered.html).not.toContain("&lt;ol&gt;");
  });

  it("renders the jobs summary as markup", () => {
    const rendered = renderEmailTemplate(SETTINGS, "tomorrowJobsSummary", {
      recipientName: "Cleaner",
      dateLabel: "21 Aug",
      jobCount: "1",
      summaryHtml: "<ol><li>P1 · J-1001</li></ol>",
      summaryText: "P1 J-1001",
    });
    expect(rendered.html).toContain("<ol><li>P1 · J-1001</li></ol>");
  });

  it("renders the inventory summary as markup", () => {
    const rendered = renderEmailTemplate(SETTINGS, "criticalInventoryTomorrow", {
      recipientName: "Admin",
      roleLabel: "Admin",
      dateLabel: "21 Aug",
      propertyCount: "1",
      itemCount: "2",
      inventoryHtml: "<ul><li>Bondi Loft</li></ul>",
      inventoryText: "Bondi Loft",
    });
    expect(rendered.html).toContain("<ul><li>Bondi Loft</li></ul>");
  });
});

describe("everything else is still escaped", () => {
  it("does not let a plain variable inject markup just because a fragment exists", () => {
    const rendered = renderEmailTemplate(SETTINGS, "tomorrowLaundrySummary", {
      // A recipient name is data, not markup — the XSS fix must still hold.
      recipientName: '<img src=x onerror="alert(1)">',
      dateLabel: "21 Aug",
      taskCount: "1",
      summaryHtml: "<ol><li>ok</li></ol>",
      summaryText: "ok",
    });

    expect(rendered.html).not.toContain('<img src=x onerror="alert(1)">');
    expect(rendered.html).toContain("&lt;img");
    // ...while the fragment beside it still renders.
    expect(rendered.html).toContain("<ol><li>ok</li></ol>");
  });

  it("escapes credential values appended by the fail-safe", () => {
    const rendered = renderEmailTemplate(SETTINGS, "welcomeAccount", {
      userName: "Jane",
      role: "CLIENT",
      tempPassword: "<b>hunter2</b>",
    });
    expect(rendered.html).not.toContain("<b>hunter2</b>");
  });
});

describe("the templates that receive fragments still declare them", () => {
  it.each(FRAGMENT_TEMPLATES)("%s keeps its fragment placeholder", (key) => {
    const html = getDefaultEmailTemplates()[key].html;
    // If a placeholder is renamed, the allowlist silently stops matching and
    // the email quietly goes back to printing tags.
    expect(html).toMatch(/\{(summaryHtml|inventoryHtml)\}/);
  });
});
