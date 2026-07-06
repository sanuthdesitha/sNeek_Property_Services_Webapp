"use client";

import type { WebsiteContent } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import { ESectionCard, EField, EInput, ETextarea } from "../shared";

export function ContactSection({ content, setContent, readOnly }: SectionProps) {
  const setContact = (p: Partial<WebsiteContent["contact"]>) =>
    setContent((c) => ({ ...c, contact: { ...c.contact, ...p } }));
  const setFooter = (p: Partial<WebsiteContent["footer"]>) =>
    setContent((c) => ({ ...c, footer: { ...c.footer, ...p } }));

  const contact = content.contact;
  const footer = content.footer;

  return (
    <div className="space-y-5">
      <ESectionCard title="Contact page">
        <EField label="Eyebrow">
          <EInput value={contact.eyebrow} disabled={readOnly} onChange={(e) => setContact({ eyebrow: e.target.value })} />
        </EField>
        <EField label="Title">
          <ETextarea rows={2} value={contact.title} disabled={readOnly} onChange={(e) => setContact({ title: e.target.value })} />
        </EField>
        <EField label="Intro">
          <ETextarea rows={3} value={contact.intro} disabled={readOnly} onChange={(e) => setContact({ intro: e.target.value })} />
        </EField>
        <EField label="Form intro">
          <ETextarea rows={2} value={contact.formIntro} disabled={readOnly} onChange={(e) => setContact({ formIntro: e.target.value })} />
        </EField>
        <div className="grid gap-4 md:grid-cols-3">
          <EField label="Display email">
            <EInput value={contact.displayEmail} disabled={readOnly} onChange={(e) => setContact({ displayEmail: e.target.value })} />
          </EField>
          <EField label="Display phone">
            <EInput value={contact.displayPhone} disabled={readOnly} onChange={(e) => setContact({ displayPhone: e.target.value })} />
          </EField>
          <EField label="Display address">
            <EInput value={contact.addressLine} disabled={readOnly} onChange={(e) => setContact({ addressLine: e.target.value })} />
          </EField>
        </div>
        <EField label="Response promise">
          <ETextarea rows={2} value={contact.responsePromise} disabled={readOnly} onChange={(e) => setContact({ responsePromise: e.target.value })} />
        </EField>
        <EField
          label="Lead-recipient emails (one per line)"
          hint="Public contact & quote submissions are emailed here. If empty, the system falls back to the accounts email."
        >
          <ETextarea
            rows={4}
            disabled={readOnly}
            value={contact.recipientEmails.join("\n")}
            onChange={(e) =>
              setContact({
                recipientEmails: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
              })
            }
          />
        </EField>
      </ESectionCard>

      <ESectionCard title="Footer">
        <div className="grid gap-4 md:grid-cols-3">
          <EField label="Footer blurb">
            <ETextarea rows={4} value={footer.blurb} disabled={readOnly} onChange={(e) => setFooter({ blurb: e.target.value })} />
          </EField>
          <EField label="Service areas">
            <ETextarea rows={4} value={footer.areas} disabled={readOnly} onChange={(e) => setFooter({ areas: e.target.value })} />
          </EField>
          <EField label="Footer support line">
            <ETextarea rows={4} value={footer.supportLine} disabled={readOnly} onChange={(e) => setFooter({ supportLine: e.target.value })} />
          </EField>
        </div>
      </ESectionCard>
    </div>
  );
}
