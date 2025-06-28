import Changelog from "@/components/ui/changelog";
import { SubscriptionForm } from "@/components/ui/subscription-form";

export const metadata = {
  title: "Changelog",
  description: "Get the latest product updates and changes to Amical.",
};

export default function ChangelogPage() {
  return (
    <>
      <Changelog />
    </>
  );
}
