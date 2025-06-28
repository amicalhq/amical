import { blog } from "@/lib/source";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { SubscriptionForm } from "@/components/ui/subscription-form";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description: "A blog about Amical, Productivity and AI",
};

export default function Page(): React.ReactElement {
  const posts = [...blog.getPages()].sort((a, b) => {
    // First sort by priority (higher priority first)
    const priorityDiff = (b.data.priority || 0) - (a.data.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;

    // Then sort by date (newer first)
    return (
      new Date(b.data.date ?? b.file.name).getTime() -
      new Date(a.data.date ?? a.file.name).getTime()
    );
  });

  return (
    <section className="py-32">
      <div className="container mx-auto flex flex-col items-center gap-16 lg:px-16">
        <div className="text-center">
          <SubscriptionForm
            variant="blog"
            formName="blog_subscription"
            redirectUrl="https://amical.ai/blog?submission=true&form_type=subscribe"
            showHeader={true}
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {posts.map((post) => (
            <Card
              key={post.url}
              className="grid grid-rows-[auto_auto_1fr_auto]"
            >
              {post.data.image && (
                <div className="aspect-[16/9] w-full">
                  <a
                    href={post.url}
                    className="transition-opacity duration-200 fade-in hover:opacity-70"
                  >
                    <img
                      src={post.data.image}
                      alt={post.data.title}
                      className="h-full w-full object-cover object-center"
                    />
                  </a>
                </div>
              )}
              <CardHeader>
                <h3 className="text-lg font-semibold hover:underline md:text-xl">
                  <a href={post.url}>{post.data.title}</a>
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{post.data.description}</p>
              </CardContent>
              <CardFooter>
                <a
                  href={post.url}
                  className="flex items-center text-foreground hover:underline"
                >
                  Read more
                  <ArrowRight className="ml-2 size-4" />
                </a>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
