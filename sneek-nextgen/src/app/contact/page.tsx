import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Mail, Phone, MapPin, Clock, Send } from "lucide-react";

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign In</Link></Button>
            <Button size="sm" asChild><Link href="/quote">Get a Quote</Link></Button>
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Contact Us</h1>
            <p className="mt-4 text-lg text-text-secondary">Get in touch with our team</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Contact form */}
            <Card variant="outlined" className="lg:col-span-2">
              <CardContent className="pt-6">
                <form className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input label="Full Name" placeholder="John Doe" required />
                    <Input label="Email" type="email" placeholder="john@example.com" required />
                  </div>
                  <Input label="Phone" type="tel" placeholder="+61 400 000 000" />
                  <Select
                    label="Subject"
                    options={[
                      { value: "quote", label: "Request a Quote" },
                      { value: "support", label: "Customer Support" },
                      { value: "feedback", label: "Feedback" },
                      { value: "complaint", label: "Complaint" },
                      { value: "other", label: "Other" },
                    ]}
                    placeholder="Select subject"
                  />
                  <Textarea label="Message" placeholder="How can we help you?" className="min-h-32" required />
                  <Button type="submit" size="lg">
                    <Send className="h-4 w-4 mr-2" />
                    Send Message
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Contact info */}
            <div className="space-y-4">
              <Card variant="outlined">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 text-brand-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Email</p>
                        <p className="text-sm text-text-secondary">info@sneekops.com.au</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Phone className="h-5 w-5 text-brand-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Phone</p>
                        <p className="text-sm text-text-secondary">+61 400 000 000</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 text-brand-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Address</p>
                        <p className="text-sm text-text-secondary">Sydney, NSW, Australia</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock className="h-5 w-5 text-brand-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Hours</p>
                        <p className="text-sm text-text-secondary">Mon-Fri: 7am - 7pm</p>
                        <p className="text-sm text-text-secondary">Sat: 8am - 5pm</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
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
