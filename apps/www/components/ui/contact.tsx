'use client';

import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const Contact = () => {
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setShowSuccess(urlParams.get('submission') === 'true');
  }, []);

  return (
    <section className="py-32">
      <div className="container">
        <div className="mb-14 text-center">
          <h1 className="mb-3 mt-1 text-balance text-3xl font-semibold md:text-4xl">
            Contact Us
          </h1>
          <p className="text-lg text-muted-foreground">
            Get in touch with the authors of Amical for any questions or support.
          </p>
        </div>
        <div className="flex justify-center">
          <div className={cn(
            "mx-auto flex w-full flex-col gap-6 rounded-lg p-10 md:max-w-[464px]",
            "bg-muted dark:bg-muted/30 dark:border dark:border-border"
          )}>
            <form action="https://submit-form.com/nItcloafD">
              <input type="hidden" name="form_name" value="contact_form" />
              <input type="hidden" name="_redirect" value="https://amical.ai/contact?submission=true" />
              <input
                type="checkbox"
                name="_is_valid_email"
                className="hidden"
                tabIndex={-1}
                autoComplete="off"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid w-full items-center gap-1.5">
                  <Label htmlFor="firstname">
                    First Name<sup className="ml-0.5">*</sup>
                  </Label>
                  <Input
                    type="text"
                    id="firstname"
                    name="firstname"
                    placeholder="Your First Name"
                    className="dark:border-border"
                    required
                  />
                </div>
                <div className="grid w-full items-center gap-1.5">
                  <Label htmlFor="lastname">
                    Last Name<sup className="ml-0.5">*</sup>
                  </Label>
                  <Input
                    type="text"
                    id="lastname"
                    name="lastname"
                    placeholder="Your Last Name"
                    className="dark:border-border"
                    required
                  />
                </div>
              </div>
              <div className="grid w-full items-center gap-1.5 mt-6">
                <Label htmlFor="email">
                  Email Address<sup className="ml-0.5">*</sup>
                </Label>
                <Input
                  type="email"
                  id="email"
                  name="email"
                  placeholder="Your Email"
                  className="dark:border-border"
                  required
                />
              </div>

              <div className="grid w-full gap-1.5 mt-6">
                <Label htmlFor="message">
                  Your Message<sup className="ml-0.5">*</sup>
                </Label>
                <Textarea
                  placeholder="How can we help you?"
                  id="message"
                  name="message"
                  className="dark:border-border"
                  required
                />
              </div>
              <div className="flex items-center space-x-2 mt-6">
                <Checkbox id="terms" name="terms" required />
                <label
                  htmlFor="terms"
                  className="text-sm font-medium leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I agree to the
                  <a href="/privacy" className="ml-1 underline hover:text-foreground">
                    privacy policy
                  </a>
                </label>
              </div>
              <Button type="submit" className="w-full mt-6">Submit</Button>
            </form>
            <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
              <DialogContent className="sm:max-w-md">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold">Message Sent!</h3>
                    <p className="text-muted-foreground">Thank you for reaching out. We&apos;ll get back to you shortly.</p>
                  </div>
                  <Button onClick={() => setShowSuccess(false)} className="mt-2">Close</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
