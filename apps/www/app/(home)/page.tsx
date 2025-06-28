import { Hero } from "@/components/ui/hero";
import { GeneralFAQ } from "@/components/ui/general-faq";
import { FeatureContext } from "@/components/ui/feature-context";
import ComparisonTraditional from "@/components/ui/comparison-traditional";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <FeatureContext />
      <ComparisonTraditional />
      <GeneralFAQ />
    </main>
  );
}
