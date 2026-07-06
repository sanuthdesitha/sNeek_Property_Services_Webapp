"use client";

import type { WebsiteContent, WebsiteLegalSection } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import { ESectionCard, EListItem, EAddRow, EField, EInput, ETextarea, moveItem } from "../shared";

function LegalSectionsEditor({
  value,
  onChange,
  readOnly,
}: {
  value: WebsiteLegalSection[];
  onChange: (next: WebsiteLegalSection[]) => void;
  readOnly: boolean;
}) {
  const patch = (i: number, p: Partial<WebsiteLegalSection>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...p } : row)));
  return (
    <div className="space-y-4">
      <EAddRow
        hint="Structured sections shown on the public legal page"
        label="Add section"
        disabled={readOnly}
        onAdd={() => onChange([...value, { title: "New section", body: "Describe the policy or term here.", bullets: ["Add bullet point"] }])}
      />
      {value.map((section, index) => (
        <EListItem
          key={index}
          index={index}
          count={value.length}
          title={section.title || `Section ${index + 1}`}
          disabled={readOnly}
          onMoveUp={() => onChange(moveItem(value, index, -1))}
          onMoveDown={() => onChange(moveItem(value, index, 1))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        >
          <EField label="Section title">
            <EInput value={section.title} disabled={readOnly} onChange={(e) => patch(index, { title: e.target.value })} />
          </EField>
          <EField label="Body">
            <ETextarea rows={3} value={section.body} disabled={readOnly} onChange={(e) => patch(index, { body: e.target.value })} />
          </EField>
          <EField label="Bullets (one per line)">
            <ETextarea
              rows={4}
              disabled={readOnly}
              value={section.bullets.join("\n")}
              onChange={(e) => patch(index, { bullets: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
            />
          </EField>
        </EListItem>
      ))}
    </div>
  );
}

export function LegalSection({ content, setContent, readOnly }: SectionProps) {
  const setTerms = (p: Partial<WebsiteContent["terms"]>) =>
    setContent((c) => ({ ...c, terms: { ...c.terms, ...p } }));
  const setPrivacy = (p: Partial<WebsiteContent["privacy"]>) =>
    setContent((c) => ({ ...c, privacy: { ...c.privacy, ...p } }));

  const terms = content.terms;
  const privacy = content.privacy;

  return (
    <div className="space-y-5">
      <ESectionCard title="Terms & conditions">
        <EField label="Title">
          <ETextarea rows={2} value={terms.title} disabled={readOnly} onChange={(e) => setTerms({ title: e.target.value })} />
        </EField>
        <EField label="Intro">
          <ETextarea rows={4} value={terms.intro} disabled={readOnly} onChange={(e) => setTerms({ intro: e.target.value })} />
        </EField>
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Insurance label">
            <EInput value={terms.publicLiabilityLabel} disabled={readOnly} onChange={(e) => setTerms({ publicLiabilityLabel: e.target.value })} />
          </EField>
          <EField label="Insurance body">
            <ETextarea rows={3} value={terms.publicLiabilityBody} disabled={readOnly} onChange={(e) => setTerms({ publicLiabilityBody: e.target.value })} />
          </EField>
        </div>
        <LegalSectionsEditor value={terms.sections} readOnly={readOnly} onChange={(sections) => setTerms({ sections })} />
      </ESectionCard>

      <ESectionCard title="Privacy policy">
        <EField label="Title">
          <ETextarea rows={2} value={privacy.title} disabled={readOnly} onChange={(e) => setPrivacy({ title: e.target.value })} />
        </EField>
        <EField label="Intro">
          <ETextarea rows={4} value={privacy.intro} disabled={readOnly} onChange={(e) => setPrivacy({ intro: e.target.value })} />
        </EField>
        <LegalSectionsEditor value={privacy.sections} readOnly={readOnly} onChange={(sections) => setPrivacy({ sections })} />
      </ESectionCard>
    </div>
  );
}
