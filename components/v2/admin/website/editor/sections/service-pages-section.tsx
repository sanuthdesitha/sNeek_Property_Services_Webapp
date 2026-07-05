"use client";

import * as React from "react";
import type { WebsiteServicePage } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import {
  ESectionCard,
  EImageField,
  EListItem,
  EAddRow,
  EField,
  EInput,
  ETextarea,
  moveItem,
} from "../shared";
import { ESelectNative } from "@/components/v2/admin/settings/estate-form";

const BLANK_PAGE: WebsiteServicePage = {
  heroImageUrl: "",
  heroImageAlt: "",
  whatIncluded: [],
  notIncluded: [],
  idealFor: "",
  priceGuide: "",
  faq: [],
};

export function ServicePagesSection({
  content,
  setContent,
  readOnly,
  uploadingKey,
  handleUpload,
  services,
}: SectionProps & { services: ReadonlyArray<{ slug: string; label: string }> }) {
  const [slug, setSlug] = React.useState(services[0]?.slug ?? "");
  const page: WebsiteServicePage = content.servicePages?.[slug] ?? BLANK_PAGE;

  const update = (p: Partial<WebsiteServicePage>) =>
    setContent((c) => ({
      ...c,
      servicePages: { ...c.servicePages, [slug]: { ...(c.servicePages?.[slug] ?? BLANK_PAGE), ...p } },
    }));

  return (
    <ESectionCard
      title="Individual service pages"
      description="Per-service detail page content — hero image, what's included / not included, price guide and service-specific FAQ."
    >
      <EField label="Service">
        <ESelectNative value={slug} onChange={(e) => setSlug(e.target.value)}>
          {services.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </ESelectNative>
      </EField>

      {slug ? (
        <div className="space-y-4 pt-2">
          <EImageField
            label="Hero image"
            value={page.heroImageUrl}
            alt={page.heroImageAlt}
            disabled={readOnly}
            uploading={uploadingKey === `svcpage-${slug}`}
            onChange={(url) => update({ heroImageUrl: url })}
            onAltChange={(alt) => update({ heroImageAlt: alt })}
            onUpload={(file) => handleUpload(`svcpage-${slug}`, file, (url) => update({ heroImageUrl: url }))}
          />
          <EField label="What's included (one item per line)">
            <ETextarea
              rows={8}
              disabled={readOnly}
              value={page.whatIncluded.join("\n")}
              onChange={(e) => update({ whatIncluded: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
            />
          </EField>
          <EField label="Not included (one item per line)">
            <ETextarea
              rows={5}
              disabled={readOnly}
              value={page.notIncluded.join("\n")}
              onChange={(e) => update({ notIncluded: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })}
            />
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Ideal for">
              <ETextarea rows={3} value={page.idealFor} disabled={readOnly} onChange={(e) => update({ idealFor: e.target.value })} />
            </EField>
            <EField label="Price guide">
              <ETextarea rows={3} value={page.priceGuide} disabled={readOnly} onChange={(e) => update({ priceGuide: e.target.value })} />
            </EField>
          </div>

          <EAddRow
            hint="Service-specific FAQ (3–4 items recommended)"
            label="Add FAQ"
            disabled={readOnly}
            onAdd={() => update({ faq: [...page.faq, { question: "New question?", answer: "Answer here." }] })}
          />
          {page.faq.map((item, idx) => (
            <EListItem
              key={`${slug}-faq-${idx}`}
              index={idx}
              count={page.faq.length}
              title={item.question || `FAQ ${idx + 1}`}
              disabled={readOnly}
              onMoveUp={() => update({ faq: moveItem(page.faq, idx, -1) })}
              onMoveDown={() => update({ faq: moveItem(page.faq, idx, 1) })}
              onRemove={() => update({ faq: page.faq.filter((_, i) => i !== idx) })}
            >
              <EField label="Question">
                <EInput
                  value={item.question}
                  disabled={readOnly}
                  onChange={(e) => update({ faq: page.faq.map((row, i) => (i === idx ? { ...row, question: e.target.value } : row)) })}
                />
              </EField>
              <EField label="Answer">
                <ETextarea
                  rows={3}
                  value={item.answer}
                  disabled={readOnly}
                  onChange={(e) => update({ faq: page.faq.map((row, i) => (i === idx ? { ...row, answer: e.target.value } : row)) })}
                />
              </EField>
            </EListItem>
          ))}
        </div>
      ) : null}
    </ESectionCard>
  );
}
