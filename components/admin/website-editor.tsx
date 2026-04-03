"use client";

import { useMemo, useRef, useState } from "react";
import { Eye, Save, Upload, RotateCcw, Globe } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_WEBSITE_CONTENT, type WebsiteContent, type WebsiteFeatureCard, type WebsiteFaqItem, type WebsiteGalleryItem, type WebsiteHeroStat, type WebsiteLegalSection, type WebsitePartner, type WebsiteServicePage, type WebsiteTestimonial, type WebsiteWhyItem } from "@/lib/public-site/content";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminPageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function cloneContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ImageField({
  label,
  value,
  alt,
  onChange,
  onAltChange,
  onUpload,
  uploading,
}: {
  label: string;
  value: string;
  alt: string;
  onChange: (value: string) => void;
  onAltChange: (value: string) => void;
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="overflow-hidden rounded-[1.3rem] border border-border/70 bg-muted/20">
        {value ? (
          <img src={value} alt={alt || label} className="h-48 w-full object-cover" />
        ) : (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No image selected</div>
        )}
      </div>
      <div className="space-y-3">
        <Field label={`${label} URL`}>
          <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://..." />
        </Field>
        <Field label={`${label} alt text`}>
          <Input value={alt} onChange={(event) => onAltChange(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await onUpload(file);
              event.currentTarget.value = "";
            }}
          />
          <Button type="button" variant="outline" className="rounded-full" onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Uploading..." : "Upload image"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function HeroStatsEditor({ value, onChange }: { value: WebsiteHeroStat[]; onChange: (next: WebsiteHeroStat[]) => void }) {
  return (
    <div className="space-y-4">
      {value.map((item, index) => (
        <div key={`${item.label}-${index}`} className="grid gap-3 rounded-[1.2rem] border border-border/70 p-4 md:grid-cols-3">
          <Input value={item.value} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row))} placeholder="Value" />
          <Input value={item.label} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} placeholder="Label" />
          <Input value={item.note} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, note: event.target.value } : row))} placeholder="Note" />
        </div>
      ))}
    </div>
  );
}

function FeatureCardsEditor({
  title,
  value,
  onChange,
  onUpload,
  uploadingKey,
}: {
  title: string;
  value: WebsiteFeatureCard[];
  onChange: (next: WebsiteFeatureCard[]) => void;
  onUpload: (id: string, file: File) => Promise<void>;
  uploadingKey: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => onChange([...value, { id: uid("card"), title: "New card", description: "Describe the service benefit.", imageUrl: "", imageAlt: "" }])}
        >
          Add card
        </Button>
      </div>
      {value.map((card, index) => (
        <Card key={card.id} className="rounded-[1.4rem] border border-border/70 bg-white">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Card {index + 1}</p>
              <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button>
            </div>
            <Field label="Title">
              <Input value={card.title} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))} />
            </Field>
            <Field label="Description">
              <Textarea rows={4} value={card.description} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} />
            </Field>
            <ImageField
              label="Card image"
              value={card.imageUrl}
              alt={card.imageAlt}
              onChange={(next) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, imageUrl: next } : row))}
              onAltChange={(next) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, imageAlt: next } : row))}
              onUpload={(file) => onUpload(card.id, file)}
              uploading={uploadingKey === card.id}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TestimonialsEditor({ value, onChange }: { value: WebsiteTestimonial[]; onChange: (next: WebsiteTestimonial[]) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Testimonials on the homepage</p>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => onChange([...value, { quote: "New testimonial", author: "Customer", meta: "Service type" }])}>Add testimonial</Button>
      </div>
      {value.map((item, index) => (
        <div key={`${item.author}-${index}`} className="space-y-3 rounded-[1.2rem] border border-border/70 p-4">
          <Input value={item.author} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, author: event.target.value } : row))} placeholder="Author" />
          <Input value={item.meta} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, meta: event.target.value } : row))} placeholder="Meta" />
          <Textarea rows={4} value={item.quote} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, quote: event.target.value } : row))} placeholder="Quote" />
          <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}>Remove testimonial</Button>
        </div>
      ))}
    </div>
  );
}

function LegalSectionsEditor({ value, onChange }: { value: WebsiteLegalSection[]; onChange: (next: WebsiteLegalSection[]) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Structured sections shown on the public legal page</p>
        <Button type="button" variant="outline" className="rounded-full" onClick={() => onChange([...value, { title: "New section", body: "Describe the policy or term here.", bullets: ["Add bullet point"] }])}>Add section</Button>
      </div>
      {value.map((section, index) => (
        <div key={`${section.title}-${index}`} className="space-y-3 rounded-[1.2rem] border border-border/70 p-4">
          <Input value={section.title} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))} placeholder="Section title" />
          <Textarea rows={4} value={section.body} onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, body: event.target.value } : row))} placeholder="Body" />
          <Textarea
            rows={5}
            value={section.bullets.join("\n")}
            onChange={(event) => onChange(value.map((row, rowIndex) => rowIndex === index ? { ...row, bullets: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : row))}
            placeholder="One bullet per line"
          />
          <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}>Remove section</Button>
        </div>
      ))}
    </div>
  );
}

