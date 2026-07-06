"use client";

import type { WebsiteContent, WebsiteFeatureCard, WebsiteHeroStat, WebsiteTestimonial } from "@/lib/public-site/content";
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
  uid,
} from "../shared";

/* ── Reusable feature-card list editor (benefits / hosting / airbnb) ────── */
export function FeatureCardsEditor({
  hint,
  value,
  onChange,
  keyPrefix,
  uploadingKey,
  handleUpload,
  readOnly,
}: {
  hint: string;
  value: WebsiteFeatureCard[];
  onChange: (next: WebsiteFeatureCard[]) => void;
  keyPrefix: string;
  uploadingKey: string | null;
  handleUpload: SectionProps["handleUpload"];
  readOnly: boolean;
}) {
  const patch = (index: number, p: Partial<WebsiteFeatureCard>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...p } : row)));
  return (
    <div className="space-y-4">
      <EAddRow
        hint={hint}
        label="Add card"
        disabled={readOnly}
        onAdd={() =>
          onChange([
            ...value,
            { id: uid("card"), title: "New card", description: "Describe the service benefit.", imageUrl: "", imageAlt: "" },
          ])
        }
      />
      {value.map((card, index) => (
        <EListItem
          key={card.id}
          index={index}
          count={value.length}
          title={`Card ${index + 1}`}
          disabled={readOnly}
          onMoveUp={() => onChange(moveItem(value, index, -1))}
          onMoveDown={() => onChange(moveItem(value, index, 1))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        >
          <EField label="Title">
            <EInput value={card.title} disabled={readOnly} onChange={(e) => patch(index, { title: e.target.value })} />
          </EField>
          <EField label="Description">
            <ETextarea rows={3} value={card.description} disabled={readOnly} onChange={(e) => patch(index, { description: e.target.value })} />
          </EField>
          <EImageField
            label="Card image"
            value={card.imageUrl}
            alt={card.imageAlt}
            disabled={readOnly}
            uploading={uploadingKey === `${keyPrefix}-${card.id}`}
            onChange={(url) => patch(index, { imageUrl: url })}
            onAltChange={(alt) => patch(index, { imageAlt: alt })}
            onUpload={(file) => handleUpload(`${keyPrefix}-${card.id}`, file, (url) => patch(index, { imageUrl: url }))}
          />
        </EListItem>
      ))}
    </div>
  );
}

export function HomeSection({ content, setContent, readOnly, uploadingKey, handleUpload }: SectionProps) {
  const home = content.home;
  const setHome = (p: Partial<WebsiteContent["home"]>) =>
    setContent((c) => ({ ...c, home: { ...c.home, ...p } }));

  return (
    <div className="space-y-5">
      <ESectionCard title="Hero & call to action">
        <EField label="Eyebrow">
          <EInput value={home.eyebrow} disabled={readOnly} onChange={(e) => setHome({ eyebrow: e.target.value })} />
        </EField>
        <EField label="Headline">
          <ETextarea rows={3} value={home.title} disabled={readOnly} onChange={(e) => setHome({ title: e.target.value })} />
        </EField>
        <EField label="Subtitle">
          <ETextarea rows={3} value={home.subtitle} disabled={readOnly} onChange={(e) => setHome({ subtitle: e.target.value })} />
        </EField>
        <EField label="Brand idea / positioning">
          <ETextarea rows={3} value={home.brandIdea} disabled={readOnly} onChange={(e) => setHome({ brandIdea: e.target.value })} />
        </EField>
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Primary CTA label">
            <EInput value={home.primaryCtaLabel} disabled={readOnly} onChange={(e) => setHome({ primaryCtaLabel: e.target.value })} />
          </EField>
          <EField label="Secondary CTA label">
            <EInput value={home.secondaryCtaLabel} disabled={readOnly} onChange={(e) => setHome({ secondaryCtaLabel: e.target.value })} />
          </EField>
        </div>
        <EImageField
          label="Hero image"
          value={home.heroImageUrl}
          alt={home.heroImageAlt}
          disabled={readOnly}
          uploading={uploadingKey === "home-hero"}
          onChange={(url) => setHome({ heroImageUrl: url })}
          onAltChange={(alt) => setHome({ heroImageAlt: alt })}
          onUpload={(file) => handleUpload("home-hero", file, (url) => setHome({ heroImageUrl: url }))}
        />
      </ESectionCard>

      <ESectionCard title="Homepage stats" description="Three headline stats shown in the hero.">
        <StatsEditor value={home.stats} readOnly={readOnly} onChange={(stats) => setHome({ stats })} />
      </ESectionCard>

      <ESectionCard title="Service benefit cards">
        <EField label="Section title">
          <EInput value={home.servicesTitle} disabled={readOnly} onChange={(e) => setHome({ servicesTitle: e.target.value })} />
        </EField>
        <EField label="Section intro">
          <ETextarea rows={3} value={home.servicesIntro} disabled={readOnly} onChange={(e) => setHome({ servicesIntro: e.target.value })} />
        </EField>
        <FeatureCardsEditor
          hint="Cards under the services section"
          keyPrefix="benefit"
          value={home.serviceBenefits}
          readOnly={readOnly}
          uploadingKey={uploadingKey}
          handleUpload={handleUpload}
          onChange={(serviceBenefits) => setHome({ serviceBenefits })}
        />
      </ESectionCard>

      <ESectionCard title="Hosting support cards">
        <EField label="Section title">
          <EInput value={home.hostingTitle} disabled={readOnly} onChange={(e) => setHome({ hostingTitle: e.target.value })} />
        </EField>
        <EField label="Section intro">
          <ETextarea rows={3} value={home.hostingIntro} disabled={readOnly} onChange={(e) => setHome({ hostingIntro: e.target.value })} />
        </EField>
        <FeatureCardsEditor
          hint="Cards in the Airbnb / managed-property strip"
          keyPrefix="hosting"
          value={home.hostingFeatures}
          readOnly={readOnly}
          uploadingKey={uploadingKey}
          handleUpload={handleUpload}
          onChange={(hostingFeatures) => setHome({ hostingFeatures })}
        />
      </ESectionCard>

      <ESectionCard title="Testimonials & final CTA">
        <TestimonialsEditor
          value={home.testimonials}
          readOnly={readOnly}
          onChange={(testimonials) => setHome({ testimonials })}
        />
        <EField label="Final CTA title">
          <EInput value={home.finalCtaTitle} disabled={readOnly} onChange={(e) => setHome({ finalCtaTitle: e.target.value })} />
        </EField>
        <EField label="Final CTA body">
          <ETextarea rows={3} value={home.finalCtaBody} disabled={readOnly} onChange={(e) => setHome({ finalCtaBody: e.target.value })} />
        </EField>
      </ESectionCard>
    </div>
  );
}

