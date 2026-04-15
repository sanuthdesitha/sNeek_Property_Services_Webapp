import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, ArrowRight } from "lucide-react";

const POSTS = [
  { slug: "5-tips-maintaining-clean-airbnb", title: "5 Tips for Maintaining a Clean Airbnb", excerpt: "Keep your guests happy and your reviews stellar with these proven cleaning strategies.", tags: ["Airbnb", "Tips"], date: "2026-04-10", author: "sNeek Team" },
  { slug: "why-deep-cleaning-matters", title: "Why Deep Cleaning Matters", excerpt: "Regular deep cleaning extends the life of your property and improves indoor air quality.", tags: ["Deep Clean", "Education"], date: "2026-04-05", author: "sNeek Team" },
  { slug: "spring-cleaning-checklist-2026", title: "Spring Cleaning Checklist 2026", excerpt: "Our comprehensive guide to getting your property ready for the warmer months.", tags: ["Spring Clean", "Checklist"], date: "2026-04-01", author: "sNeek Team" },
  { slug: "end-of-lease-cleaning-guide", title: "End of Lease Cleaning: The Complete Guide", excerpt: "Everything you need to know to get your full bond back.", tags: ["End of Lease", "Guide"], date: "2026-03-25", author: "sNeek Team" },
];

export default function BlogPage() {
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
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Blog</h1>
            <p className="mt-4 text-lg text-text-secondary">Cleaning tips, guides, and industry insights</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {POSTS.map((post) => (
              <Card key={post.slug} variant="outlined" className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex gap-2 mb-3">
                    {post.tags.map((tag) => (
                      <Badge key={tag} variant="neutral" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                  <h3 className="font-semibold text-lg text-text-primary">{post.title}</h3>
                  <p className="text-sm text-text-secondary mt-2 line-clamp-2">{post.excerpt}</p>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-xs text-text-tertiary flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {post.date}
                    </span>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/blog/${post.slug}`}>
                        Read More
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
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