export function WebsiteEditor({ initialContent }: { initialContent: WebsiteContent }) {
  const [content, setContent] = useState<WebsiteContent>(() => cloneContent(initialContent));
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialContent, null, 2));
  const [selectedServiceSlug, setSelectedServiceSlug] = useState(MARKETED_SERVICES[0]?.slug ?? "");

  const previewLinks = useMemo(
    () => [
      { href: "/", label: "Home" },
      { href: "/services", label: "Services" },
      { href: "/airbnb-hosting", label: "Airbnb page" },
      { href: "/subscriptions", label: "Subscriptions" },
      { href: "/contact", label: "Contact" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
    []
  );

  async function uploadWebsiteImage(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "website");
    const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error ?? "Could not upload image.");
    }
    return body.url as string;
  }

  async function handleCardUpload(path: string, file: File, apply: (url: string) => void) {
    setUploadingKey(path);
    try {
      const url = await uploadWebsiteImage(file);
      apply(url);
      toast({ title: "Image uploaded" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message ?? "Could not upload image.", variant: "destructive" });
    } finally {
      setUploadingKey(null);
    }
  }

  async function saveContent(nextContent = content) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteContent: nextContent }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save website content.");
      }
      setContent(body.websiteContent ?? nextContent);
      setRawJson(JSON.stringify(body.websiteContent ?? nextContent, null, 2));
      toast({ title: "Website updated" });
    } catch (error: any) {
      toast({ title: "Save failed", description: error.message ?? "Could not save website content.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPageShell
      eyebrow="Website"
      title="Public website editor"
      description="Edit customer-facing page content, public images, and contact-recipient emails without changing the operational portals."
      actions={
        <div className="flex flex-wrap gap-2">
          {previewLinks.map((link) => (
            <Button key={link.href} type="button" variant="outline" className="rounded-full" asChild>
              <a href={link.href} target="_blank" rel="noreferrer">
                <Eye className="mr-2 h-4 w-4" />
                {link.label}
              </a>
            </Button>
          ))}
          <Button type="button" className="rounded-full" onClick={() => saveContent()} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save website"}
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="home" className="space-y-5">
        <TabsList className="flex h-auto flex-wrap justify-start gap-2 rounded-[1.2rem] bg-transparent p-0">
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="airbnb">Airbnb</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
          <TabsTrigger value="why-us">Why Us</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="partners">Partners</TabsTrigger>
          <TabsTrigger value="gallery">Gallery</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
          <TabsTrigger value="service-pages">Service Pages</TabsTrigger>
          <TabsTrigger value="layout">Layout</TabsTrigger>
          <TabsTrigger value="json">Raw JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="space-y-5">
          <SectionCard title="Hero and call to action">
            <Field label="Eyebrow"><Input value={content.home.eyebrow} onChange={(event) => setContent({ ...content, home: { ...content.home, eyebrow: event.target.value } })} /></Field>
            <Field label="Headline"><Textarea rows={3} value={content.home.title} onChange={(event) => setContent({ ...content, home: { ...content.home, title: event.target.value } })} /></Field>
            <Field label="Subtitle"><Textarea rows={4} value={content.home.subtitle} onChange={(event) => setContent({ ...content, home: { ...content.home, subtitle: event.target.value } })} /></Field>
            <Field label="Brand idea / sNeek positioning"><Textarea rows={4} value={content.home.brandIdea} onChange={(event) => setContent({ ...content, home: { ...content.home, brandIdea: event.target.value } })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Primary CTA label"><Input value={content.home.primaryCtaLabel} onChange={(event) => setContent({ ...content, home: { ...content.home, primaryCtaLabel: event.target.value } })} /></Field>
              <Field label="Secondary CTA label"><Input value={content.home.secondaryCtaLabel} onChange={(event) => setContent({ ...content, home: { ...content.home, secondaryCtaLabel: event.target.value } })} /></Field>
            </div>
            <ImageField
              label="Hero image"
              value={content.home.heroImageUrl}
              alt={content.home.heroImageAlt}
              onChange={(next) => setContent({ ...content, home: { ...content.home, heroImageUrl: next } })}
              onAltChange={(next) => setContent({ ...content, home: { ...content.home, heroImageAlt: next } })}
              onUpload={(file) => handleCardUpload("home-hero", file, (url) => setContent({ ...content, home: { ...content.home, heroImageUrl: url } }))}
              uploading={uploadingKey === "home-hero"}
            />
          </SectionCard>

          <SectionCard title="Homepage stats">
            <HeroStatsEditor value={content.home.stats} onChange={(next) => setContent({ ...content, home: { ...content.home, stats: next } })} />
          </SectionCard>

          <SectionCard title="Service benefit cards">
            <Field label="Section title"><Input value={content.home.servicesTitle} onChange={(event) => setContent({ ...content, home: { ...content.home, servicesTitle: event.target.value } })} /></Field>
            <Field label="Section intro"><Textarea rows={4} value={content.home.servicesIntro} onChange={(event) => setContent({ ...content, home: { ...content.home, servicesIntro: event.target.value } })} /></Field>
            <FeatureCardsEditor
              title="Cards shown under the services section"
              value={content.home.serviceBenefits}
              onChange={(next) => setContent({ ...content, home: { ...content.home, serviceBenefits: next } })}
              onUpload={(id, file) => handleCardUpload(id, file, (url) => setContent({ ...content, home: { ...content.home, serviceBenefits: content.home.serviceBenefits.map((card) => card.id === id ? { ...card, imageUrl: url } : card) } }))}
              uploadingKey={uploadingKey}
            />
          </SectionCard>

          <SectionCard title="Hosting support cards">
            <Field label="Section title"><Input value={content.home.hostingTitle} onChange={(event) => setContent({ ...content, home: { ...content.home, hostingTitle: event.target.value } })} /></Field>
            <Field label="Section intro"><Textarea rows={4} value={content.home.hostingIntro} onChange={(event) => setContent({ ...content, home: { ...content.home, hostingIntro: event.target.value } })} /></Field>
            <FeatureCardsEditor
              title="Cards shown in the Airbnb / managed-property strip"
              value={content.home.hostingFeatures}
              onChange={(next) => setContent({ ...content, home: { ...content.home, hostingFeatures: next } })}
              onUpload={(id, file) => handleCardUpload(id, file, (url) => setContent({ ...content, home: { ...content.home, hostingFeatures: content.home.hostingFeatures.map((card) => card.id === id ? { ...card, imageUrl: url } : card) } }))}
              uploadingKey={uploadingKey}
            />
          </SectionCard>

          <SectionCard title="Testimonials and final CTA">
            <TestimonialsEditor value={content.home.testimonials} onChange={(next) => setContent({ ...content, home: { ...content.home, testimonials: next } })} />
            <Field label="Final CTA title"><Input value={content.home.finalCtaTitle} onChange={(event) => setContent({ ...content, home: { ...content.home, finalCtaTitle: event.target.value } })} /></Field>
            <Field label="Final CTA body"><Textarea rows={4} value={content.home.finalCtaBody} onChange={(event) => setContent({ ...content, home: { ...content.home, finalCtaBody: event.target.value } })} /></Field>
          </SectionCard>
        </TabsContent>

        <TabsContent value="services" className="space-y-5">
          <SectionCard title="Services page intro">
            <Field label="Eyebrow"><Input value={content.services.eyebrow} onChange={(event) => setContent({ ...content, services: { ...content.services, eyebrow: event.target.value } })} /></Field>
            <Field label="Title"><Textarea rows={3} value={content.services.title} onChange={(event) => setContent({ ...content, services: { ...content.services, title: event.target.value } })} /></Field>
            <Field label="Intro"><Textarea rows={5} value={content.services.intro} onChange={(event) => setContent({ ...content, services: { ...content.services, intro: event.target.value } })} /></Field>
          </SectionCard>
        </TabsContent>

        <TabsContent value="airbnb" className="space-y-5">
          <SectionCard title="Airbnb hosting support page">
            <Field label="Eyebrow"><Input value={content.airbnb.eyebrow} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, eyebrow: event.target.value } })} /></Field>
            <Field label="Title"><Textarea rows={3} value={content.airbnb.title} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, title: event.target.value } })} /></Field>
            <Field label="Subtitle"><Textarea rows={4} value={content.airbnb.subtitle} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, subtitle: event.target.value } })} /></Field>
            <ImageField
              label="Airbnb hero image"
              value={content.airbnb.heroImageUrl}
              alt={content.airbnb.heroImageAlt}
              onChange={(next) => setContent({ ...content, airbnb: { ...content.airbnb, heroImageUrl: next } })}
              onAltChange={(next) => setContent({ ...content, airbnb: { ...content.airbnb, heroImageAlt: next } })}
              onUpload={(file) => handleCardUpload("airbnb-hero", file, (url) => setContent({ ...content, airbnb: { ...content.airbnb, heroImageUrl: url } }))}
              uploading={uploadingKey === "airbnb-hero"}
            />
            <Field label="Features section title"><Input value={content.airbnb.featuresTitle} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, featuresTitle: event.target.value } })} /></Field>
            <Field label="Features intro"><Textarea rows={4} value={content.airbnb.featuresIntro} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, featuresIntro: event.target.value } })} /></Field>
            <FeatureCardsEditor
              title="Airbnb support feature cards"
              value={content.airbnb.features}
              onChange={(next) => setContent({ ...content, airbnb: { ...content.airbnb, features: next } })}
              onUpload={(id, file) => handleCardUpload(id, file, (url) => setContent({ ...content, airbnb: { ...content.airbnb, features: content.airbnb.features.map((card) => card.id === id ? { ...card, imageUrl: url } : card) } }))}
              uploadingKey={uploadingKey}
            />
            <Field label="Reports section title"><Input value={content.airbnb.reportsTitle} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, reportsTitle: event.target.value } })} /></Field>
            <Field label="Reports section body"><Textarea rows={4} value={content.airbnb.reportsBody} onChange={(event) => setContent({ ...content, airbnb: { ...content.airbnb, reportsBody: event.target.value } })} /></Field>
          </SectionCard>
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-5">
          <SectionCard title="Subscriptions page copy">
            <Field label="Eyebrow"><Input value={content.subscriptions.eyebrow} onChange={(event) => setContent({ ...content, subscriptions: { ...content.subscriptions, eyebrow: event.target.value } })} /></Field>
            <Field label="Title"><Textarea rows={3} value={content.subscriptions.title} onChange={(event) => setContent({ ...content, subscriptions: { ...content.subscriptions, title: event.target.value } })} /></Field>
            <Field label="Intro"><Textarea rows={5} value={content.subscriptions.intro} onChange={(event) => setContent({ ...content, subscriptions: { ...content.subscriptions, intro: event.target.value } })} /></Field>
            <Field label="Compare section title"><Input value={content.subscriptions.compareTitle} onChange={(event) => setContent({ ...content, subscriptions: { ...content.subscriptions, compareTitle: event.target.value } })} /></Field>
            <Field label="Compare section body"><Textarea rows={4} value={content.subscriptions.compareBody} onChange={(event) => setContent({ ...content, subscriptions: { ...content.subscriptions, compareBody: event.target.value } })} /></Field>
            <div className="rounded-[1.2rem] border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              Subscription cards and starting prices are managed in <strong>Admin - Marketing</strong>. This page controls the supporting copy around those plans.
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="contact" className="space-y-5">
          <SectionCard title="Contact page and footer">
            <Field label="Contact eyebrow"><Input value={content.contact.eyebrow} onChange={(event) => setContent({ ...content, contact: { ...content.contact, eyebrow: event.target.value } })} /></Field>
            <Field label="Contact title"><Textarea rows={3} value={content.contact.title} onChange={(event) => setContent({ ...content, contact: { ...content.contact, title: event.target.value } })} /></Field>
            <Field label="Contact intro"><Textarea rows={4} value={content.contact.intro} onChange={(event) => setContent({ ...content, contact: { ...content.contact, intro: event.target.value } })} /></Field>
            <Field label="Form intro"><Textarea rows={3} value={content.contact.formIntro} onChange={(event) => setContent({ ...content, contact: { ...content.contact, formIntro: event.target.value } })} /></Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Display email"><Input value={content.contact.displayEmail} onChange={(event) => setContent({ ...content, contact: { ...content.contact, displayEmail: event.target.value } })} /></Field>
              <Field label="Display phone"><Input value={content.contact.displayPhone} onChange={(event) => setContent({ ...content, contact: { ...content.contact, displayPhone: event.target.value } })} /></Field>
              <Field label="Display address"><Input value={content.contact.addressLine} onChange={(event) => setContent({ ...content, contact: { ...content.contact, addressLine: event.target.value } })} /></Field>
            </div>
            <Field label="Response promise"><Textarea rows={3} value={content.contact.responsePromise} onChange={(event) => setContent({ ...content, contact: { ...content.contact, responsePromise: event.target.value } })} /></Field>
            <Field label="Recipient emails for website contact enquiries (one per line)">
              <Textarea
                rows={4}
                value={content.contact.recipientEmails.join("\n")}
                onChange={(event) => setContent({ ...content, contact: { ...content.contact, recipientEmails: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })}
              />
            </Field>
            <p className="rounded-[1.2rem] border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              Public contact and quote submissions are emailed to these addresses. If this list is empty, the system falls back to the main accounts email.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Footer blurb"><Textarea rows={4} value={content.footer.blurb} onChange={(event) => setContent({ ...content, footer: { ...content.footer, blurb: event.target.value } })} /></Field>
              <Field label="Service areas"><Textarea rows={4} value={content.footer.areas} onChange={(event) => setContent({ ...content, footer: { ...content.footer, areas: event.target.value } })} /></Field>
              <Field label="Footer support line"><Textarea rows={4} value={content.footer.supportLine} onChange={(event) => setContent({ ...content, footer: { ...content.footer, supportLine: event.target.value } })} /></Field>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="terms" className="space-y-5">
          <SectionCard title="Terms and conditions page">
            <Field label="Title"><Textarea rows={2} value={content.terms.title} onChange={(event) => setContent({ ...content, terms: { ...content.terms, title: event.target.value } })} /></Field>
            <Field label="Intro"><Textarea rows={5} value={content.terms.intro} onChange={(event) => setContent({ ...content, terms: { ...content.terms, intro: event.target.value } })} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Insurance label"><Input value={content.terms.publicLiabilityLabel} onChange={(event) => setContent({ ...content, terms: { ...content.terms, publicLiabilityLabel: event.target.value } })} /></Field>
              <Field label="Insurance body"><Textarea rows={3} value={content.terms.publicLiabilityBody} onChange={(event) => setContent({ ...content, terms: { ...content.terms, publicLiabilityBody: event.target.value } })} /></Field>
            </div>
            <LegalSectionsEditor value={content.terms.sections} onChange={(next) => setContent({ ...content, terms: { ...content.terms, sections: next } })} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="privacy" className="space-y-5">
          <SectionCard title="Privacy policy page">
            <Field label="Title"><Textarea rows={2} value={content.privacy.title} onChange={(event) => setContent({ ...content, privacy: { ...content.privacy, title: event.target.value } })} /></Field>
            <Field label="Intro"><Textarea rows={5} value={content.privacy.intro} onChange={(event) => setContent({ ...content, privacy: { ...content.privacy, intro: event.target.value } })} /></Field>
            <LegalSectionsEditor value={content.privacy.sections} onChange={(next) => setContent({ ...content, privacy: { ...content.privacy, sections: next } })} />
          </SectionCard>
        </TabsContent>

        {/* ── Why Us ── */}
        <TabsContent value="why-us" className="space-y-5">
          <SectionCard title="Why choose us section">
            <Field label="Section title"><Input value={content.whyChooseUs?.title ?? ""} onChange={(e) => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, title: e.target.value } })} /></Field>
            <Field label="Section intro"><Textarea rows={4} value={content.whyChooseUs?.intro ?? ""} onChange={(e) => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, intro: e.target.value } })} /></Field>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Reason cards (icon, title, description)</p>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, items: [...(content.whyChooseUs?.items ?? []), { id: uid("why"), icon: "ShieldCheck", title: "New reason", description: "Describe why clients choose you." }] } })}>Add item</Button>
              </div>
              {(content.whyChooseUs?.items ?? []).map((item: WebsiteWhyItem, index: number) => (
                <div key={item.id} className="grid gap-3 rounded-[1.2rem] border border-border/70 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input value={item.icon} onChange={(e) => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, items: content.whyChooseUs.items.map((row, i) => i === index ? { ...row, icon: e.target.value } : row) } })} placeholder="Icon name (e.g. ShieldCheck)" />
                    <Input value={item.title} onChange={(e) => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, items: content.whyChooseUs.items.map((row, i) => i === index ? { ...row, title: e.target.value } : row) } })} placeholder="Title" />
                  </div>
                  <Textarea rows={2} value={item.description} onChange={(e) => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, items: content.whyChooseUs.items.map((row, i) => i === index ? { ...row, description: e.target.value } : row) } })} placeholder="Description" />
                  <Button type="button" variant="ghost" className="w-fit rounded-full text-destructive hover:text-destructive" onClick={() => setContent({ ...content, whyChooseUs: { ...content.whyChooseUs, items: content.whyChooseUs.items.filter((_, i) => i !== index) } })}>Remove</Button>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── FAQ ── */}
        <TabsContent value="faq" className="space-y-5">
          <SectionCard title="FAQ section">
            <Field label="Section title"><Input value={content.faq?.title ?? ""} onChange={(e) => setContent({ ...content, faq: { ...content.faq, title: e.target.value } })} /></Field>
            <Field label="Section intro"><Textarea rows={3} value={content.faq?.intro ?? ""} onChange={(e) => setContent({ ...content, faq: { ...content.faq, intro: e.target.value } })} /></Field>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">FAQ items (question, answer, category)</p>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setContent({ ...content, faq: { ...content.faq, items: [...(content.faq?.items ?? []), { id: uid("faq"), question: "New question?", answer: "Answer here.", category: "booking" }] } })}>Add FAQ</Button>
              </div>
              {(content.faq?.items ?? []).map((item: WebsiteFaqItem, index: number) => (
                <div key={item.id} className="space-y-3 rounded-[1.2rem] border border-border/70 p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                    <Input value={item.question} onChange={(e) => setContent({ ...content, faq: { ...content.faq, items: content.faq.items.map((row, i) => i === index ? { ...row, question: e.target.value } : row) } })} placeholder="Question" />
                    <Select value={item.category} onValueChange={(val) => setContent({ ...content, faq: { ...content.faq, items: content.faq.items.map((row, i) => i === index ? { ...row, category: val as WebsiteFaqItem["category"] } : row) } })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["booking", "pricing", "services", "trust", "airbnb"] as const).map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea rows={3} value={item.answer} onChange={(e) => setContent({ ...content, faq: { ...content.faq, items: content.faq.items.map((row, i) => i === index ? { ...row, answer: e.target.value } : row) } })} placeholder="Answer" />
                  <Button type="button" variant="ghost" className="w-fit rounded-full text-destructive hover:text-destructive" onClick={() => setContent({ ...content, faq: { ...content.faq, items: content.faq.items.filter((_, i) => i !== index) } })}>Remove</Button>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Partners ── */}
        <TabsContent value="partners" className="space-y-5">
          <SectionCard title="Partners / trusted by section">
            <Field label="Section title"><Input value={content.partners?.title ?? ""} onChange={(e) => setContent({ ...content, partners: { ...content.partners, title: e.target.value } })} /></Field>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Partner entries (name, logo, URL)</p>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setContent({ ...content, partners: { ...content.partners, items: [...(content.partners?.items ?? []), { id: uid("partner"), name: "Partner name", logoUrl: "", url: "" }] } })}>Add partner</Button>
              </div>
              {(content.partners?.items ?? []).map((item: WebsitePartner, index: number) => (
                <div key={item.id} className="grid gap-3 rounded-[1.2rem] border border-border/70 p-4 sm:grid-cols-3">
                  <Input value={item.name} onChange={(e) => setContent({ ...content, partners: { ...content.partners, items: content.partners.items.map((row, i) => i === index ? { ...row, name: e.target.value } : row) } })} placeholder="Name" />
                  <Input value={item.logoUrl} onChange={(e) => setContent({ ...content, partners: { ...content.partners, items: content.partners.items.map((row, i) => i === index ? { ...row, logoUrl: e.target.value } : row) } })} placeholder="Logo URL" />
                  <div className="flex gap-2">
                    <Input value={item.url} onChange={(e) => setContent({ ...content, partners: { ...content.partners, items: content.partners.items.map((row, i) => i === index ? { ...row, url: e.target.value } : row) } })} placeholder="Website URL" />
                    <Button type="button" variant="ghost" className="shrink-0 rounded-full text-destructive hover:text-destructive" onClick={() => setContent({ ...content, partners: { ...content.partners, items: content.partners.items.filter((_, i) => i !== index) } })}>✕</Button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Gallery ── */}
        <TabsContent value="gallery" className="space-y-5">
          <SectionCard title="Work gallery section">
            <Field label="Section title"><Input value={content.gallery?.title ?? ""} onChange={(e) => setContent({ ...content, gallery: { ...content.gallery, title: e.target.value } })} /></Field>
            <Field label="Section intro"><Textarea rows={3} value={content.gallery?.intro ?? ""} onChange={(e) => setContent({ ...content, gallery: { ...content.gallery, intro: e.target.value } })} /></Field>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Gallery images (URL, caption, service type)</p>
                <Button type="button" variant="outline" className="rounded-full" onClick={() => setContent({ ...content, gallery: { ...content.gallery, items: [...(content.gallery?.items ?? []), { id: uid("gallery"), imageUrl: "", imageAlt: "", caption: "Before & after", serviceType: "General Clean" }] } })}>Add image</Button>
              </div>
              {(content.gallery?.items ?? []).map((item: WebsiteGalleryItem, index: number) => (
                <div key={item.id} className="space-y-3 rounded-[1.2rem] border border-border/70 p-4">
                  <ImageField
                    label="Gallery image"
                    value={item.imageUrl}
                    alt={item.imageAlt}
                    onChange={(url) => setContent({ ...content, gallery: { ...content.gallery, items: content.gallery.items.map((row, i) => i === index ? { ...row, imageUrl: url } : row) } })}
                    onAltChange={(alt) => setContent({ ...content, gallery: { ...content.gallery, items: content.gallery.items.map((row, i) => i === index ? { ...row, imageAlt: alt } : row) } })}
                    onUpload={(file) => handleCardUpload(`gallery-${item.id}`, file, (url) => setContent({ ...content, gallery: { ...content.gallery, items: content.gallery.items.map((row, i) => i === index ? { ...row, imageUrl: url } : row) } }))}
                    uploading={uploadingKey === `gallery-${item.id}`}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input value={item.caption} onChange={(e) => setContent({ ...content, gallery: { ...content.gallery, items: content.gallery.items.map((row, i) => i === index ? { ...row, caption: e.target.value } : row) } })} placeholder="Caption" />
                    <Input value={item.serviceType} onChange={(e) => setContent({ ...content, gallery: { ...content.gallery, items: content.gallery.items.map((row, i) => i === index ? { ...row, serviceType: e.target.value } : row) } })} placeholder="Service type label" />
                  </div>
                  <Button type="button" variant="ghost" className="w-fit rounded-full text-destructive hover:text-destructive" onClick={() => setContent({ ...content, gallery: { ...content.gallery, items: content.gallery.items.filter((_, i) => i !== index) } })}>Remove</Button>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Social ── */}
        <TabsContent value="social" className="space-y-5">
          <SectionCard title="Social media links">
            <p className="text-sm text-muted-foreground">These appear in the footer and mobile menu. Leave blank to show greyed-out placeholder icons.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="WhatsApp number (digits only, e.g. 61451217210)"><Input value={content.socialLinks?.whatsapp ?? ""} onChange={(e) => setContent({ ...content, socialLinks: { ...content.socialLinks, whatsapp: e.target.value } })} placeholder="61451217210" /></Field>
              <Field label="Instagram URL"><Input value={content.socialLinks?.instagram ?? ""} onChange={(e) => setContent({ ...content, socialLinks: { ...content.socialLinks, instagram: e.target.value } })} placeholder="https://instagram.com/..." /></Field>
              <Field label="Facebook URL"><Input value={content.socialLinks?.facebook ?? ""} onChange={(e) => setContent({ ...content, socialLinks: { ...content.socialLinks, facebook: e.target.value } })} placeholder="https://facebook.com/..." /></Field>
              <Field label="LinkedIn URL"><Input value={content.socialLinks?.linkedin ?? ""} onChange={(e) => setContent({ ...content, socialLinks: { ...content.socialLinks, linkedin: e.target.value } })} placeholder="https://linkedin.com/..." /></Field>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Service Pages ── */}
        <TabsContent value="service-pages" className="space-y-5">
          <SectionCard title="Individual service page content">
            <p className="text-sm text-muted-foreground">Select a service to edit its dedicated page content (hero image, what&apos;s included, price guide, FAQ).</p>
            <Field label="Service">
              <Select value={selectedServiceSlug} onValueChange={setSelectedServiceSlug}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MARKETED_SERVICES.map((s) => <SelectItem key={s.slug} value={s.slug}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {selectedServiceSlug ? (() => {
              const slug = selectedServiceSlug;
              const page: WebsiteServicePage = content.servicePages?.[slug] ?? { heroImageUrl: "", heroImageAlt: "", whatIncluded: [], notIncluded: [], idealFor: "", priceGuide: "", faq: [] };
              const update = (next: Partial<WebsiteServicePage>) => setContent({ ...content, servicePages: { ...content.servicePages, [slug]: { ...page, ...next } } });
              return (
                <div className="space-y-4 pt-2">
                  <ImageField
                    label="Hero image"
                    value={page.heroImageUrl}
                    alt={page.heroImageAlt}
                    onChange={(url) => update({ heroImageUrl: url })}
                    onAltChange={(alt) => update({ heroImageAlt: alt })}
                    onUpload={(file) => handleCardUpload(`svcpage-${slug}`, file, (url) => update({ heroImageUrl: url }))}
                    uploading={uploadingKey === `svcpage-${slug}`}
                  />
                  <Field label="What's included (one item per line)">
                    <Textarea rows={8} value={page.whatIncluded.join("\n")} onChange={(e) => update({ whatIncluded: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })} />
                  </Field>
                  <Field label="Not included (one item per line)">
                    <Textarea rows={5} value={page.notIncluded.join("\n")} onChange={(e) => update({ notIncluded: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Ideal for"><Textarea rows={3} value={page.idealFor} onChange={(e) => update({ idealFor: e.target.value })} /></Field>
                    <Field label="Price guide"><Textarea rows={3} value={page.priceGuide} onChange={(e) => update({ priceGuide: e.target.value })} /></Field>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">Service-specific FAQ (3–4 items recommended)</p>
                      <Button type="button" variant="outline" className="rounded-full" onClick={() => update({ faq: [...page.faq, { question: "New question?", answer: "Answer here." }] })}>Add FAQ</Button>
                    </div>
                    {page.faq.map((item, idx) => (
                      <div key={`${slug}-faq-${idx}`} className="space-y-2 rounded-[1.2rem] border border-border/70 p-4">
                        <Input value={item.question} onChange={(e) => update({ faq: page.faq.map((row, i) => i === idx ? { ...row, question: e.target.value } : row) })} placeholder="Question" />
                        <Textarea rows={3} value={item.answer} onChange={(e) => update({ faq: page.faq.map((row, i) => i === idx ? { ...row, answer: e.target.value } : row) })} placeholder="Answer" />
                        <Button type="button" variant="ghost" className="w-fit rounded-full text-destructive hover:text-destructive" onClick={() => update({ faq: page.faq.filter((_, i) => i !== idx) })}>Remove</Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })() : null}
          </SectionCard>
        </TabsContent>

        <TabsContent value="layout" className="space-y-5">
          <SectionCard title="Page container width">
            <p className="text-sm text-muted-foreground">Controls the maximum width of the centered content area on all public pages. Use a percentage (e.g. <code className="rounded bg-muted px-1 text-xs">80%</code>) or a pixel value (e.g. <code className="rounded bg-muted px-1 text-xs">1200px</code>).</p>
            <Field label="Container max-width">
              <div className="flex items-center gap-3">
                <Input
                  value={content.containerWidth ?? "80%"}
                  onChange={(e) => setContent({ ...content, containerWidth: e.target.value })}
                  placeholder="80%"
                  className="max-w-[200px]"
                />
                <div className="flex flex-wrap gap-2">
                  {["60%","70%","75%","80%","85%","90%","1100px","1200px","1400px"].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setContent({ ...content, containerWidth: preset })}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${(content.containerWidth ?? "80%") === preset ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white/80 text-muted-foreground hover:border-primary hover:text-primary"}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
          </SectionCard>

          <SectionCard title="Announcement bar">
            <p className="text-sm text-muted-foreground">Controls the thin strip above the public header. Add a promo message when needed, or keep it empty to show just the contact row.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-[1.2rem] border border-border/70 px-4 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Enable announcement bar</p>
                  <p className="text-xs text-muted-foreground">Hide the whole strip from the public site.</p>
                </div>
                <Switch
                  checked={content.announcementBar.enabled}
                  onCheckedChange={(checked) => setContent({ ...content, announcementBar: { ...content.announcementBar, enabled: checked } })}
                />
              </div>

              <Field label="Background style">
                <Select
                  value={content.announcementBar.bgStyle}
                  onValueChange={(value) =>
                    setContent({
                      ...content,
                      announcementBar: {
                        ...content.announcementBar,
                        bgStyle: value as typeof content.announcementBar.bgStyle,
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subtle">Subtle</SelectItem>
                    <SelectItem value="accent">Accent</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Promo message">
                <Input
                  value={content.announcementBar.promoMessage}
                  onChange={(event) =>
                    setContent({
                      ...content,
                      announcementBar: { ...content.announcementBar, promoMessage: event.target.value },
                    })
                  }
                  placeholder="10% off first clean this month"
                />
              </Field>
              <Field label="Promo link">
                <Input
                  value={content.announcementBar.promoLink}
                  onChange={(event) =>
                    setContent({
                      ...content,
                      announcementBar: { ...content.announcementBar, promoLink: event.target.value },
                    })
                  }
                  placeholder="https://..."
                />
              </Field>
            </div>

            <Field label="Promo link label">
              <Input
                value={content.announcementBar.promoLinkLabel}
                onChange={(event) =>
                  setContent({
                    ...content,
                    announcementBar: { ...content.announcementBar, promoLinkLabel: event.target.value },
                  })
                }
                placeholder="Book now →"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { key: "showPhone", label: "Show phone" },
                { key: "showLocation", label: "Show location" },
                { key: "showHours", label: "Show hours" },
                { key: "showEmail", label: "Show email" },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded-[1.2rem] border border-border/70 px-4 py-3">
                  <span className="text-sm font-medium">{item.label}</span>
                  <Switch
                    checked={content.announcementBar[item.key as keyof typeof content.announcementBar] as boolean}
                    onCheckedChange={(checked) =>
                      setContent({
                        ...content,
                        announcementBar: {
                          ...content.announcementBar,
                          [item.key]: checked,
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>

            <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-muted/20 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Preview</p>
              <div className="overflow-hidden rounded-[1.2rem] border border-border/70 bg-white">
                {content.announcementBar.enabled ? (
                  <>
                    {content.announcementBar.promoMessage ? (
                      <div className="border-b border-border/70 px-4 py-2 text-sm font-medium">
                        {content.announcementBar.promoMessage}
                        {content.announcementBar.promoLink ? ` ${content.announcementBar.promoLinkLabel || "Book now →"}` : ""}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3 text-xs text-muted-foreground">
                      {content.announcementBar.showPhone ? <span>{content.contact.displayPhone}</span> : null}
                      {content.announcementBar.showLocation ? <span>{content.contact.addressLine}</span> : null}
                      {content.announcementBar.showHours ? <span>Mon-Sat 7am - 6pm</span> : null}
                      {content.announcementBar.showEmail ? <span>{content.contact.displayEmail}</span> : null}
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-3 text-sm text-muted-foreground">Announcement bar is disabled.</div>
                )}
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="json" className="space-y-5">
          <SectionCard title="Advanced raw JSON editor">
            <p className="text-sm text-muted-foreground">Use this if you want to paste or export the entire public-site content object. The structured tabs above are safer for day-to-day editing.</p>
            <Textarea rows={28} value={rawJson} onChange={(event) => setRawJson(event.target.value)} className="font-mono text-xs" />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(rawJson) as WebsiteContent;
                    setContent(parsed);
                    toast({ title: "Draft applied" });
                  } catch (error: any) {
                    toast({ title: "Invalid JSON", description: error.message, variant: "destructive" });
                  }
                }}
              >
                <Globe className="mr-2 h-4 w-4" />
                Apply JSON to draft
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  const reset = cloneContent(DEFAULT_WEBSITE_CONTENT);
                  setContent(reset);
                  setRawJson(JSON.stringify(reset, null, 2));
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset draft to defaults
              </Button>
              <Button type="button" className="rounded-full" onClick={async () => {
                try {
                  const parsed = JSON.parse(rawJson) as WebsiteContent;
                  await saveContent(parsed);
                } catch (error: any) {
                  toast({ title: "Invalid JSON", description: error.message, variant: "destructive" });
                }
              }} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                Save JSON
              </Button>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </AdminPageShell>
  );
}
