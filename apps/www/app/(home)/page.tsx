import { Hero } from "@/components/ui/hero";
import { GeneralFAQ } from "@/components/ui/general-faq";
import { FeatureContext } from "@/components/ui/feature-context";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <FeatureContext />
      <GeneralFAQ />
    </main>
  );
}