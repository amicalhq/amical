import { Metadata } from "next";

export const baseUrl = new URL(
  process.env.NEXT_PUBLIC_APP_URL ?? "https://amical.ai",
);

export function createMetadata(metadata: Metadata): Metadata {
  return {
    ...metadata,
    title: {
      template: "%s | Amical - Open Source AI Dictation App",
      default: "Amical - Open Source AI Dictation App",
    },
    description:
      "Type 10x faster, no keyboards needed. Fast, Accurate, Context-aware and Private.",
    metadataBase: baseUrl,
    openGraph: {
      title: "Amical - Open Source AI Dictation App",
      description:
        "Type 10x faster, no keyboards needed. Fast, Accurate, Context-aware and Private.",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Amical - Open Source AI Dictation App",
      description:
        "Type 10x faster, no keyboards needed. Fast, Accurate, Context-aware and Private.",
    },
  };
}
