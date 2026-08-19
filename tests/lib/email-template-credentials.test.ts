import { describe, it, expect } from "vitest";
import { getDefaultEmailTemplates, renderEmailTemplate } from "@/lib/email-templates";

/**
 * A stored template outranks the shipped default, so a template saved before a
 * credential was added to a flow — or trimmed by an admin while restyling —
 * silently drops it. The account still gets created and the password still gets
 * hashed; the only copy the recipient would ever see just never leaves.
 *
 * This is not hypothetical: the live `welcomeAccount` template was an old
 * four-line version with no {tempPassword}, so every client created with "Send
 * portal invite" received a welcome email containing no way to sign in.
 */

function settingsWith(html: string, key: "welcomeAccount" | "accountInvite" = "welcomeAccount") {
  return {
    companyName: "sNeek",
    logoUrl: "",
    emailTemplates: {
      ...getDefaultEmailTemplates(),
      [key]: { subject: "Welcome to {companyName}", html },
    },
  };
}

describe("renderEmailTemplate — credential fail-safe", () => {
  it("appends the temporary password when a stored template dropped the placeholder", () => {
    const rendered = renderEmailTemplate(
      settingsWith("<h2>Welcome, {userName}</h2><p><strong>Role:</strong> {role}</p>"),
      "welcomeAccount",
      { userName: "Jane", role: "CLIENT", tempPassword: "Sw1ft-Otter-42" }
    );
    expect(rendered.html).toContain("Sw1ft-Otter-42");
    expect(rendered.html).toContain("Temporary password");
  });

  it("does not duplicate the password when the template already renders it", () => {
    const rendered = renderEmailTemplate(
      settingsWith("<p>Your password is {tempPassword}</p>"),
      "welcomeAccount",
      { userName: "Jane", role: "CLIENT", tempPassword: "Sw1ft-Otter-42" }
    );
    expect(rendered.html.match(/Sw1ft-Otter-42/g)).toHaveLength(1);
  });

  it("adds nothing when the caller supplied no password", () => {
    const rendered = renderEmailTemplate(
      settingsWith("<h2>Welcome, {userName}</h2>"),
      "welcomeAccount",
      { userName: "Jane", role: "CLIENT" }
    );
    expect(rendered.html).not.toContain("Temporary password");
  });

  it("adds nothing when the password was supplied as an empty string", () => {
    const rendered = renderEmailTemplate(
      settingsWith("<h2>Welcome, {userName}</h2>"),
      "welcomeAccount",
      { userName: "Jane", role: "CLIENT", tempPassword: "" }
    );
    expect(rendered.html).not.toContain("Temporary password");
  });

  it("escapes the appended value rather than trusting it as markup", () => {
    const rendered = renderEmailTemplate(
      settingsWith("<h2>Welcome, {userName}</h2>"),
      "welcomeAccount",
      { userName: "Jane", role: "CLIENT", tempPassword: '<img src=x onerror="alert(1)">' }
    );
    expect(rendered.html).not.toContain('<img src=x onerror="alert(1)">');
    expect(rendered.html).toContain("&lt;img");
  });

  it("covers the accountInvite flow too, not just welcomeAccount", () => {
    const rendered = renderEmailTemplate(
      settingsWith("<p>You have been invited.</p>", "accountInvite"),
      "accountInvite",
      { userName: "Jane", role: "CLIENT", tempPassword: "Quiet-Reef-19" }
    );
    expect(rendered.html).toContain("Quiet-Reef-19");
  });
});

describe("renderEmailTemplate — shipped defaults", () => {
  it("still carries the placeholder in every template that is sent a password", () => {
    const defaults = getDefaultEmailTemplates();
    for (const key of ["welcomeAccount", "accountInvite", "resetPassword"] as const) {
      expect(defaults[key].html, `${key} default lost {tempPassword}`).toContain("{tempPassword}");
    }
  });
});
