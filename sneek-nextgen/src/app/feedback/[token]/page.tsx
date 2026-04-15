import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-6">
          <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Rate Your Experience</h1>
          <p className="text-text-secondary text-center text-sm mb-6">How was your recent cleaning service?</p>
          <form className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} type="button" className="p-1"><Star className="h-8 w-8 text-warning-500" /></button>
              ))}
            </div>
            <Textarea label="Comments" placeholder="Tell us about your experience..." />
            <Button type="submit" className="w-full">Submit Feedback</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
