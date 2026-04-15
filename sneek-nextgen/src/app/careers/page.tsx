import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, MapPin, Clock, DollarSign, ArrowRight } from "lucide-react";

const JOBS = [
  { title: "Professional Cleaner", type: "Full-time", location: "Sydney CBD", pay: "$32-38/hr", posted: "2 days ago", urgent: true },
  { title: "Laundry Attendant", type: "Part-time", location: "Alexandria", pay: "$28-32/hr", posted: "1 week ago", urgent: false },
  { title: "Operations Coordinator", type: "Full-time", location: "Sydney CBD", pay: "$65-75k", posted: "2 weeks ago", urgent: false },
];

const BENEFITS = [
  "Competitive hourly rates with performance bonuses",
  "Flexible scheduling — choose your availability",
  "Paid training and professional development",
  "All equipment and supplies provided",
  "Real-time GPS tracking for safety",
  "Supportive team environment",
  "Career growth opportunities",
  "Employee referral bonuses",
];

export default function CareersPage() {
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
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary tracking-tight">Join Our Team</h1>
          <p className="mt-6 text-lg text-text-secondary max-w-2xl mx-auto">
            We&apos;re always looking for reliable, detail-oriented professionals to join the sNeek team.
          </p>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-text-primary mb-8">Open Positions</h2>
          <div className="space-y-4">
            {JOBS.map((job) => (
              <Card key={job.title} variant="outlined">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">{job.title}</h3>
                        {job.urgent && <Badge variant="danger">Urgent</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-text-secondary">
                        <span className="flex items-center gap-1"><Briefcase className="h-4 w-4" />{job.type}</span>
                        <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{job.location}</span>
                        <span className="flex items-center gap-1"><DollarSign className="h-4 w-4" />{job.pay}</span>
                        <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{job.posted}</span>
                      </div>
                    </div>
                    <Button asChild>
                      <Link href={`/apply/${job.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        Apply Now
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-neutral-50 dark:bg-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-text-primary text-center mb-8">Why Work With Us</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {BENEFITS.map((benefit) => (
              <Card key={benefit} variant="outlined">
                <CardContent className="pt-4 text-sm text-text-secondary">{benefit}</CardContent>
              </Card>
            ))}
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
