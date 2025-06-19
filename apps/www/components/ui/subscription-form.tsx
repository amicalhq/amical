'use client';

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SubscriptionFormProps {
  variant?: 'blog' | 'footer';
  formName?: string;
  redirectUrl?: string;
  showHeader?: boolean;
}

export function SubscriptionForm({
  variant = 'blog',
  formName = 'subscription',
  redirectUrl = 'https://amical.ai/blog?submission=true&form_type=subscribe',
  showHeader = true
}: SubscriptionFormProps) {
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setShowSuccess(urlParams.get('submission') === 'true' && urlParams.get('form_type') === 'subscribe');
  }, []);

  return (
    <>
      {showHeader && (
        <>
          <Badge variant="secondary" className="mb-6">
            Latest Updates
          </Badge>
          <h2 className="mb-3 text-pretty text-3xl font-semibold md:mb-4 md:text-4xl lg:mb-6 lg:max-w-3xl lg:text-5xl">
            Amical <span className="animate-text-gradient inline-flex bg-gradient-to-r from-neutral-900 via-slate-500 to-neutral-500 bg-[200%_auto] bg-clip-text leading-tight text-transparent dark:from-neutral-100 dark:via-slate-400 dark:to-neutral-400">Blog</span>
          </h2>
          <p className="mb-8 text-muted-foreground md:text-base lg:max-w-2xl lg:text-lg">
            Discover the latest news and updates from Amical.
          </p>
        </>
      )}

      <form action="https://submit-form.com/nItcloafD" className={`flex flex-col ${variant === 'blog' ? 'items-center' : ''} gap-4`}>
        <input type="hidden" name="form_name" value={formName} />
        <input type="hidden" name="_redirect" value={redirectUrl} />
        <input
          type="checkbox"
          name="_is_valid_email"
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
        />
        <div className={`flex ${variant === 'blog' ? 'w-full max-w-md' : ''} gap-2`}>
          <Input placeholder="Enter your email" type="email" name="email" required />
          <Button type="submit">Subscribe</Button>
        </div>
      </form>

      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold">Successfully Subscribed!</h3>
              <p className="text-muted-foreground">We&apos;ll send you updates about Amical at most once a month.</p>
            </div>
            <Button onClick={() => setShowSuccess(false)} className="mt-2">Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}