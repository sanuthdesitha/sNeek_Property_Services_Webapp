import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = slug.replace(/-/g, " ");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <Button variant="ghost" size="sm" asChild><Link href="/careers">Back to Careers</Link></Button>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <Button variant="ghost" size="sm" asChild className="mb-6">
            <Link href="/careers"><ArrowLeft className="h-4 w-4 mr-2" />Back to Careers</Link>
          </Button>

          <h1 className="text-3xl font-bold text-text-primary mb-2">Apply: {title}</h1>
          <p className="text-text-secondary mb-8">Fill out the form below and we&apos;ll be in touch within 48 hours.</p>

          <Card variant="outlined">
            <CardContent className="pt-6">
              <form className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="First Name" placeholder="John" required />
                  <Input label="Last Name" placeholder="Doe" required />
                </div>
                <Input label="Email" type="email" placeholder="john@example.com" required />
                <Input label="Phone" type="tel" placeholder="+61 400 000 000" required />
                <Input label="Suburb" placeholder="Your suburb" required />
                <Select
                  label="Experience Level"
                  options={[
                    { value: "none", label: "No experience" },
                    { value: "1-2", label: "1-2 years" },
                    { value: "3-5", label: "3-5 years" },
                    { value: "5+", label: "5+ years" },
                  ]}
                  placeholder="Select experience"
                />
                <Input label="Availability" placeholder="e.g., Mon-Fri 7am-3pm" />
                <Textarea label="Why do you want to work with us?" placeholder="Tell us about yourself..." />
                <Button type="submit" className="w-full" size="lg">Submit Application</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="py-12 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
              <span className="font-semibold text-text-primary">sNeek Property Service</span>
            </div>
            <p className="text-sm text-text-tertiary">&copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
