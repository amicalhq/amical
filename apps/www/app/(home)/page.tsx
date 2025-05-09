import { Hero } from "@/components/ui/hero";
import { GeneralFAQ } from "@/components/ui/general-faq";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <GeneralFAQ />
    </main>
  );
}