import {
  defineConfig,
  defineCollections,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from "fumadocs-mdx/config";
import { z } from "zod";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.vercel.app/docs/mdx/collections#define-docs
export const { docs, meta } = defineDocs({
  dir: "content/docs",
  docs: {
    schema: frontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

// Create a simpler blog schema to avoid deep type instantiation
const blogSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  author: z.string(),
  image: z.string(),
  date: z.union([z.string(), z.date()]).optional(),
  priority: z.number().default(0),
});

export const blog = defineCollections({
  type: "doc",
  dir: "content/blogs",
  async: true,
  schema: blogSchema,
});

export default defineConfig({
  mdxOptions: {
    // MDX options
  },
});
