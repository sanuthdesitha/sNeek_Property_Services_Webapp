"use client";

import type { WebsiteContent } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import { ESectionCard, EImageField, EField, EInput, ETextarea } from "../shared";
import { FeatureCardsEditor } from "./home-section";

export function PagesCopySection({ content, setContent, readOnly, uploadingKey, handleUpload }: SectionProps) {
  const setServices = (p: Partial<WebsiteContent["services"]>) =>
    setContent((c) => ({ ...c, services: { ...c.services, ...p } }));
  const setAirbnb = (p: Partial<WebsiteContent["airbnb"]>) =>
    setContent((c) => ({ ...c, airbnb: { ...c.airbnb, ...p } }));
  const setSubs = (p: Partial<WebsiteContent["subscriptions"]>) =>
    setContent((c) => ({ ...c, subscriptions: { ...c.subscriptions, ...p } }));

  const services = content.services;
  const airbnb = content.airbnb;
  const subs = content.subscriptions;

  return (
    <div className="space-y-5">
      <ESectionCard title="Services landing page">
        <EField label="Eyebrow">
          <EInput value={services.eyebrow} disabled={readOnly} onChange={(e) => setServices({ eyebrow: e.target.value })} />
        </EField>
        <EField label="Title">
          <ETextarea rows={2} value={services.title} disabled={readOnly} onChange={(e) => setServices({ title: e.target.value })} />
        </EField>
        <EField label="Intro">
          <ETextarea rows={4} value={services.intro} disabled={readOnly} onChange={(e) => setServices({ intro: e.target.value })} />
        </EField>
      </ESectionCard>

      <ESectionCard title="Airbnb hosting page">
        <EField label="Eyebrow">
          <EInput value={airbnb.eyebrow} disabled={readOnly} onChange={(e) => setAirbnb({ eyebrow: e.target.value })} />
        </EField>
        <EField label="Title">
          <ETextarea rows={2} value={airbnb.title} disabled={readOnly} onChange={(e) => setAirbnb({ title: e.target.value })} />
        </EField>
        <EField label="Subtitle">
          <ETextarea rows={3} value={airbnb.subtitle} disabled={readOnly} onChange={(e) => setAirbnb({ subtitle: e.target.value })} />
        </EField>
        <EImageField
          label="Airbnb hero image"
          value={airbnb.heroImageUrl}
          alt={airbnb.heroImageAlt}
          disabled={readOnly}
          uploading={uploadingKey === "airbnb-hero"}
          onChange={(url) => setAirbnb({ heroImageUrl: url })}
          onAltChange={(alt) => setAirbnb({ heroImageAlt: alt })}
          onUpload={(file) => handleUpload("airbnb-hero", file, (url) => setAirbnb({ heroImageUrl: url }))}
        />
        <EField label="Features section title">
          <EInput value={airbnb.featuresTitle} disabled={readOnly} onChange={(e) => setAirbnb({ featuresTitle: e.target.value })} />
        </EField>
        <EField label="Features intro">
          <ETextarea rows={3} value={airbnb.featuresIntro} disabled={readOnly} onChange={(e) => setAirbnb({ featuresIntro: e.target.value })} />
        </EField>
        <FeatureCardsEditor
          hint="Airbnb support feature cards"
          keyPrefix="airbnb-feat"
          value={airbnb.features}
          readOnly={readOnly}
          uploadingKey={uploadingKey}
          handleUpload={handleUpload}
          onChange={(features) => setAirbnb({ features })}
        />
        <EField label="Reports section title">
          <EInput value={airbnb.reportsTitle} disabled={readOnly} onChange={(e) => setAirbnb({ reportsTitle: e.target.value })} />
        </EField>
        <EField label="Reports section body">
          <ETextarea rows={3} value={airbnb.reportsBody} disabled={readOnly} onChange={(e) => setAirbnb({ reportsBody: e.target.value })} />
        </EField>
      </ESectionCard>

      <ESectionCard
        title="Subscriptions page"
        description="Subscription cards and starting prices are managed under Admin → Growth/Marketing. This page controls the supporting copy."
      >
        <EField label="Eyebrow">
          <EInput value={subs.eyebrow} disabled={readOnly} onChange={(e) => setSubs({ eyebrow: e.target.value })} />
        </EField>
        <EField label="Title">
          <ETextarea rows={2} value={subs.title} disabled={readOnly} onChange={(e) => setSubs({ title: e.target.value })} />
        </EField>
        <EField label="Intro">
          <ETextarea rows={4} value={subs.intro} disabled={readOnly} onChange={(e) => setSubs({ intro: e.target.value })} />
        </EField>
        <EField label="Compare section title">
          <EInput value={subs.compareTitle} disabled={readOnly} onChange={(e) => setSubs({ compareTitle: e.target.value })} />
        </EField>
        <EField label="Compare section body">
          <ETextarea rows={3} value={subs.compareBody} disabled={readOnly} onChange={(e) => setSubs({ compareBody: e.target.value })} />
        </EField>
      </ESectionCard>
    </div>
  );
}
