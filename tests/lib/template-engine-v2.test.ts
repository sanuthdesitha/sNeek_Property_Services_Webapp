import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc, evaluateWhen, parseTemplateDoc } from "@/lib/templates/model";
import { resolveMergeHtml, resolveMergeText, listMergePaths } from "@/lib/templates/merge";
import {
  TEMPLATE_KINDS,
  defaultClientInvoiceIssuedEmail,
  defaultClientInvoiceDoc,
  defaultJobReminderSms,
} from "@/lib/templates/kinds";
import { renderEmail } from "@/lib/templates/render/email";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { renderText, estimateSmsSegments } from "@/lib/templates/render/text";
import { lintTemplateDoc } from "@/lib/templates/lint";

const brand = DEFAULT_BRAND_TOKENS;
const TZ = { timezone: "Australia/Sydney" };

function invoiceSample() {
  return JSON.parse(JSON.stringify(TEMPLATE_KINDS["doc.clientInvoice"].sampleData()));
}

describe("merge resolver", () => {
  it("resolves {{path}} with formatters and escapes HTML", () => {
    const out = resolveMergeHtml("Total {{invoice.totalAmount | money}} for {{client.name}}", {
      data: { invoice: { totalAmount: 616 }, client: { name: "<b>J</b>" } },
      ...TZ,
    });
    expect(out).toBe("Total $616.00 for &lt;b&gt;J&lt;/b&gt;");
  });

  it("accepts legacy single-brace {var} for known vars only", () => {
    const out = resolveMergeText("Hi {name}, style {notAVar}", {
      data: { name: "Ana" },
      ...TZ,
    });
    expect(out).toBe("Hi Ana, style {notAVar}");
  });

  it("collects unresolved paths for lint", () => {
    const unresolved = new Set<string>();
    resolveMergeHtml("{{missing.path}}", { data: {}, unresolved, ...TZ });
    expect([...unresolved]).toEqual(["missing.path"]);
  });

  it("lists merge paths in a template", () => {
    expect(listMergePaths("{{a.b}} and {{c | money}}")).toEqual(["a.b", "c"]);
  });

  it("fallback formatter fills empty values", () => {
    const out = resolveMergeText('Hi {{client.name | fallback:"there"}}', { data: {}, ...TZ });
    expect(out).toBe("Hi there");
  });
});

describe("when conditions", () => {
  it("truthy path renders, negation inverts, empty arrays are falsy", () => {
    expect(evaluateWhen("invoice.gstEnabled", { invoice: { gstEnabled: true } })).toBe(true);
    expect(evaluateWhen("!invoice.gstEnabled", { invoice: { gstEnabled: true } })).toBe(false);
    expect(evaluateWhen("items", { items: [] })).toBe(false);
    expect(evaluateWhen(undefined, {})).toBe(true);
  });
});

