import { Badge } from "@/components/ui/badge";
import { SubscriptionForm } from "@/components/ui/subscription-form";
export type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  description: string;
  items?: string[];
  image?: string;
};

export interface ChangelogProps {
  title?: string;
  description?: string;
  entries?: ChangelogEntry[];
  className?: string;
}

const Changelog = ({
  title = "Changelog",
  description = "Get the latest product updates and changes to Amical.",
  entries = defaultChangelogData,
}: ChangelogProps) => {
  return (
    <section className="py-32">
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight md:text-5xl">
            {title}
          </h1>
          <p className="mb-6 text-base text-muted-foreground md:text-lg">
            {description}
          </p>
        </div>
        <SubscriptionForm
        variant="blog"
        formName="changelog_subscription"
        redirectUrl="https://amical.ai/changelog?submission=true&form_type=subscribe"
        showHeader={false}
      />
        <div className="mx-auto mt-16 max-w-3xl space-y-16 md:mt-24 md:space-y-24">
          {entries.map((entry, index) => (
            <div
              key={index}
              className="relative flex flex-col gap-4 md:flex-row md:gap-16"
            >
              <div className="top-28 flex h-min shrink-0 items-center gap-4 md:sticky">
                <Badge variant="secondary" className="text-xs">
                  {entry.version}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground">
                  {entry.date}
                </span>
              </div>
              <div>
                <h2 className="mb-3 text-lg leading-tight font-bold text-foreground/90 md:text-2xl">
                  {entry.title}
                </h2>
                <p className="text-sm text-muted-foreground md:text-base">
                  {entry.description}
                </p>
                {entry.items && entry.items.length > 0 && (
                  <ul className="mt-4 ml-4 space-y-1.5 text-sm text-muted-foreground md:text-base">
                    {entry.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="list-disc">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {entry.image && (
                  <img
                    src={entry.image}
                    alt={`${entry.version} visual`}
                    className="mt-8 w-full rounded-lg object-cover"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Changelog;

export const defaultChangelogData: ChangelogEntry[] = [
  {
    version: "Version 0.1.0",
    date: "28 April 2025",
    title: "Amical 0.1 coming soon!",
    description:
      "First version of Amical is coming soon by end of May 2025! What to expect:",
    items: [
      "Mac",
      "Speech-to-Text",
      "Context-aware"
    ],
    image: "https://placehold.co/1200x600/6b46c1/ffffff?text=Announcing+Amical+0.1",
  }
];
