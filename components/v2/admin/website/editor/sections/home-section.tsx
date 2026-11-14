"use client";

import type { WebsiteContent, WebsiteFeatureCard, WebsiteHeroStat, WebsiteTestimonial } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { CHANGED_OUTLINE_CLASS, ChangedField, useFieldChange } from "../changes-context";
import {
  EFoldSection,
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
  pathPrefix,
  uploadingKey,
  handleUpload,
  readOnly,
}: {
  hint: string;
  /** Content path of the list, e.g. "home.serviceBenefits" (unsaved-change marks). */
  pathPrefix: string;
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
            path={`${pathPrefix}[${index}].imageUrl`}
            altPath={`${pathPrefix}[${index}].imageAlt`}
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
    <div className="space-y-4">
      <div className="space-y-3">
        <ChangedField path="home.eyebrow" label="Eyebrow">
          <EInput value={home.eyebrow} disabled={readOnly} onChange={(e) => setHome({ eyebrow: e.target.value })} />
        </ChangedField>
        <ChangedField path="home.title" label="Headline">
          <EInput value={home.title} disabled={readOnly} onChange={(e) => setHome({ title: e.target.value })} />
        </ChangedField>
        <ChangedField path="home.subtitle" label="Subtitle">
          <ETextarea rows={2} value={home.subtitle} disabled={readOnly} onChange={(e) => setHome({ subtitle: e.target.value })} />
        </ChangedField>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChangedField path="home.primaryCtaLabel" label="Main button">
            <EInput value={home.primaryCtaLabel} disabled={readOnly} onChange={(e) => setHome({ primaryCtaLabel: e.target.value })} />
          </ChangedField>
          <ChangedField path="home.secondaryCtaLabel" label="Second button">
            <EInput value={home.secondaryCtaLabel} disabled={readOnly} onChange={(e) => setHome({ secondaryCtaLabel: e.target.value })} />
          </ChangedField>
        </div>
        <EImageField
          label="Hero image"
          path="home.heroImageUrl"
          altPath="home.heroImageAlt"
          value={home.heroImageUrl}
          alt={home.heroImageAlt}
          disabled={readOnly}
          uploading={uploadingKey === "home-hero"}
          onChange={(url) => setHome({ heroImageUrl: url })}
          onAltChange={(alt) => setHome({ heroImageAlt: alt })}
          onUpload={(file) => handleUpload("home-hero", file, (url) => setHome({ heroImageUrl: url }))}
        />
        <ChangedField path="home.brandIdea" label="Positioning line">
          <ETextarea rows={2} value={home.brandIdea} disabled={readOnly} onChange={(e) => setHome({ brandIdea: e.target.value })} />
        </ChangedField>
      </div>

      <div className="space-y-2">
        <EEyebrow className="text-[0.625rem]">Figures</EEyebrow>
        <StatsEditor value={home.stats} readOnly={readOnly} onChange={(stats) => setHome({ stats })} />
      </div>

      <EFoldSection title="Benefit cards" changePath="home.serviceBenefits" extraPaths={["home.servicesTitle", "home.servicesIntro"]}>
        <ChangedField path="home.servicesTitle" label="Section title">
          <EInput value={home.servicesTitle} disabled={readOnly} onChange={(e) => setHome({ servicesTitle: e.target.value })} />
        </ChangedField>
        <ChangedField path="home.servicesIntro" label="Section introduction">
          <ETextarea rows={3} value={home.servicesIntro} disabled={readOnly} onChange={(e) => setHome({ servicesIntro: e.target.value })} />
        </ChangedField>
        <FeatureCardsEditor
          hint="Cards under the services section"
          keyPrefix="benefit"
          pathPrefix="home.serviceBenefits"
          value={home.serviceBenefits}
          readOnly={readOnly}
          uploadingKey={uploadingKey}
          handleUpload={handleUpload}
          onChange={(serviceBenefits) => setHome({ serviceBenefits })}
        />
      </EFoldSection>

      <EFoldSection title="Hosting strip" changePath="home.hostingFeatures" extraPaths={["home.hostingTitle", "home.hostingIntro"]}>
        <ChangedField path="home.hostingTitle" label="Section title">
          <EInput value={home.hostingTitle} disabled={readOnly} onChange={(e) => setHome({ hostingTitle: e.target.value })} />
        </ChangedField>
        <ChangedField path="home.hostingIntro" label="Section introduction">
          <ETextarea rows={3} value={home.hostingIntro} disabled={readOnly} onChange={(e) => setHome({ hostingIntro: e.target.value })} />
        </ChangedField>
        <FeatureCardsEditor
          hint="Cards in the Airbnb / managed-property strip"
          keyPrefix="hosting"
          pathPrefix="home.hostingFeatures"
          value={home.hostingFeatures}
          readOnly={readOnly}
          uploadingKey={uploadingKey}
          handleUpload={handleUpload}
          onChange={(hostingFeatures) => setHome({ hostingFeatures })}
        />
      </EFoldSection>

      <EFoldSection title="Testimonials" changePath="home.testimonials">
        <TestimonialsEditor value={home.testimonials} readOnly={readOnly} onChange={(testimonials) => setHome({ testimonials })} />
      </EFoldSection>

      <EFoldSection title="Final call to action" changePath="home.finalCtaTitle" extraPaths={["home.finalCtaBody"]}>
        <ChangedField path="home.finalCtaTitle" label="Title">
          <EInput value={home.finalCtaTitle} disabled={readOnly} onChange={(e) => setHome({ finalCtaTitle: e.target.value })} />
        </ChangedField>
        <ChangedField path="home.finalCtaBody" label="Wording">
          <ETextarea rows={3} value={home.finalCtaBody} disabled={readOnly} onChange={(e) => setHome({ finalCtaBody: e.target.value })} />
        </ChangedField>
      </EFoldSection>
    </div>
  );
}