function StatsEditor({
  value,
  onChange,
  readOnly,
}: {
  value: WebsiteHeroStat[];
  onChange: (next: WebsiteHeroStat[]) => void;
  readOnly: boolean;
}) {
  const patch = (i: number, p: Partial<WebsiteHeroStat>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...p } : row)));
  return (
    <div className="space-y-4">
      <EAddRow
        hint="Headline metrics"
        label="Add stat"
        disabled={readOnly}
        onAdd={() => onChange([...value, { value: "0", label: "Metric", note: "" }])}
      />
      {value.map((item, index) => (
        <EListItem
          key={index}
          index={index}
          count={value.length}
          title={`Stat ${index + 1}`}
          disabled={readOnly}
          onMoveUp={() => onChange(moveItem(value, index, -1))}
          onMoveDown={() => onChange(moveItem(value, index, 1))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <EField label="Value">
              <EInput value={item.value} disabled={readOnly} onChange={(e) => patch(index, { value: e.target.value })} />
            </EField>
            <EField label="Label">
              <EInput value={item.label} disabled={readOnly} onChange={(e) => patch(index, { label: e.target.value })} />
            </EField>
            <EField label="Note">
              <EInput value={item.note} disabled={readOnly} onChange={(e) => patch(index, { note: e.target.value })} />
            </EField>
          </div>
        </EListItem>
      ))}
    </div>
  );
}

function TestimonialsEditor({
  value,
  onChange,
  readOnly,
}: {
  value: WebsiteTestimonial[];
  onChange: (next: WebsiteTestimonial[]) => void;
  readOnly: boolean;
}) {
  const patch = (i: number, p: Partial<WebsiteTestimonial>) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...p } : row)));
  return (
    <div className="space-y-4">
      <EAddRow
        hint="Homepage testimonials"
        label="Add testimonial"
        disabled={readOnly}
        onAdd={() => onChange([...value, { quote: "New testimonial", author: "Customer", meta: "Service type" }])}
      />
      {value.map((item, index) => (
        <EListItem
          key={index}
          index={index}
          count={value.length}
          title={`Testimonial ${index + 1}`}
          disabled={readOnly}
          onMoveUp={() => onChange(moveItem(value, index, -1))}
          onMoveDown={() => onChange(moveItem(value, index, 1))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <EField label="Author">
              <EInput value={item.author} disabled={readOnly} onChange={(e) => patch(index, { author: e.target.value })} />
            </EField>
            <EField label="Meta">
              <EInput value={item.meta} disabled={readOnly} onChange={(e) => patch(index, { meta: e.target.value })} />
            </EField>
          </div>
          <EField label="Quote">
            <ETextarea rows={3} value={item.quote} disabled={readOnly} onChange={(e) => patch(index, { quote: e.target.value })} />
          </EField>
        </EListItem>
      ))}
    </div>
  );
}