describe("email renderer (pilot: email.clientInvoiceIssued)", () => {
  const doc = { ...emptyDoc("email.clientInvoiceIssued"), blocks: defaultClientInvoiceIssuedEmail() };

  it("renders the full invoice email with no unresolved vars", () => {
    const unresolved = new Set<string>();
    const { html } = renderEmail(doc, invoiceSample(), brand, { unresolved });
    expect(html).toContain("$616.00");
    expect(html).toContain("INV-1042");
    expect(html).toContain("View & pay"); // literal author text passes through; only merged values are escaped
    expect(unresolved.size).toBe(0);
  });

  it("escapes hostile data values", () => {
    const hostile = invoiceSample();
    hostile.client.name = "<script>alert(1)</script>";
    const { html } = renderEmail(doc, hostile, brand, {});
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("document renderer (pilot: doc.clientInvoice)", () => {
  const doc = { ...emptyDoc("doc.clientInvoice"), blocks: defaultClientInvoiceDoc() };

  it("binds line items and totals from computed data", () => {
    const html = renderDocumentHtml(doc, invoiceSample(), brand, "pdf", {});
    expect(html).toContain("Airbnb turnover");
    expect(html).toContain("$56.00"); // GST — bound, not recomputed
    expect(html).toContain("$616.00");
    expect(html).toContain("tpl-line-items");
  });

  it("hides the GST totals row when gstEnabled is false", () => {
    const noGst = invoiceSample();
    noGst.invoice.gstEnabled = false;
    const html = renderDocumentHtml(doc, noGst, brand, "pdf", {});
    expect(html).not.toContain(">GST<");
    expect(html).toContain("$616.00");
  });
});

describe("text renderer (pilot: sms.jobReminder)", () => {
  it("renders a 1-segment GSM-7 reminder", () => {
    const doc = { ...emptyDoc("sms.jobReminder"), blocks: defaultJobReminderSms() };
    const out = renderText(doc, TEMPLATE_KINDS["sms.jobReminder"].sampleData(), brand, {});
    expect(out.text).toContain("sNeek: Turnover at 12 Marine Pde");
    expect(out.segments).toBe(1);
    expect(out.encoding).toBe("gsm7");
  });

  it("estimates segments across GSM-7 boundaries and UCS-2", () => {
    expect(estimateSmsSegments("a".repeat(160)).segments).toBe(1);
    expect(estimateSmsSegments("a".repeat(161)).segments).toBe(2);
    expect(estimateSmsSegments("emoji 😀").encoding).toBe("ucs2");
  });
});

describe("publish lint", () => {
  it("passes the default pilot docs", () => {
    const email = { ...emptyDoc("email.clientInvoiceIssued"), blocks: defaultClientInvoiceIssuedEmail() };
    const pdf = { ...emptyDoc("doc.clientInvoice"), blocks: defaultClientInvoiceDoc() };
    const sms = { ...emptyDoc("sms.jobReminder"), blocks: defaultJobReminderSms() };
    expect(lintTemplateDoc(email, brand).ok).toBe(true);
    expect(lintTemplateDoc(pdf, brand).ok).toBe(true);
    expect(lintTemplateDoc(sms, brand).ok).toBe(true);
  });

  it("blocks publish on missing required blocks", () => {
    const doc = { ...emptyDoc("doc.clientInvoice"), blocks: defaultClientInvoiceDoc().filter((b) => b.type !== "totals") };
    const result = lintTemplateDoc(doc, brand);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("totals"))).toBe(true);
  });

  it("blocks publish on unknown variables", () => {
    const doc = {
      ...emptyDoc("sms.jobReminder"),
      blocks: [{ id: "x", type: "textBlock" as const, props: { text: "Hello {{not.a.real.path}}" } }],
    };
    const result = lintTemplateDoc(doc, brand);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("not.a.real.path"))).toBe(true);
  });

  it("rejects blocks not allowed for the kind", () => {
    const doc = {
      ...emptyDoc("sms.jobReminder"),
      blocks: [
        { id: "a", type: "textBlock" as const, props: { text: "Hi {{companyName}}" } },
        { id: "b", type: "hero" as const, props: { headline: "Nope" } },
      ],
    };
    const result = lintTemplateDoc(doc, brand);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('"hero"'))).toBe(true);
  });

  it("warns (not errors) on long SMS", () => {
    const doc = {
      ...emptyDoc("sms.jobReminder"),
      blocks: [{ id: "x", type: "textBlock" as const, props: { text: "{{companyName}} " + "x".repeat(400) } }],
    };
    const result = lintTemplateDoc(doc, brand);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("doc validation", () => {
  it("parses a stored v2 doc and rejects unknown block types", () => {
    const good = { ...emptyDoc("doc.clientInvoice"), blocks: defaultClientInvoiceDoc() };
    expect(() => parseTemplateDoc(JSON.parse(JSON.stringify(good)))).not.toThrow();
    const bad = { ...good, blocks: [{ id: "x", type: "nonsense", props: {} }] };
    expect(() => parseTemplateDoc(bad)).toThrow();
  });
});
