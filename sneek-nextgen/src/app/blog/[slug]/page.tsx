import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, User } from "lucide-react";

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <Button variant="ghost" size="sm" asChild><Link href="/blog">Back to Blog</Link></Button>
        </div>
      </header>

      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Button variant="ghost" size="sm" asChild className="mb-8">
          <Link href="/blog"><ArrowLeft className="h-4 w-4 mr-2" />Back to Blog</Link>
        </Button>

        <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">Blog Post: {slug.replace(/-/g, " ")}</h1>
        <div className="flex items-center gap-4 text-sm text-text-tertiary mb-8">
          <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />April 15, 2026</span>
          <span className="flex items-center gap-1"><User className="h-4 w-4" />sNeek Team</span>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <p className="text-text-secondary leading-relaxed">This is a placeholder for the blog post content. In production, this would be loaded from the database and rendered with rich formatting, images, and other media.</p>
          <p className="text-text-secondary leading-relaxed mt-4">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
          <h2 className="text-xl font-semibold text-text-primary mt-8 mb-4">Key Takeaways</h2>
          <ul className="list-disc pl-6 text-text-secondary space-y-2">
            <li>Point one about the topic</li>
            <li>Point two with more details</li>
            <li>Point three with actionable advice</li>
          </ul>
        </div>
      </article>

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