/** Figures as compact rows (value, label, note) with keyboard move buttons. */
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
    <div className="space-y-2">
      {value.map((item, index) => (
        <FigureRow
          key={index}
          index={index}
          count={value.length}
          item={item}
          readOnly={readOnly}
          onPatch={(p) => patch(index, p)}
          onMove={(dir) => onChange(moveItem(value, index, dir))}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
      {!readOnly ? (
        <EButton variant="outline" size="sm" onClick={() => onChange([...value, { value: "", label: "", note: "" }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add figure
        </EButton>
      ) : null}
    </div>
  );
}

function FigureRow({
  index,
  count,
  item,
  readOnly,
  onPatch,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  item: WebsiteHeroStat;
  readOnly: boolean;
  onPatch: (p: Partial<WebsiteHeroStat>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const change = useFieldChange(`home.stats[${index}]`);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 sm:flex-nowrap",
        change.changed && CHANGED_OUTLINE_CLASS
      )}
    >
      {!readOnly ? (
        <span className="flex shrink-0 flex-col">
          <button type="button" className="px-1 text-[hsl(var(--e-muted-foreground))] disabled:opacity-30 max-sm:min-h-[22px]" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move figure ${index + 1} up`}>
            <ArrowUp className="h-3 w-3" aria-hidden />
          </button>
          <button type="button" className="px-1 text-[hsl(var(--e-muted-foreground))] disabled:opacity-30 max-sm:min-h-[22px]" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move figure ${index + 1} down`}>
            <ArrowDown className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ) : null}
      <EInput aria-label={`Figure ${index + 1} value`} className="w-24 shrink-0 font-[600]" value={item.value} disabled={readOnly} onChange={(e) => onPatch({ value: e.target.value })} placeholder="4,800+" />
      <EInput aria-label={`Figure ${index + 1} label`} className="min-w-0 flex-1" value={item.label} disabled={readOnly} onChange={(e) => onPatch({ label: e.target.value })} placeholder="turnovers this year" />
      <EInput aria-label={`Figure ${index + 1} note`} className="min-w-0 flex-1 max-sm:basis-full" value={item.note} disabled={readOnly} onChange={(e) => onPatch({ note: e.target.value })} placeholder="Note (optional)" />
      {!readOnly ? (
        <EButton variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove figure ${index + 1}`}>
          <X className="h-3.5 w-3.5" aria-hidden />
        </EButton>
      ) : null}
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
