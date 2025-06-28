import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { InlineTOC } from "fumadocs-ui/components/inline-toc";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { blog } from "@/lib/source";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = blog.getPage([params.slug]);

  if (!page) notFound();

  return {
    title: {
      absolute: `${page.data.title} | Amical`,
    },
    description:
      page.data.description ?? "A blog about Amical, Productivity and AI",
    openGraph: {
      title: `${page.data.title}`,
      description:
        page.data.description ?? "A blog about Amical, Productivity and AI",
      type: "article",
      images: page.data.image ? [{ url: page.data.image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: `${page.data.title}`,
      description:
        page.data.description ?? "A blog about Amical, Productivity and AI",
      images: page.data.image ? [page.data.image] : undefined,
    },
  };
}

export default async function Page(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
  const page = blog.getPage([params.slug]);

  if (!page) notFound();
  const { body: Mdx, toc } = await page.data.load();

  return (
    <>
      <div className="container max-w-4xl pt-12 pb-6 md:px-8">
        <Button
          variant="outline"
          size="sm"
          className="mb-4 text-sm text-white/80"
          asChild
        >
          <Link href="/blog">
            <ArrowLeft className="mr-1" />
            Back
          </Link>
        </Button>
        <h1 className="mb-2 text-4xl font-bold text-white">
          {page.data.title}
        </h1>
        <p className="text-white/80">{page.data.description}</p>
      </div>
      <article className="container max-w-4xl flex flex-col px-4 lg:flex-row lg:px-8">
        <div className="prose min-w-0 flex-1 p-4 pt-0">
          {page.data.image && (
            <div className="mb-8 mx-auto max-w-2xl overflow-hidden rounded-lg">
              <Image
                src={page.data.image}
                alt={`Cover image for ${page.data.title}`}
                width={800}
                height={450}
                className="w-full object-cover"
                priority
              />
            </div>
          )}
          <InlineTOC items={toc} defaultOpen={false} className="mb-6" />
          <Mdx
            components={{
              ...defaultMdxComponents,
              File,
              Files,
              Folder,
              Tabs,
              Tab,
            }}
          />
        </div>
      </article>
    </>
  );
}

export function generateStaticParams(): { slug: string }[] {
  return blog.getPages().map((page) => ({
    slug: page.slugs[0] || "",
  }));
}
