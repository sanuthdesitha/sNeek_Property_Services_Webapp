"use client";

import { Mail, MessageSquareMore, PhoneCall } from "lucide-react";
import { ContactForm } from "@/components/public/contact-form";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/public-site-shell";

function WhatsAppIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

interface ContactPageProps {
  content: {
    eyebrow: string;
    title: string;
    intro: string;
    formIntro: string;
    displayEmail: string;
    displayPhone: string;
    addressLine: string;
    responsePromise: string;
  };
}

export function ContactPage({ content }: ContactPageProps) {
  return (
    <div>
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        {/* Page heading */}
        <div className="mb-8 max-w-2xl space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{content.eyebrow}</p>
          <h1 className="text-3xl font-semibold sm:text-4xl xl:text-5xl">{content.title}</h1>
          <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">{content.intro}</p>
        </div>

        {/* Quick-contact cards */}
        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <a
            href="tel:+61451217210"
            className="group flex flex-col gap-3 rounded-[1.8rem] border border-white/70 bg-white/80 p-6 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.32)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(22,63,70,0.4)]"
          >
            <div className="rounded-2xl bg-primary/10 p-3 w-fit transition-colors duration-200 group-hover:bg-primary/15">
              <PhoneCall className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">+61 451 217 210</p>
              <p className="mt-1 text-sm text-muted-foreground">Call us directly</p>
              <p className="mt-2 text-xs text-primary font-medium">Mon–Sat, 7am–6pm</p>
            </div>
          </a>

          <a
            href="https://wa.me/61451217210"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col gap-3 rounded-[1.8rem] border border-white/70 bg-white/80 p-6 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.32)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(22,63,70,0.4)]"
          >
            <div className="rounded-2xl bg-[#25D366]/10 p-3 w-fit transition-colors duration-200 group-hover:bg-[#25D366]/20">
              <WhatsAppIcon className="h-5 w-5 text-[#25D366]" />
            </div>
            <div>
              <p className="font-semibold">Chat on WhatsApp</p>
              <p className="mt-1 text-sm text-muted-foreground">Fastest response</p>
              <p className="mt-2 text-xs text-[#25D366] font-medium">Typically replies within minutes →</p>
            </div>
          </a>

          <a
            href={`mailto:${content.displayEmail}`}
            className="group flex flex-col gap-3 rounded-[1.8rem] border border-white/70 bg-white/80 p-6 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.32)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(22,63,70,0.4)]"
          >
            <div className="rounded-2xl bg-primary/10 p-3 w-fit transition-colors duration-200 group-hover:bg-primary/15">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">{content.displayEmail}</p>
              <p className="mt-1 text-sm text-muted-foreground">We reply within 1 business day</p>
              <p className="mt-2 text-xs text-primary font-medium">Send us an email →</p>
            </div>
          </a>
        </div>

        {/* Form + sidebar */}
        <div className="grid gap-8 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)] xl:gap-10">
          <div className="space-y-5 xl:sticky xl:top-24 xl:self-start">
            <p className="text-sm leading-7 text-muted-foreground">{content.formIntro}</p>
            <div className="grid gap-3">
              {[
                {
                  icon: MessageSquareMore,
                  title: "Custom quote requests",
                  body: "Best for large homes, unusual scope, staged cleans, specialty treatments, Airbnb packages, or anything that needs a proper review.",
                },
                {
                  icon: PhoneCall,
                  title: "Recurring service discussions",
                  body: "Use this for weekly, fortnightly, monthly, or hosting-support subscriptions rather than a once-off clean.",
                },
              ].map((item) => (
                <Card key={item.title} className="rounded-[1.6rem] border-white/70 bg-white/80 shadow-[0_14px_40px_-28px_rgba(22,63,70,0.3)]">
                  <CardContent className="flex gap-4 p-5">
                    <div className="rounded-2xl bg-primary/10 p-3 shrink-0">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-sm">{item.title}</p>
                      <p className="text-xs leading-5 text-muted-foreground">{item.body}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="rounded-[1.6rem] border-white/70 bg-white/80 shadow-[0_14px_40px_-28px_rgba(22,63,70,0.3)]">
              <CardContent className="space-y-1.5 p-5 text-sm text-muted-foreground">
                <p>{content.addressLine}</p>
                <p>{content.responsePromise}</p>
              </CardContent>
            </Card>
          </div>

          <ContactForm />
        </div>
      </section>
    </div>
  );
}
